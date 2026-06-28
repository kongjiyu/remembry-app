//! Groq Whisper transcription provider.
//!
//! Uses Groq's OpenAI-compatible `/audio/transcriptions` endpoint, which is
//! currently free-tier (whisper-large-v3 / whisper-large-v3-turbo, 100 req/day).

use reqwest::Client;
use std::path::Path;
use std::time::Duration;

use super::TranscriptionResult;

#[derive(Debug, Clone)]
pub struct GroqWhisper {
    http: Client,
    api_key: String,
    model: String,
}

impl GroqWhisper {
    pub fn new(api_key: String, model: String) -> Self {
        // Whisper jobs can run several minutes for hour-long files — use the
        // same 120s request budget as the LLM client. 10s connect cap fails
        // fast on network problems.
        let http = Client::builder()
            .timeout(Duration::from_secs(120))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .expect("HTTP client builder should not fail");
        Self { http, api_key, model }
    }

    /// Run the transcription. Public so callers outside the `transcription`
    /// module can use it directly (e.g. tests, fallback chains).
    pub async fn transcribe(
        &self,
        file_path: &Path,
        mime_type: &str,
        _context: &str,
    ) -> Result<TranscriptionResult, String> {
        let file_bytes = tokio::fs::read(file_path).await
            .map_err(|e| format!("Failed to read audio file: {}", e))?;
        let file_name = file_path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("audio.ogg")
            .to_string();

        let part = reqwest::multipart::Part::bytes(file_bytes)
            .file_name(file_name)
            .mime_str(mime_type)
            .map_err(|e| format!("Invalid MIME type '{}': {}", mime_type, e))?;

        let form = reqwest::multipart::Form::new()
            .part("file", part)
            .text("model", self.model.clone())
            .text("response_format", "json");

        let response = self.http
            .post("https://api.groq.com/openai/v1/audio/transcriptions")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Groq transcription request failed: {}", e))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            let truncated = if body.len() > 500 {
                format!("{}... (truncated)", &body[..500])
            } else {
                body
            };
            return Err(format!("Groq transcription failed ({}): {}", status, truncated));
        }

        let resp: serde_json::Value = response.json().await
            .map_err(|e| format!("Failed to parse Groq response: {}", e))?;

        let text = resp.get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        if text.trim().is_empty() {
            return Err("Groq returned an empty transcription".to_string());
        }

        Ok(TranscriptionResult { text, language: None })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groq_whisper_stores_model_name() {
        let client = GroqWhisper::new("test_key".into(), "whisper-large-v3".into());
        assert_eq!(client.model, "whisper-large-v3");
    }

    #[test]
    fn groq_whisper_accepts_turbo_model() {
        let client = GroqWhisper::new("test_key".into(), "whisper-large-v3-turbo".into());
        assert_eq!(client.model, "whisper-large-v3-turbo");
    }
}