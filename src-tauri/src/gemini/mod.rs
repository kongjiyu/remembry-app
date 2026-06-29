//! Gemini API REST client.

mod files;
mod generate;
pub mod validation;

use reqwest::Client;
use serde::Deserialize;
use std::time::Duration;

pub const GEMINI_BASE_URL: &str = "https://generativelanguage.googleapis.com";
pub const GEMINI_API_VERSION: &str = "v1beta";

#[derive(Debug, Clone)]
pub struct GeminiClient {
    http: Client,
    api_key: String,
}

impl GeminiClient {
    pub fn new(api_key: String) -> Self {
        // `timeout` covers the whole request (read+write).
        // `connect_timeout` caps DNS+TCP+TLS handshake separately so connection-level
        // failures fail fast (~10s) instead of hanging for the full 120s. This makes
        // network vs. request issues distinguishable in logs.
        let http = Client::builder()
            .timeout(Duration::from_secs(120))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .expect("HTTP client builder should not fail");
        Self { http, api_key }
    }

    pub fn files_api_uri(&self, path: &str) -> String {
        format!("{}/{}/{}?key={}", GEMINI_BASE_URL, GEMINI_API_VERSION, path, self.api_key)
    }

    pub fn generate_api_uri(&self, model: &str) -> String {
        format!("{}/{}/models/{}:generateContent?key={}", GEMINI_BASE_URL, GEMINI_API_VERSION, model, self.api_key)
    }

    pub fn http(&self) -> &Client {
        &self.http
    }

    pub fn api_key(&self) -> &str {
        &self.api_key
    }
}

pub async fn retry_with_backoff<F, T, E, Fut>(mut f: F) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, E>>,
    E: std::fmt::Debug + Clone,
{
    let mut attempt = 0;
    let max_attempts = 5;
    let base_delay = std::time::Duration::from_secs(2);

    loop {
        match f().await {
            Ok(result) => return Ok(result),
            Err(ref e) if attempt >= max_attempts => return Err(e.clone()),
            Err(ref e) => {
                attempt += 1;
                let delay = base_delay * (1 << attempt.min(4));
                log::warn!("Retryable error, attempt {}/{}: {:?}. Waiting {:?}.", attempt, max_attempts, e, delay);
                tokio::time::sleep(delay).await;
            }
        }
    }
}

pub fn is_retryable_error(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::TOO_MANY_REQUESTS
        || status.as_u16() >= 500
}

/// Normalize a Gemini file resource name to its canonical `files/{name}` form.
/// If the input already starts with `files/`, return it unchanged.
/// Otherwise, prefix it with `files/`.
pub fn normalize_file_resource_name(name: &str) -> String {
    if name.starts_with("files/") {
        name.to_string()
    } else {
        format!("files/{}", name)
    }
}

/// Strip the API key from an error message to prevent key exposure in logs.
pub fn sanitize_api_key_from_error(err: &str) -> String {
    // Replace ?key=... and &key=... patterns, preserving the separator
    let err = regex::Regex::new(r"\?key=[A-Za-z0-9_-]+")
        .unwrap()
        .replace_all(err, "?key=[REDACTED]")
        .to_string();
    regex::Regex::new(r"&key=[A-Za-z0-9_-]+")
        .unwrap()
        .replace_all(&err, "&key=[REDACTED]")
        .to_string()
}

/// Walk an error's `source()` chain and join all layers with " :: caused by: ".
///
/// Used for reqwest transport errors where `e.to_string()` only returns the
/// top-level "error sending request for url" message, hiding the actual cause
/// (DNS failure, TLS handshake error, TCP reset, etc.).
pub fn format_error_chain(e: &(dyn std::error::Error + 'static)) -> String {
    let mut chain = e.to_string();
    let mut src = e.source();
    let mut depth = 0;
    const MAX_DEPTH: usize = 10; // guard against pathological cycles
    while let Some(s) = src {
        if depth >= MAX_DEPTH {
            chain.push_str(" :: ... (truncated)");
            break;
        }
        chain.push_str(&format!(" :: caused by: {}", s));
        src = s.source();
        depth += 1;
    }
    chain
}

/// Format a reqwest transport error with the full cause chain, prefixed for the
/// given request type, and with any embedded API keys redacted.
pub(crate) fn format_reqwest_error(prefix: &str, e: &reqwest::Error) -> String {
    let chain = format_error_chain(e);
    let with_prefix = format!("{}: {}", prefix, chain);
    sanitize_api_key_from_error(&with_prefix)
}

#[derive(Debug, Deserialize)]
struct GeminiErrorBody {
    error: Option<GeminiErrorDetail>,
}

#[derive(Debug, Deserialize)]
struct GeminiErrorDetail {
    message: Option<String>,
}

pub fn format_gemini_error(status: reqwest::StatusCode, body: &str) -> String {
    let sanitized = sanitize_api_key_from_error(body);
    let message = serde_json::from_str::<GeminiErrorBody>(&sanitized)
        .ok()
        .and_then(|body| body.error)
        .and_then(|error| error.message)
        .filter(|message| !message.trim().is_empty())
        .unwrap_or_else(|| sanitized.trim().to_string());

    let message = if message.is_empty() {
        "No error details returned.".to_string()
    } else {
        message
    };

    format!("Request failed with status {}: {}", status, message)
}

pub use files::{upload_file, delete_file};
pub use generate::{transcribe_audio, extract_meeting_notes, extract_event_knowledge};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_gemini_error_extracts_message_from_json_body() {
        let body = r#"{
            "error": {
                "code": 429,
                "message": "Your prepayment credits are depleted.",
                "status": "RESOURCE_EXHAUSTED"
            }
        }"#;

        let formatted = format_gemini_error(reqwest::StatusCode::TOO_MANY_REQUESTS, body);

        assert_eq!(
            formatted,
            "Request failed with status 429 Too Many Requests: Your prepayment credits are depleted."
        );
    }

    #[test]
    fn format_gemini_error_sanitizes_api_keys_in_plain_text_body() {
        let body = "https://generativelanguage.googleapis.com/v1beta/files/abc?key=secret_key";

        let formatted = format_gemini_error(reqwest::StatusCode::BAD_REQUEST, body);

        assert!(formatted.contains("?key=[REDACTED]"));
        assert!(!formatted.contains("secret_key"));
    }

    // ── format_error_chain tests ──────────────────────────────────────────

    use std::fmt;

    /// Synthetic two-layer error for testing the chain walker without
    /// needing a live reqwest::Error.
    struct InnerErr(String);
    impl fmt::Display for InnerErr {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str(&self.0)
        }
    }
    impl fmt::Debug for InnerErr {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str(&self.0)
        }
    }
    impl std::error::Error for InnerErr {}

    struct OuterErr {
        msg: String,
        source: Box<dyn std::error::Error + Send + Sync + 'static>,
    }
    impl OuterErr {
        fn new(msg: &str, source: Box<dyn std::error::Error + Send + Sync + 'static>) -> Self {
            Self { msg: msg.to_string(), source }
        }
    }
    impl fmt::Display for OuterErr {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str(&self.msg)
        }
    }
    impl fmt::Debug for OuterErr {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.debug_struct("OuterErr")
                .field("msg", &self.msg)
                .field("source", &self.source)
                .finish()
        }
    }
    impl std::error::Error for OuterErr {
        fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
            Some(self.source.as_ref())
        }
    }

    #[test]
    fn format_error_chain_walks_two_layers() {
        let inner = InnerErr("dns error: failed to lookup host".to_string());
        let outer = OuterErr::new("error sending request for url", Box::new(inner));

        let chain = format_error_chain(&outer);

        assert!(chain.starts_with("error sending request for url"));
        assert!(chain.contains(":: caused by: dns error: failed to lookup host"));
    }

    #[test]
    fn format_error_chain_handles_single_layer() {
        let inner = InnerErr("connection refused".to_string());
        let chain = format_error_chain(&inner);

        assert_eq!(chain, "connection refused");
        assert!(!chain.contains("caused by"));
    }

    #[test]
    fn format_error_chain_truncates_cycles() {
        // Build a self-referencing error (unusual but possible via Box<dyn Error>).
        // We can't easily make InnerErr self-referential, so we approximate by
        // checking the depth guard via a long chain of distinct errors.
        let mut current: Box<dyn std::error::Error + Send + Sync + 'static> =
            Box::new(InnerErr("layer 0".to_string()));
        for i in 1..15 {
            current = Box::new(OuterErr::new(
                &format!("layer {}", i),
                current,
            ));
        }
        // Walk from the outermost. Should hit the MAX_DEPTH=10 cap.
        let outermost: &(dyn std::error::Error + 'static) = current.as_ref();
        let chain = format_error_chain(outermost);

        assert!(chain.contains("... (truncated)"), "got: {}", chain);
    }
}
