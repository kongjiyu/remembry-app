//! Event Knowledge Tauri commands.

use crate::db::{self, EventKnowledge, UploadJobRecord};
use crate::gemini::{GeminiClient, validation};
use crate::secrets;
use crate::commands::uploads::UploadJob;
use chrono::Utc;
use serde::Serialize;
use tauri::{Emitter, AppHandle};
use uuid::Uuid;

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

#[derive(Debug, Serialize)]
pub struct EnqueueExtractionResponse {
    pub job_id: String,
}

/// Enqueue a knowledge extraction job to run in the background.
#[tauri::command]
pub async fn enqueue_event_knowledge_extraction(
    meeting_id: String,
    language: String,
    mode: String,
    app: AppHandle,
) -> Result<EnqueueExtractionResponse, String> {
    let job_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    // Get meeting title for the job display
    let title = db::meetings::get_meeting(&meeting_id)
        .map_err(|e| e.to_string())?
        .map(|m| m.title)
        .unwrap_or_else(|| "Unknown Event".to_string());

    // Determine initial status message based on mode
    let initial_message = if mode == "regenerate" {
        "Queued for knowledge regeneration"
    } else {
        "Queued for knowledge extraction"
    };

    // Create job record
    let record = UploadJobRecord {
        job_id: job_id.clone(),
        status: "queued".to_string(),
        progress: 5,
        message: initial_message.to_string(),
        error: None,
        meeting_id: Some(meeting_id.clone()),
        project_id: String::new(),
        title,
        created_at: now.clone(),
        updated_at: now,
        temp_path: None,
        params_json: None,
        gemini_file_name: None,
        job_type: "knowledge_extraction".to_string(),
    };

    db::upload_jobs::upsert_upload_job(&record)
        .map_err(|e| e.to_string())?;

    // Emit initial queued event
    let job = UploadJob {
        job_id: record.job_id.clone(),
        status: record.status.clone(),
        progress: record.progress,
        message: record.message.clone(),
        error: record.error.clone(),
        meeting_id: record.meeting_id.clone(),
        project_id: record.project_id.clone(),
        title: record.title.clone(),
        created_at: record.created_at.clone(),
        updated_at: record.updated_at.clone(),
        job_type: record.job_type.clone(),
    };
    let _ = app.emit("meeting-upload-progress", &job);

    // Spawn background task
    let job_id_clone = job_id.clone();
    let meeting_id_clone = meeting_id.clone();
    let language_clone = language.clone();
    let mode_clone = mode.clone();
    tauri::async_runtime::spawn(async move {
        process_knowledge_extraction_background(job_id_clone, meeting_id_clone, language_clone, mode_clone, app).await;
    });

    Ok(EnqueueExtractionResponse { job_id })
}

async fn process_knowledge_extraction_background(job_id: String, meeting_id: String, language: String, _mode: String, app: AppHandle) {
    let persist = |status: &str, progress: u8, message: &str, error: Option<String>| {
        let now = Utc::now().to_rfc3339();
        if let Err(e) = db::upload_jobs::update_upload_job_status(&job_id, status, progress, message, error.clone(), Some(meeting_id.clone()), &now) {
            log::error!("[process_knowledge_extraction_background] Failed to persist job status for {}: {}", job_id, e);
        }
        let record = db::upload_jobs::get_upload_job(&job_id);
        let job = record.as_ref().ok().and_then(|r| r.clone()).map(|r| UploadJob {
            job_id: r.job_id,
            status: r.status,
            progress: r.progress,
            message: r.message,
            error: r.error,
            meeting_id: r.meeting_id,
            project_id: r.project_id,
            title: r.title,
            created_at: r.created_at,
            updated_at: r.updated_at,
            job_type: r.job_type,
        });
        if let Some(j) = job {
            let _ = app.emit("meeting-upload-progress", &j);
        }
    };

    // Step 1: extracting_knowledge
    persist("extracting_knowledge", 20, "Extracting knowledge...", None);

    let api_key = match secrets::get_gemini_key() {
        Ok(k) => k,
        Err(e) => {
            persist("failed", 100, "API key error", Some(e.to_string()));
            return;
        }
    };

    if api_key.trim().is_empty() {
        persist("failed", 100, "Gemini API key not configured", Some("Please add your API key in Settings.".to_string()));
        return;
    }

    let meeting = match db::meetings::get_meeting(&meeting_id) {
        Ok(Some(m)) => m,
        Ok(None) => {
            persist("failed", 100, "Meeting not found", Some("The meeting may have been deleted.".to_string()));
            return;
        }
        Err(e) => {
            persist("failed", 100, "Failed to load meeting", Some(e));
            return;
        }
    };

    let transcription_text = match meeting.transcription.as_ref() {
        Some(t) => t.text.clone(),
        None => {
            persist("failed", 100, "No transcription available", Some("Please upload a recording first.".to_string()));
            return;
        }
    };

    let context_str = meeting.context.as_deref().unwrap_or("").to_string();
    let event_type_str = meeting.event_type.as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or("meeting")
        .to_string();
    let empty_tags: Vec<String> = Vec::new();
    let event_tags = meeting.event_tags.as_deref().unwrap_or(&empty_tags).to_vec();

    let client = GeminiClient::new(api_key);

    persist("extracting_knowledge", 50, "Generating knowledge with AI...", None);

    let knowledge = match crate::gemini::extract_event_knowledge(
        &client,
        &transcription_text,
        &context_str,
        &event_type_str,
        &event_tags,
        &language,
    ).await {
        Ok(k) => k,
        Err(e) => {
            persist("failed", 100, "Knowledge extraction failed", Some(format!("Failed to extract event knowledge: {}", e)));
            return;
        }
    };

    persist("saving", 80, "Saving knowledge...", None);

    let repaired = validation::repair_event_knowledge(knowledge);

    if let Err(e) = db::meetings::update_event_knowledge(&meeting_id, &language, &repaired) {
        persist("failed", 100, "Failed to save knowledge", Some(e.to_string()));
        return;
    }

    let _ = db::gemini_key_metadata::increment_usage(LOCAL_USER);

    persist("completed", 100, "Knowledge extracted successfully", None);
}