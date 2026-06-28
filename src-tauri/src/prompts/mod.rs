//! Shared extraction prompts.
//!
//! These prompts are used by both the Gemini provider (via `gemini/generate.rs`)
//! and any OpenAI-compatible provider (via `llm/client.rs::extract_json`).
//!
//! Keeping them in one place means a model swap never silently changes the
//! schema we ask for — the contract on the LLM stays stable.

/// Build the language-instruction line for a given target language code.
fn language_instruction(language: &str) -> &'static str {
    match language {
        "zh" | "chinese" => "Respond in Chinese (Simplified).",
        "ja" | "japanese" => "Respond in Japanese.",
        "ko" | "korean" => "Respond in Korean.",
        "es" | "spanish" => "Respond in Spanish.",
        "fr" | "french" => "Respond in French.",
        "de" | "german" => "Respond in German.",
        _ => "Respond in English.",
    }
}

/// Meeting notes extraction prompt.
///
/// `transcription` is the speech-to-text output (or pasted text).
/// `context` is user-supplied free-form context (title, agenda, participants).
/// `language` is the ISO code for the response language (en, zh, ja, ...).
pub fn meeting_notes_prompt(transcription: &str, context: &str, language: &str) -> String {
    let lang_instruction = language_instruction(language);
    format!(
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
    )
}

/// Event knowledge extraction prompt.
///
/// `event_type` is one of: meeting, interview, lecture, etc.
/// `event_tags` is a list of pre-existing tags to bias extraction toward.
/// `language` controls the response language.
pub fn event_knowledge_prompt(
    transcription: &str,
    context: &str,
    event_type: &str,
    event_tags: &[String],
    language: &str,
) -> String {
    let lang_instruction = language_instruction(language);

    let tags_hint = if event_tags.is_empty() {
        String::new()
    } else {
        format!("\nEvent tags to guide extraction: {}.\n", event_tags.join(", "))
    };

    let event_type_hint = format!(
        "\nEvent type: '{}'. Adapt extraction to focus on {} specific patterns.\n",
        event_type, event_type
    );

    format!(
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
    )
}

/// Extract the first complete JSON object from an LLM response text.
///
/// This is the same brace-depth scanner used by the Gemini provider
/// originally. It's kept here so any provider can share the same
/// tolerant parser for fenced/markdown/code-tag wrapped JSON.
pub fn extract_json_object(text: &str) -> Option<String> {
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
    fn meeting_notes_prompt_includes_transcript_and_context() {
        let prompt = meeting_notes_prompt("hello world", "standup", "en");
        assert!(prompt.contains("hello world"));
        assert!(prompt.contains("standup"));
        assert!(prompt.contains("Respond in English"));
    }

    #[test]
    fn meeting_notes_prompt_uses_zh_when_language_is_zh() {
        let prompt = meeting_notes_prompt("你好", "会议", "zh");
        assert!(prompt.contains("Respond in Chinese"));
    }

    #[test]
    fn event_knowledge_prompt_includes_event_type_and_tags() {
        let tags = vec!["roadmap".to_string(), "performance".to_string()];
        let prompt = event_knowledge_prompt("transcript text", "ctx", "interview", &tags, "en");
        assert!(prompt.contains("Event type: 'interview'"));
        assert!(prompt.contains("roadmap, performance"));
        assert!(prompt.contains("transcript text"));
    }

    #[test]
    fn event_knowledge_prompt_omits_tags_hint_when_empty() {
        let prompt = event_knowledge_prompt("text", "ctx", "meeting", &[], "en");
        assert!(!prompt.contains("Event tags to guide"));
    }

    #[test]
    fn extract_json_object_handles_plain_json() {
        let json = r#"{"foo": "bar", "nested": {"a": 1}}"#;
        assert_eq!(extract_json_object(json), Some(json.to_string()));
    }

    #[test]
    fn extract_json_object_handles_fenced_json() {
        let text = "Here is the JSON:\n```json\n{\"foo\": \"bar\"}\n```\nAnd some explanation";
        assert_eq!(extract_json_object(text), Some(r#"{"foo": "bar"}"#.to_string()));
    }

    #[test]
    fn extract_json_object_handles_code_tags() {
        let text = "<code>{\"foo\": \"bar\"}</code>";
        assert_eq!(extract_json_object(text), Some(r#"{"foo": "bar"}"#.to_string()));
    }

    #[test]
    fn extract_json_object_returns_none_for_unbalanced() {
        let text = r#"{"foo": {"#;
        assert_eq!(extract_json_object(text), None);
    }

    #[test]
    fn extract_json_object_ignores_braces_in_strings() {
        let text = r#"{"content": "has {curly} in string", "nested": {"a": 1}}"#;
        assert_eq!(extract_json_object(text), Some(text.to_string()));
    }
}