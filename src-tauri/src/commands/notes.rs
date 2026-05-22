//! Notes Tauri commands.

use crate::db::{self, MeetingNotes};
use crate::gemini::GeminiClient;
use crate::secrets;
use serde::Serialize;

const LOCAL_USER: &str = "local_user";

#[derive(Debug, Serialize)]
pub struct GetNotesResponse {
    pub notes: Option<MeetingNotes>,
    pub language: String,
    #[serde(rename = "needsRegeneration")]
    pub needs_regeneration: bool,
}

#[derive(Debug, Serialize)]
pub struct ExtractNotesResponse {
    pub success: bool,
    pub notes: MeetingNotes,
}

#[derive(Debug, Serialize)]
pub struct RegenerateNotesResponse {
    pub success: bool,
    pub notes: MeetingNotes,
    pub language: String,
}

#[tauri::command]
pub fn get_meeting_notes(meeting_id: String, language: String) -> Result<GetNotesResponse, String> {
    let notes = db::meetings::get_meeting_notes(&meeting_id, &language)
        .map_err(|e| e.to_string())?;

    Ok(GetNotesResponse {
        needs_regeneration: notes.is_none(),
        notes,
        language,
    })
}

#[tauri::command]
pub fn update_meeting_notes(meeting_id: String, language: String, notes: MeetingNotes) -> Result<(), String> {
    db::meetings::update_meeting_notes(&meeting_id, &language, &notes)
        .map_err(|e| e.to_string())
}

async fn extract_meeting_notes_impl(
    meeting_id: &str,
    language: &str,
) -> Result<MeetingNotes, String> {
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

    let client = GeminiClient::new(api_key);
    let notes = crate::gemini::extract_meeting_notes(&client, &transcription_text, &context_str, language).await
        .map_err(|e| format!("Failed to generate notes: {}", e))?;

    db::meetings::update_meeting_notes(meeting_id, language, &notes)
        .map_err(|e| e.to_string())?;

    let _ = db::gemini_key_metadata::increment_usage(LOCAL_USER);

    Ok(notes)
}

#[tauri::command]
pub async fn extract_meeting_notes(
    meeting_id: String,
    language: String,
) -> Result<ExtractNotesResponse, String> {
    let notes = extract_meeting_notes_impl(&meeting_id, &language).await?;
    Ok(ExtractNotesResponse { success: true, notes })
}

#[tauri::command]
pub async fn regenerate_meeting_notes(
    meeting_id: String,
    language: String,
) -> Result<RegenerateNotesResponse, String> {
    let notes = extract_meeting_notes_impl(&meeting_id, &language).await?;
    Ok(RegenerateNotesResponse {
        success: true,
        notes,
        language,
    })
}