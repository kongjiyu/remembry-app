//! Event Knowledge Tauri commands.

use crate::db::{self, EventKnowledge};
use crate::gemini::{GeminiClient, validation};
use crate::secrets;
use serde::Serialize;

const LOCAL_USER: &str = "local_user";

#[derive(Debug, Serialize)]
pub struct GetEventKnowledgeResponse {
    pub knowledge: Option<EventKnowledge>,
    pub language: String,
    #[serde(rename = "needsRegeneration")]
    pub needs_regeneration: bool,
}

#[derive(Debug, Serialize)]
pub struct ExtractEventKnowledgeResponse {
    pub success: bool,
    pub knowledge: EventKnowledge,
}

#[derive(Debug, Serialize)]
pub struct RegenerateEventKnowledgeResponse {
    pub success: bool,
    pub knowledge: EventKnowledge,
    pub language: String,
}

#[tauri::command]
pub fn get_event_knowledge(meeting_id: String, language: String) -> Result<GetEventKnowledgeResponse, String> {
    let knowledge = db::meetings::get_event_knowledge(&meeting_id, &language)
        .map_err(|e| e.to_string())?;

    Ok(GetEventKnowledgeResponse {
        needs_regeneration: knowledge.is_none(),
        knowledge,
        language,
    })
}

#[tauri::command]
pub fn update_event_knowledge(
    meeting_id: String,
    language: String,
    knowledge: EventKnowledge,
) -> Result<(), String> {
    let repaired = validation::repair_event_knowledge(knowledge);
    db::meetings::update_event_knowledge(&meeting_id, &language, &repaired)
        .map_err(|e| e.to_string())
}

async fn extract_event_knowledge_impl(
    meeting_id: &str,
    language: &str,
) -> Result<EventKnowledge, String> {
    let api_key = secrets::get_gemini_key()
        .map_err(|e| format!("Gemini API key not found. Please add your API key in Settings. Error: {}", e))?;

    let meeting = db::meetings::get_meeting(meeting_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Meeting not found".to_string())?;

    let transcription_text = meeting.transcription
        .as_ref()
        .ok_or_else(|| "No transcription text available".to_string())?
        .text.clone();

    let context_str = meeting.context.as_deref().unwrap_or("").to_string();

    let event_type_str = meeting.event_type.as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or("meeting")
        .to_string();

    let empty_tags: Vec<String> = Vec::new();
    let event_tags = meeting.event_tags.as_deref().unwrap_or(&empty_tags).to_vec();

    let client = GeminiClient::new(api_key);
    let knowledge = crate::gemini::extract_event_knowledge(
        &client,
        &transcription_text,
        &context_str,
        &event_type_str,
        &event_tags,
        language,
    ).await
        .map_err(|e| format!("Failed to extract event knowledge: {}", e))?;

    let repaired = validation::repair_event_knowledge(knowledge);

    db::meetings::update_event_knowledge(meeting_id, language, &repaired)
        .map_err(|e| e.to_string())?;

    let _ = db::gemini_key_metadata::increment_usage(LOCAL_USER);

    Ok(repaired)
}

#[tauri::command]
pub async fn extract_event_knowledge(
    meeting_id: String,
    language: String,
) -> Result<ExtractEventKnowledgeResponse, String> {
    let repaired = extract_event_knowledge_impl(&meeting_id, &language).await?;
    Ok(ExtractEventKnowledgeResponse {
        success: true,
        knowledge: repaired,
    })
}

#[tauri::command]
pub async fn regenerate_event_knowledge(
    meeting_id: String,
    language: String,
) -> Result<RegenerateEventKnowledgeResponse, String> {
    let repaired = extract_event_knowledge_impl(&meeting_id, &language).await?;
    Ok(RegenerateEventKnowledgeResponse {
        success: true,
        knowledge: repaired,
        language,
    })
}