//! Ask Question Tauri commands — RAG-style Q&A over meeting transcripts and knowledge.

use crate::db;
use crate::gemini::GeminiClient;
use crate::secrets;
use serde::{Deserialize, Serialize};

const LOCAL_USER: &str = "local_user";

#[derive(Debug, Deserialize)]
struct AskJson {
    answer: String,
    #[serde(default)]
    follow_up_questions: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskQuestionRequest {
    pub scope: String,
    pub project_id: String,
    pub meeting_id: Option<String>,
    pub question: String,
    pub language: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskQuestionResponse {
    pub success: bool,
    pub answer: String,
    pub sources: Vec<AskSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub follow_up_questions: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskSource {
    pub id: String,
    pub meeting_id: String,
    pub title: String,
    pub created_at: String,
    pub snippet: String,
}

/// Truncate a string to `max_len` bytes at a valid UTF-8 character boundary.
/// If the string is shorter, returns it unchanged.
fn truncate_utf8(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        return s.to_string();
    }
    let mut end = max_len;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

/// Simple tokenize for lexical matching: lowercase, split on non-alphanumeric.
fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

/// Score a meeting by counting how many query tokens appear in title, context, or transcript.
/// Higher score = more relevant.
fn score_meeting(meeting: &db::Meeting, query_tokens: &[String]) -> usize {
    let mut score = 0usize;

    let title_lower = meeting.title.to_lowercase();
    let context_lower = meeting.context.as_deref().unwrap_or("").to_lowercase();

    let transcript_text = meeting.transcription
        .as_ref()
        .map(|t| t.text.to_lowercase())
        .unwrap_or_default();

    for token in query_tokens {
        // Title match is weighted higher
        if title_lower.contains(token) {
            score += 3;
        }
        if context_lower.contains(token) {
            score += 2;
        }
        if transcript_text.contains(token) {
            score += 1;
        }
    }

    score
}

/// Build a bounded context string from top-ranked meetings.
/// Includes title, date, extracted knowledge, and transcript snippets.
fn build_context(meetings: &[db::Meeting], top_indices: &[usize], max_context_len: usize) -> String {
    let mut context_parts = Vec::new();
    let mut current_len = 0usize;

    for &idx in top_indices {
        let meeting = &meetings[idx];
        let mut part = format!(
            "--- Event: {} ---\nDate: {}\n",
            meeting.title,
            meeting.created_at
        );

        // Add extracted knowledge if available
        if let Some(ref knowledge_by_lang) = meeting.knowledge_by_language {
            if let Some(ek) = extract_event_knowledge_json(knowledge_by_lang) {
                part.push_str(&format!("Summary: {}\n", ek.summary));
                if !ek.key_points.is_empty() {
                    part.push_str(&format!("Key Points: {}\n", ek.key_points.join("; ")));
                }
                if !ek.decisions.is_empty() {
                    part.push_str(&format!("Decisions: {}\n", ek.decisions.iter().map(|d| d.content.as_str()).collect::<Vec<_>>().join("; ")));
                }
                if !ek.action_items.is_empty() {
                    part.push_str(&format!(
                        "Action Items: {}\n",
                        ek.action_items.iter()
                            .map(|a| a.content.as_str())
                            .collect::<Vec<_>>()
                            .join("; ")
                    ));
                }
                if !ek.questions.is_empty() {
                    part.push_str(&format!(
                        "Questions: {}\n",
                        ek.questions.iter()
                            .map(|q| format!("Q: {} A: {}", q.content, q.answer.as_deref().unwrap_or("")))
                            .collect::<Vec<_>>()
                            .join("; ")
                    ));
                }
            }
        }

        // Add transcript snippet
        if let Some(ref transcription) = meeting.transcription {
            let snippet = truncate_utf8(&transcription.text, 500);
            let snippet = if snippet.len() < transcription.text.len() {
                format!("{}...", snippet)
            } else {
                snippet
            };
            part.push_str(&format!("Transcript: {}\n", snippet));
        }

        if current_len + part.len() > max_context_len {
            let remaining = max_context_len - current_len;
            if remaining > 50 {
                context_parts.push(truncate_utf8(&part, remaining));
            }
            break;
        }

        context_parts.push(part.clone());
        current_len += part.len();
    }

    context_parts.join("\n")
}

/// Lightweight structure for context building (avoids full EventKnowledge parsing for all paths).
#[derive(Debug)]
struct KnowledgeSnippet {
    summary: String,
    key_points: Vec<String>,
    decisions: Vec<KnowledgeItemSnippet>,
    action_items: Vec<TaskItemSnippet>,
    questions: Vec<QuestionItemSnippet>,
}

#[derive(Debug)]
struct KnowledgeItemSnippet {
    content: String,
}

#[derive(Debug)]
struct TaskItemSnippet {
    content: String,
}

#[derive(Debug)]
struct QuestionItemSnippet {
    content: String,
    answer: Option<String>,
}

fn extract_event_knowledge_json(knowledge_json: &serde_json::Value) -> Option<KnowledgeSnippet> {
    let obj = knowledge_json.as_object()?;

    // Try to get the default or English version
    let entry = obj.get("default")
        .or_else(|| obj.get("en"))
        .or_else(|| obj.values().next())?;

    let ek = entry.as_object()?;

    let summary = ek.get("summary")?.as_str()?.to_string();

    let key_points = ek.get("key_points")?
        .as_array()?
        .iter()
        .filter_map(|item| item.get("content").and_then(|v| v.as_str()))
        .map(|s| s.to_string())
        .collect();

    let decisions = ek.get("decisions")?
        .as_array()?
        .iter()
        .filter_map(|item| {
            Some(KnowledgeItemSnippet {
                content: item.get("content")?.as_str()?.to_string(),
            })
        })
        .collect();

    let action_items = ek.get("action_items")?
        .as_array()?
        .iter()
        .filter_map(|item| {
            Some(TaskItemSnippet {
                content: item.get("content")?.as_str()?.to_string(),
            })
        })
        .collect();

    let questions = ek.get("questions")?
        .as_array()?
        .iter()
        .filter_map(|item| {
            Some(QuestionItemSnippet {
                content: item.get("content")?.as_str()?.to_string(),
                answer: item.get("answer").and_then(|v| v.as_str()).map(|s| s.to_string()),
            })
        })
        .collect();

    Some(KnowledgeSnippet {
        summary,
        key_points,
        decisions,
        action_items,
        questions,
    })
}

const MAX_CONTEXT_LEN: usize = 8000;
const MAX_SOURCE_SNIPPETS: usize = 5;
const ASK_MODEL: &str = "gemini-3-flash-preview";

/// Main implementation for ask_question command.
async fn ask_question_impl(
    scope: &str,
    project_id: &str,
    meeting_id: Option<&str>,
    question: &str,
    language: &str,
) -> Result<AskQuestionResponse, String> {
    let api_key = secrets::get_gemini_key()
        .map_err(|e| format!("Gemini API key not found. Please add your API key in Settings. Error: {}", e))?;

    let meetings = if scope == "meeting" {
        // Single meeting scope
        if let Some(mid) = meeting_id {
            let m = db::meetings::get_meeting(mid)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Meeting not found".to_string())?;
            vec![m]
        } else {
            return Err("meeting_id is required for scope=meeting".to_string());
        }
    } else {
        // Project scope — load all meetings for the project
        db::meetings::list_meetings(Some(project_id))
            .map_err(|e| e.to_string())?
    };

    if meetings.is_empty() {
        return Ok(AskQuestionResponse {
            success: true,
            answer: "No events found for this query. Try uploading or transcribing some events first.".to_string(),
            sources: vec![],
            follow_up_questions: None,
        });
    }

    // Tokenize question for lexical matching
    let query_tokens = tokenize(question);

    // Score and rank meetings
    let mut scored: Vec<(usize, usize)> = meetings.iter()
        .enumerate()
        .map(|(idx, m)| (idx, score_meeting(m, &query_tokens)))
        .collect();

    // Sort by score descending, then by date descending
    scored.sort_by(|a, b| {
        match b.1.cmp(&a.1) {
            std::cmp::Ordering::Equal => {
                // Higher score first, then newer first
                b.0.cmp(&a.0)
            }
            other => other,
        }
    });

    // Take top scored meetings for context
    let top_indices: Vec<usize> = scored.iter()
        .take(MAX_SOURCE_SNIPPETS)
        .map(|(idx, _)| *idx)
        .collect();

    let context = build_context(&meetings, &top_indices, MAX_CONTEXT_LEN);

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
        r#"You are an AI assistant that answers questions based ONLY on the provided context from event transcripts and extracted knowledge.

Answer the user's question using ONLY the information in the context below.
If the context does not contain enough information to answer the question, say:
"I don't have enough information to answer this question based on the available events."
Do NOT make up information or assume details not present in the context.

{lang_instruction}

---
CONTEXT:
{context}
---

Question: {question}

Return raw JSON only. Do not wrap it in markdown, HTML, XML, or code tags.

{{
  "answer": "Your answer to the question, based only on the context above",
  "follow_up_questions": ["Possible follow-up question 1", "Possible follow-up question 2", "Possible follow-up question 3"]
}}"#,
        lang_instruction = lang_instruction,
        context = context,
        question = question
    );

    let request_body = serde_json::json!({
        "contents": [{
            "parts": [{ "text": prompt }]
        }],
        "generation_config": {
            "temperature": 0.4,
            "top_p": 0.8,
            "max_output_tokens": 2048
        }
    });

    let client = GeminiClient::new(api_key);
    let url = client.generate_api_uri(ASK_MODEL);

    let response = send_ask_request(&client, &url, request_body).await?;
    let text = parse_gemini_text_response(&response)?;

    let json_str = extract_json_from_response(&text)
        .ok_or_else(|| format!("No JSON object found in response. Response was: {}", text))?;

    let parsed: AskJson = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse ask response JSON: {}. Response was: {}", e, text))?;

    // Build sources from top meetings
    let sources: Vec<AskSource> = top_indices.iter()
        .map(|&idx| {
            let meeting = &meetings[idx];
            let snippet = meeting.transcription.as_ref()
                .map(|t| {
                    let truncated = truncate_utf8(&t.text, 150);
                    if truncated.len() < t.text.len() {
                        format!("{}...", truncated)
                    } else {
                        truncated
                    }
                })
                .unwrap_or_default();
            AskSource {
                id: format!("source-{}", idx),
                meeting_id: meeting.id.clone(),
                title: meeting.title.clone(),
                created_at: meeting.created_at.clone(),
                snippet,
            }
        })
        .collect();

    let _ = db::gemini_key_metadata::increment_usage(LOCAL_USER);

    Ok(AskQuestionResponse {
        success: true,
        answer: parsed.answer,
        sources,
        follow_up_questions: if parsed.follow_up_questions.is_empty() {
            None
        } else {
            Some(parsed.follow_up_questions)
        },
    })
}

async fn send_ask_request(
    client: &GeminiClient,
    url: &str,
    body: serde_json::Value,
) -> Result<String, String> {
    let make_request = || async {
        let response = client.http()
            .post(url)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| crate::gemini::sanitize_api_key_from_error(&e.to_string()))?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(crate::gemini::format_gemini_error(status, &body));
        }

        #[derive(Deserialize)]
        struct GeminiResponse {
            candidates: Option<Vec<Candidate>>,
        }

        #[derive(Deserialize)]
        struct Candidate {
            content: Option<Content>,
        }

        #[derive(Deserialize)]
        struct Content {
            parts: Vec<Part>,
        }

        #[derive(Deserialize)]
        struct Part {
            text: Option<String>,
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

    crate::gemini::retry_with_backoff(make_request).await
}

fn parse_gemini_text_response(response: &str) -> Result<String, String> {
    if response.trim().is_empty() {
        Err("Empty response from Gemini".to_string())
    } else {
        Ok(response.to_string())
    }
}

/// Extract the first complete JSON object from a Gemini response text.
/// Uses brace-depth scanning.
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

#[tauri::command]
pub async fn ask_question(
    scope: String,
    project_id: String,
    meeting_id: Option<String>,
    question: String,
    language: Option<String>,
) -> Result<AskQuestionResponse, String> {
    if question.trim().is_empty() {
        return Err("Question cannot be empty".to_string());
    }
    if project_id.trim().is_empty() {
        return Err("project_id is required".to_string());
    }

    let lang = language.unwrap_or_else(|| "en".to_string());

    ask_question_impl(&scope, &project_id, meeting_id.as_deref(), &question, &lang).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tokenize_basic() {
        let tokens = tokenize("What decisions were made about the roadmap?");
        assert!(tokens.contains(&"decisions".to_string()));
        assert!(tokens.contains(&"roadmap".to_string()));
        assert!(tokens.contains(&"made".to_string()));
    }

    #[test]
    fn test_tokenize_special_chars() {
        let tokens = tokenize("user-feedback, roadmap planning!");
        assert!(tokens.contains(&"user".to_string()));
        assert!(tokens.contains(&"feedback".to_string()));
        assert!(tokens.contains(&"roadmap".to_string()));
        assert!(tokens.contains(&"planning".to_string()));
    }

    #[test]
    fn test_score_meeting_title_match() {
        use crate::db::{Meeting, TranscriptionResult};

        let meeting = Meeting {
            id: "1".to_string(),
            project_id: "p1".to_string(),
            title: "Q3 Roadmap Planning".to_string(),
            context: Some("Discussing roadmap priorities".to_string()),
            file_name: None,
            file_size: None,
            mime_type: None,
            file_type: "audio".to_string(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            transcription: Some(TranscriptionResult { text: "We decided to prioritize mobile".to_string(), language: None }),
            event_type: None,
            event_tags: None,
            knowledge_by_language: None,
            default_language: None,
            available_languages: None,
        };

        // "mobile" appears only in transcript → weight 1
        let score_mobile = score_meeting(&meeting, &["mobile".to_string()]);
        assert_eq!(score_mobile, 1);

        // "priorities" appears only in context → weight 2
        let score_priorities = score_meeting(&meeting, &["priorities".to_string()]);
        assert_eq!(score_priorities, 2);

        // "roadmap" appears in title (+3) AND context (+2) → total weight 5
        let score_roadmap = score_meeting(&meeting, &["roadmap".to_string()]);
        assert_eq!(score_roadmap, 5);

        // No match
        let score_unknown = score_meeting(&meeting, &["xyz123".to_string()]);
        assert_eq!(score_unknown, 0);
    }

    #[test]
    fn test_extract_json_from_response_plain() {
        let text = r#"{"answer": "The decision was to ship v2", "follow_up_questions": ["What about v3?"]}"#;
        let extracted = extract_json_from_response(text);
        assert!(extracted.is_some());
        let parsed: AskJson = serde_json::from_str(&extracted.unwrap()).unwrap();
        assert!(parsed.answer.contains("v2"));
    }

    #[test]
    fn test_extract_json_from_response_with_markdown() {
        let text = "Here is the answer:\n```json\n{\"answer\": \"Yes\", \"follow_up_questions\": []}\n```\n";
        let extracted = extract_json_from_response(text);
        assert!(extracted.is_some());
    }

    #[test]
    fn test_extract_json_from_response_no_json() {
        let text = "Just plain text without JSON";
        assert!(extract_json_from_response(text).is_none());
    }

    #[test]
    fn test_truncate_utf8_basic() {
        assert_eq!(truncate_utf8("hello", 10), "hello");
        assert_eq!(truncate_utf8("hello", 3), "hel");
        assert_eq!(truncate_utf8("hello", 0), "");
    }

    #[test]
    fn test_truncate_utf8_multibyte() {
        // Unicode escapes avoid any file-encoding confusion.
        // "日本語テスト" = U+65E5 U+672C U+30C6 U+30B9 U+30C8 U+30C3 = 18 bytes (3 bytes/char)
        let text = "\u{65e5}\u{672c}\u{30c6}\u{30b9}\u{30c8}\u{30c3}";
        assert_eq!(text.len(), 18);

        // bytes 0-5 (日+本), cut at valid boundary 6 → "日本"
        assert_eq!(truncate_utf8(text, 6), "\u{65e5}\u{672c}");

        // byte 7 is mid-char; backing up to 6 → same result
        assert_eq!(truncate_utf8(text, 7), "\u{65e5}\u{672c}");
        assert_eq!(truncate_utf8(text, 8), "\u{65e5}\u{672c}");

        // byte 9 is valid char boundary (ス starts at 9) → "日本語"
        assert_eq!(truncate_utf8(text, 9), "\u{65e5}\u{672c}\u{30c6}");

        // byte 12 is valid (ト starts at 12) → "日本語テ"
        assert_eq!(truncate_utf8(text, 12), "\u{65e5}\u{672c}\u{30c6}\u{30b9}");

        // text.len() returns full string
        assert_eq!(truncate_utf8(text, text.len()), text);
    }

    #[test]
    fn test_truncate_utf8_emoji() {
        // "👍" is 4 bytes (F0 9F 91 8D)
        let text = "hello 👍 world";
        assert_eq!(truncate_utf8(text, 10), "hello 👍"); // valid
    }
}