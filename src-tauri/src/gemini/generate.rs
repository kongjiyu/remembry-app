//! Gemini generateContent — transcription and note extraction.

use crate::db::{TranscriptionResult, MeetingNotes, EventKnowledge};
use crate::gemini::{GeminiClient, retry_with_backoff, is_retryable_error, sanitize_api_key_from_error, format_gemini_error};
use serde::Deserialize;

const TRANSCRIPTION_MODEL: &str = "gemini-3-flash-preview";
const EXTRACTION_MODEL: &str = "gemini-3-flash-preview";

/// Extract the first complete JSON object from a Gemini response text.
///
/// Uses brace-depth scanning to correctly handle:
/// - Strings containing `{` or `}` (escaped or unescaped)
/// - Nested objects
/// - HTML tags like `<code>{ ... }</code>` or `{ ... }</code>` after the JSON
///
/// Returns `None` if no opening `{` is found or the braces are unbalanced.
fn extract_json_from_response(text: &str) -> Option<String> {
    let start = text.find('{')?;
    let bytes = text[start..].as_bytes();

    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;

    for (i, &byte) in bytes.iter().enumerate() {
        if escaped {
            escaped = false;
            continue;
        }

        match byte {
            b'\\' if in_string => {
                escaped = true;
            }
            b'"' => {
                in_string = !in_string;
            }
            b'{' if !in_string => {
                depth += 1;
            }
            b'}' if !in_string => {
                depth -= 1;
                if depth == 0 {
                    return Some(text[start..start + i + 1].to_string());
                }
            }
            _ => {}
        }
    }

    None
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
    let lang_instruction = match language {
        "zh" | "chinese" => "Respond in Chinese (Simplified).",
        "ja" | "japanese" => "Respond in Japanese.",
        "ko" | "korean" => "Respond in Korean.",
        "es" | "spanish" => "Respond in Spanish.",
        "fr" | "french" => "Respond in French.",
        "de" | "german" => "Respond in German.",
        _ => "Respond in English.",
    };

    let prompt = format!(
        r#"You are an AI assistant that analyzes meeting transcripts and extracts structured notes.

Context about this meeting: {}

Return raw JSON only. Do not wrap it in markdown, HTML, XML, or code tags.

{{
  "summary": "A 2-3 sentence concise summary of the meeting",
  "action_items": [
    {{ "task": "Description of the task", "assignee": "Name of person responsible (or null)", "due_date": "Due date if mentioned (or null)" }}
  ],
  "decisions": ["Decision 1", "Decision 2"],
  "questions_and_answers": [
    {{ "question": "Question asked", "answer": "Answer given" }}
  ],
  "key_points": ["Key point 1", "Key point 2", "Key point 3"]
}}

Transcript:
{}

{}"#,
        context, transcription, lang_instruction
    );

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
    let lang_instruction = match language {
        "zh" | "chinese" => "Respond in Chinese (Simplified).",
        "ja" | "japanese" => "Respond in Japanese.",
        "ko" | "korean" => "Respond in Korean.",
        "es" | "spanish" => "Respond in Spanish.",
        "fr" | "french" => "Respond in French.",
        "de" | "german" => "Respond in German.",
        _ => "Respond in English.",
    };

    let tags_hint = if event_tags.is_empty() {
        String::new()
    } else {
        format!("\nEvent tags to guide extraction: {}.\n", event_tags.join(", "))
    };

    let event_type_hint = format!(
        "\nEvent type: '{}'. Adapt extraction to focus on {} specific patterns.\n",
        event_type,
        event_type
    );

    let prompt = format!(
        r#"You are an AI assistant that analyzes transcripts and extracts structured event knowledge.

Context about this event: {}

Event type: '{}'{}
Return raw JSON only. Do not wrap it in markdown, HTML, XML, or code tags.

Tags are important: use meaningful, reusable tags that can link related items together. When an item has a clear topic, assign at least one non-empty tag. Keep tags consistent across items so the frontend can surface related concepts, observations, insights, and references by tag matching.

Provide 3-5 key_points only — short overview bullets for quick scanning, 1-2 sentences each. Do not include more.

{{
  "schema_version": 1,
  "event_type": "{}",
  "title": "A short descriptive title for this event",
  "summary": "A 2-3 sentence concise summary of the event",
  "concepts": [
    {{
      "id": "concept_{{canonical_name}}",
      "type": "concept",
      "content": "Description of the concept from the transcript",
      "canonical_name": "snake_case_normalized_name",
      "title": "Human-readable title",
      "aliases": ["alias1", "alias2"],
      "description": "Brief description",
      "confidence": 0.95,
      "evidence": [{{ "snippet": "Relevant quote from transcript", "speaker": "Speaker name if available" }}],
      "tags": ["roadmap", "performance"]
    }}
  ],
  "key_points": [
    {{ "id": "kp_1", "type": "observation", "content": "Short overview bullet — 1-2 sentences for quick scanning", "confidence": 0.9, "evidence": [{{ "snippet": "Quote" }}], "tags": [] }}
  ],
  "insights": [
    {{ "id": "insight_1", "type": "insight", "content": "Key insight or discovery", "confidence": 0.85, "evidence": [{{ "snippet": "Quote" }}], "tags": ["user_feedback", "roadmap"] }}
  ],
  "questions": [
    {{ "id": "q_1", "type": "question", "content": "Question raised", "status": "open", "evidence": [{{ "snippet": "Quote" }}], "tags": ["performance", "roadmap"] }}
  ],
  "decisions": [
    {{ "id": "d_1", "type": "decision", "content": "Decision made", "evidence": [{{ "snippet": "Quote", "speaker": "Who made this decision" }}], "tags": ["roadmap"] }}
  ],
  "action_items": [
    {{ "id": "task_1", "type": "task", "content": "Action item description", "assignee": "Person responsible or null", "due_date": "YYYY-MM-DD or null", "evidence": [{{ "snippet": "Quote" }}], "tags": ["user_feedback"] }}
  ],
  "observations": [
    {{ "id": "obs_1", "type": "observation", "subtype": "balancing_issue", "content": "Observational detail", "evidence": [{{ "snippet": "Quote" }}], "tags": ["performance", "user_feedback"] }}
  ],
  "references": [
    {{ "id": "ref_1", "type": "reference", "content": "Reference or resource mentioned", "evidence": [{{ "snippet": "Quote" }}], "tags": ["roadmap", "performance"] }}
  ],
  "related_topics": ["topic1", "topic2"],
  "sentiment": {{
    "overall": "positive|neutral|negative|mixed",
    "important_emotions": ["satisfaction", "frustration"]
  }}
}}

Transcript:
{}

{}{}"#,
        context,
        event_type,
        tags_hint,
        event_type,
        transcription,
        lang_instruction,
        event_type_hint
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
            .map_err(|e| format!("generateContent request failed: {}", sanitize_api_key_from_error(&e.to_string())))?;

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
