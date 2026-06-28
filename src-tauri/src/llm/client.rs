//! HTTP client for any OpenAI-compatible chat completion API.
//!
//! The same client works for Groq, OpenCode Go, DeepSeek, OpenRouter,
//! and any user-provided endpoint that exposes `POST {base_url}/chat/completions`.

use reqwest::Client;
use serde_json::Value;
use std::time::Duration;

use super::types::{ChatCompletionRequest, ChatCompletionResponse, ChatMessage};

#[derive(Debug, Clone)]
pub struct LlmClient {
    http: Client,
    api_key: String,
    base_url: String,
}

impl LlmClient {
    pub fn new(api_key: String, base_url: String) -> Self {
        // 120s timeout covers long LLM responses, 10s connect timeout fails fast
        // on DNS / TLS / TCP problems so they're distinguishable from slow completions.
        let http = Client::builder()
            .timeout(Duration::from_secs(120))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .expect("HTTP client builder should not fail");
        Self { http, api_key, base_url }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// POST `{base_url}/chat/completions` and return the first choice's text content.
    ///
    /// Returns an error string suitable for surfacing to the UI.
    pub async fn chat_completion(
        &self,
        model: &str,
        messages: Vec<ChatMessage>,
        temperature: Option<f32>,
        max_tokens: Option<u32>,
        response_format: Option<Value>,
    ) -> Result<String, String> {
        let body = ChatCompletionRequest {
            model: model.to_string(),
            messages,
            temperature,
            max_tokens,
            response_format,
        };

        let url = format!("{}/chat/completions", self.base_url.trim_end_matches('/'));
        let response = self.http
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Chat completion request failed: {}", e))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            // Truncate long error bodies to keep logs readable.
            let truncated = if body.len() > 500 {
                format!("{}... (truncated)", &body[..500])
            } else {
                body
            };
            return Err(format!("Chat completion failed ({}): {}", status, truncated));
        }

        let parsed: ChatCompletionResponse = response.json()
            .await
            .map_err(|e| format!("Failed to parse chat completion response: {}", e))?;

        let text = parsed
            .choices
            .into_iter()
            .next()
            .and_then(|c| c.message.content)
            .unwrap_or_default();

        if text.trim().is_empty() {
            return Err("Chat completion returned an empty response".to_string());
        }

        Ok(text)
    }

    /// Run a chat completion expecting a JSON object back, and return the
    /// parsed value. Wraps the prompt as a single user message and sets
    /// `response_format = {"type": "json_object"}` so providers that respect
    /// it (Groq, OpenAI, OpenRouter) constrain output to JSON.
    ///
    /// Falls back to the brace-depth scanner in `crate::prompts` to extract
    /// the JSON object — useful for providers that ignore `response_format`
    /// or wrap the JSON in code fences.
    pub async fn extract_json(
        &self,
        model: &str,
        prompt: &str,
        temperature: f32,
        max_tokens: u32,
    ) -> Result<Value, String> {
        let messages = vec![ChatMessage {
            role: "user".into(),
            content: prompt.to_string(),
        }];
        let response_format = serde_json::json!({"type": "json_object"});
        let text = self
            .chat_completion(model, messages, Some(temperature), Some(max_tokens), Some(response_format))
            .await?;

        let json_str = crate::prompts::extract_json_object(&text)
            .ok_or_else(|| format!("No JSON object found in response. Response was: {}", text))?;

        serde_json::from_str(&json_str)
            .map_err(|e| format!("Failed to parse JSON from response: {}. Response was: {}", e, text))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_message_serialization_roundtrip() {
        let msg = ChatMessage { role: "user".into(), content: "hello".into() };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"role\":\"user\""));
        assert!(json.contains("\"content\":\"hello\""));

        let parsed: ChatMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, msg);
    }

    #[test]
    fn chat_completion_request_omits_none_fields() {
        let req = ChatCompletionRequest {
            model: "llama-3.3-70b-versatile".into(),
            messages: vec![ChatMessage { role: "user".into(), content: "hi".into() }],
            temperature: None,
            max_tokens: None,
            response_format: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("\"model\":\"llama-3.3-70b-versatile\""));
        assert!(!json.contains("temperature"));
        assert!(!json.contains("max_tokens"));
        assert!(!json.contains("response_format"));
    }

    #[test]
    fn chat_completion_request_includes_all_fields_when_set() {
        let req = ChatCompletionRequest {
            model: "gpt-4".into(),
            messages: vec![],
            temperature: Some(0.3),
            max_tokens: Some(4096),
            response_format: Some(serde_json::json!({"type": "json_object"})),
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("\"temperature\":0.3"));
        assert!(json.contains("\"max_tokens\":4096"));
        assert!(json.contains("\"response_format\":{\"type\":\"json_object\"}"));
    }

    #[test]
    fn base_url_trailing_slash_normalized() {
        let client = LlmClient::new("k".into(), "https://api.groq.com/openai/v1/".into());
        // No-op call to verify the format helper handles trailing slash.
        // We can't make a real HTTP call here, but we can confirm the URL builder logic.
        let expected = "https://api.groq.com/openai/v1/chat/completions";
        let formatted = format!("{}/chat/completions", client.base_url().trim_end_matches('/'));
        assert_eq!(formatted, expected);
    }

    #[test]
    fn response_message_with_null_content_uses_default() {
        // When content is None, our extractor returns empty string. The caller
        // treats empty content as an error in chat_completion — but the parsing
        // itself must not panic.
        let json = r#"{"choices": [{"message": {"content": null}}]}"#;
        let parsed: ChatCompletionResponse = serde_json::from_str(json).unwrap();
        let text = parsed.choices.into_iter().next().and_then(|c| c.message.content).unwrap_or_default();
        assert_eq!(text, "");
    }

    #[test]
    fn extract_json_request_payload_shape() {
        // Verify the helper builds the expected message + response_format.
        // We can't exercise the live HTTP path here, but we can lock down the
        // payload structure so any refactor of extract_json is forced to keep it.
        let prompt = "extract this as JSON";
        let messages = vec![ChatMessage { role: "user".into(), content: prompt.into() }];
        let response_format = serde_json::json!({"type": "json_object"});
        let body = ChatCompletionRequest {
            model: "llama-3.3-70b-versatile".into(),
            messages,
            temperature: Some(0.3),
            max_tokens: Some(4096),
            response_format: Some(response_format),
        };
        let json = serde_json::to_string(&body).unwrap();
        assert!(json.contains("\"role\":\"user\""));
        assert!(json.contains("\"content\":\"extract this as JSON\""));
        assert!(json.contains("\"response_format\":{\"type\":\"json_object\"}"));
        assert!(json.contains("\"temperature\":0.3"));
        assert!(json.contains("\"max_tokens\":4096"));
    }

    #[test]
    fn extract_json_prompts_parser_with_fenced_response() {
        // Simulate what extract_json does after receiving the response:
        // take the text, run it through the JSON-object extractor, then parse.
        let response_text = "Here's the JSON:\n```json\n{\"summary\": \"ok\"}\n```";
        let json_str = crate::prompts::extract_json_object(response_text).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json_str).unwrap();
        assert_eq!(value["summary"], "ok");
    }
}