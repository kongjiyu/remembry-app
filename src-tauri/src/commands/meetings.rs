//! Meeting Tauri commands.

use crate::db::{self, Meeting};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ListMeetingsResponse {
    pub success: bool,
    pub meetings: Vec<Meeting>,
    pub count: usize,
}

#[derive(Debug, Serialize)]
pub struct GetMeetingResponse {
    pub meeting: Meeting,
}

#[derive(Debug, Serialize)]
pub struct GetMeetingMetadataResponse {
    pub available_languages: Option<Vec<String>>,
    pub default_language: Option<String>,
    pub created_at: Option<String>,
}

#[tauri::command]
pub fn list_meetings(project_id: Option<String>) -> Result<ListMeetingsResponse, String> {
    let meetings = db::meetings::list_meetings(project_id.as_deref())
        .map_err(|e| e.to_string())?;
    let count = meetings.len();
    Ok(ListMeetingsResponse {
        success: true,
        meetings,
        count,
    })
}

#[tauri::command]
pub fn get_meeting(meeting_id: String) -> Result<GetMeetingResponse, String> {
    let meeting = db::meetings::get_meeting(&meeting_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Meeting not found".to_string())?;
    Ok(GetMeetingResponse { meeting })
}

#[tauri::command]
pub fn get_meeting_metadata(meeting_id: String) -> Result<GetMeetingMetadataResponse, String> {
    let meta = db::meetings::get_meeting_metadata(&meeting_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Meeting not found".to_string())?;
    Ok(GetMeetingMetadataResponse {
        available_languages: meta.available_languages,
        default_language: meta.default_language,
        created_at: meta.created_at,
    })
}

#[tauri::command]
pub fn upsert_meeting(meeting: Meeting) -> Result<(), String> {
    db::meetings::upsert_meeting(&meeting).map_err(|e| e.to_string())
}

#[derive(Debug, serde::Serialize)]
pub struct DeleteMeetingResponse {
    pub success: bool,
    pub message: String,
}

#[tauri::command]
pub fn delete_meeting(meeting_id: String) -> Result<DeleteMeetingResponse, String> {
    let deleted = db::meetings::delete_meeting(&meeting_id)
        .map_err(|e| e.to_string())?;
    if deleted {
        Ok(DeleteMeetingResponse {
            success: true,
            message: "Meeting deleted successfully.".to_string(),
        })
    } else {
        Err("Meeting not found".to_string())
    }
}