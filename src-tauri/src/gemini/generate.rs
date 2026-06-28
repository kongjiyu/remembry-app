//! Gemini generateContent — transcription and note extraction.
//!
//! Prompt construction now lives in `crate::prompts` so the same strings
//! can be reused by any LLM provider. This module only owns the Gemini
//! wire-format details (REST URL, JSON body shape, response parsing).

use crate::db::{TranscriptionResult, MeetingNotes, EventKnowledge};
use crate::gemini::{GeminiClient, retry_with_backoff, is_retryable_error, format_reqwest_error, format_gemini_error};
use serde::Deserialize;

const TRANSCRIPTION_MODEL: &str = "gemini-3-flash-preview";
const EXTRACTION_MODEL: &str = "gemini-3-flash-preview";

/// Back-compat re-export. The real implementation moved to `crate::prompts`.
/// Existing tests reference `super::extract_json_from_response`; we keep the
/// symbol alive so they don't need to be edited.
#[inline]
pub(crate) fn extract_json_from_response(text: &str) -> Option<String> {
    crate::prompts::extract_json_object(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_json_plain_json() {
        let json = r#"{"foo": "bar", "nested": {"a": 1}}"#;
        assert_eq!(extract_json_from_response(json), Some(json.to_string()));
    }

    #[test]
    fn test_extract_json_fenced_json() {
        let text = "Here is the JSON:\n```json\n{\"foo\": \"bar\"}\n```\nAnd some explanation";
        let extracted = extract_json_from_response(text);
        assert_eq!(extracted, Some(r#"{"foo": "bar"}"#.to_string()));
    }

    #[test]
    fn test_extract_json_with_code_tags() {
        let text = "<code>{\"foo\": \"bar\"}</code>";
        let extracted = extract_json_from_response(text);
        assert_eq!(extracted, Some(r#"{"foo": "bar"}"#.to_string()));
    }

    #[test]
    fn test_extract_json_code_tag_closed_after() {
        // This is the actual failure case: `{...}</code>`
        let text = r#"Here's the result: {"foo": "bar", "nested": {"a": 1, "b": 2}}</code>"#;
        let extracted = extract_json_from_response(text);
        assert_eq!(extracted, Some(r#"{"foo": "bar", "nested": {"a": 1, "b": 2}}"#.to_string()));
    }

    #[test]
    fn test_extract_json_nested_braces_in_strings() {
        // JSON string containing {} should not cause early termination
        let text = r#"{"content": "has {curly} in string", "nested": {"a": 1}}"#;
        let extracted = extract_json_from_response(text);
        assert_eq!(extracted, Some(text.to_string()));
    }

    #[test]
    fn test_extract_json_no_object() {
        let text = "Just plain text without JSON";
        assert_eq!(extract_json_from_response(text), None);
    }

    #[test]
    fn test_extract_json_unbalanced() {
        let text = "{\"foo\": {"; // missing closing brace
        assert_eq!(extract_json_from_response(text), None);
    }
}

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Option<Vec<Candidate>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Candidate {
    content: Option<Content>,
}

#[derive(Debug, Deserialize)]
struct Content {
    parts: Vec<Part>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Part {
    text: Option<String>,
}

pub async fn transcribe_audio(
    client: &GeminiClient,
    file_uri: &str,
    mime_type: &str,
    context: &str,
) -> Result<TranscriptionResult, String> {
    let prompt = format!(
        "You are a professional transcriptionist. Transcribe the audio file exactly as spoken. \
        Include all words, filler words where relevant, and note significant pauses. \
        If there is contextual information, incorporate it: {}\n\nPlease provide ONLY the transcription text, no preamble.",
        context
    );

    let request_body = serde_json::json!({
        "contents": [{
            "parts": [
                { "file_data": { "mime_type": mime_type, "file_uri": file_uri } },
                { "text": prompt }
            ]
        }]
    });

    let response = send_generate_request(client, TRANSCRIPTION_MODEL, request_body).await?;
    let text = parse_gemini_text_response(response)?;

    // Try to detect language from first part or default to 'en'
    let language = None; // Gemini transcription doesn't reliably return language

    Ok(TranscriptionResult { text, language })
}

pub async fn extract_meeting_notes(
    client: &GeminiClient,
    transcription: &str,
    context: &str,
    language: &str,
) -> Result<MeetingNotes, String> {
    let prompt = crate::prompts::meeting_notes_prompt(transcription, context, language);

    let request_body = serde_json::json!({
        "contents": [{
            "parts": [{ "text": prompt }]
        }],
        "generation_config": {
            "temperature": 0.3,
            "top_p": 0.8,
            "max_output_tokens": 2048
        }
    });

    let response = send_generate_request(client, EXTRACTION_MODEL, request_body).await?;
    let text = parse_gemini_text_response(response)?;

    let json_str = extract_json_from_response(&text)
        .ok_or_else(|| format!("No JSON object found in response. Response was: {}", text))?;

    let notes: MeetingNotes = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse meeting notes JSON: {}. Response was: {}", e, text))?;

    Ok(notes)
}

/// Extract structured EventKnowledge from a transcript using dynamic prompts
/// based on event_type and event_tags.
pub async fn extract_event_knowledge(
    client: &GeminiClient,
    transcription: &str,
    context: &str,
    event_type: &str,
    event_tags: &[String],
    language: &str,
) -> Result<EventKnowledge, String> {
    let prompt = crate::prompts::event_knowledge_prompt(
        transcription, context, event_type, event_tags, language,
    );

    let request_body = serde_json::json!({
        "contents": [{
            "parts": [{ "text": prompt }]
        }],
        "generation_config": {
            "temperature": 0.3,
            "top_p": 0.8,
            "max_output_tokens": 4096
        }
    });

    let response = send_generate_request(client, EXTRACTION_MODEL, request_body).await?;
    let text = parse_gemini_text_response(response)?;

    let json_str = extract_json_from_response(&text)
        .ok_or_else(|| format!("No JSON object found in response. Response was: {}", text))?;

    let ek: EventKnowledge = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse EventKnowledge JSON: {}. Response was: {}", e, text))?;

    Ok(ek)
}

async fn send_generate_request(
    client: &GeminiClient,
    model: &str,
    body: serde_json::Value,
) -> Result<String, String> {
    let url = client.generate_api_uri(model);

    let request = || async {
        let response = client.http()
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                let msg = format_reqwest_error("generateContent request failed", &e);
                log::error!("[Gemini] generateContent transport error: {}", msg);
                msg
            })?;

        let status = response.status();
        if status == reqwest::StatusCode::BAD_REQUEST {
            let body = response.text().await.unwrap_or_default();
            return Err(format_gemini_error(status, &body));
        }
        if is_retryable_error(status) {
            let body = response.text().await.unwrap_or_default();
            return Err(format_gemini_error(status, &body));
        }

        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(format_gemini_error(status, &body));
        }

        let gemini_resp: GeminiResponse = response.json().await
            .map_err(|e| format!("Failed to parse Gemini response: {}", e))?;

        let text = gemini_resp.candidates
            .and_then(|c| c.into_iter().next())
            .and_then(|c| c.content)
            .and_then(|mut content| content.parts.pop())
            .and_then(|p| p.text)
            .unwrap_or_default();

        Ok(text)
    };

    retry_with_backoff(request).await
}

fn parse_gemini_text_response(response: String) -> Result<String, String> {
    if response.trim().is_empty() {
        return Err("Empty response from Gemini".to_string());
    }
    Ok(response)
}
