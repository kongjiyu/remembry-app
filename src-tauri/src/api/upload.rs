//! HTTP API routes for chunked audio/video/text file uploads.
//!
//! These routes mirror the WebView's upload protocol exactly (5 MB base64 chunks,
//! `start_upload` → N×`append_upload_chunk` → `enqueue_meeting_upload_processing`),
//! so the MCP can drive the existing Rust upload pipeline without any new
//! processing code.
//!
//! All three handlers internally call the same `commands::uploads::*` Tauri
//! commands that the frontend uses. The pipeline (Gemini upload → Groq Whisper
//! transcription → LLM extraction → SQLite persist) is unchanged.

use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

use super::ApiState;

/// Mirror of `commands::uploads::ProcessUploadParams`. Kept here so the HTTP
/// body schema stays decoupled from the internal Rust command struct (lets us
/// version the API independently and ignore new internal fields without
/// breaking callers).
#[derive(Debug, Deserialize)]
pub struct StartUploadBody {
    pub file_name: String,
    pub total_chunks: u32,
}

#[derive(Debug, Deserialize)]
pub struct AppendChunkBody {
    pub upload_id: String,
    pub chunk_index: u32,
    /// Base64-encoded chunk bytes (matches frontend `blobToBase64`).
    pub chunk_data: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ProcessUploadBody {
    pub upload_id: String,
    pub project_id: String,
    pub title: String,
    #[serde(default)]
    pub context: Option<String>,
    /// `audio` | `text` | `video` (default: `audio`).
    pub file_type: String,
    #[serde(default)]
    pub notes_languages: Vec<String>,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default = "default_event_type")]
    pub event_type: String,
    #[serde(default)]
    pub event_tags: Vec<String>,
}

fn default_event_type() -> String {
    "meeting".to_string()
}

#[derive(Debug, Deserialize)]
pub struct GetJobBody {
    pub job_id: String,
}

/// POST /api/upload/start — Begin a chunked upload session.
pub async fn upload_start(
    State(state): State<Arc<ApiState>>,
    Json(body): Json<StartUploadBody>,
) -> Json<Value> {
    *state.last_request.lock().await = std::time::Instant::now();

    let app = state.app.clone();
    let file_name = body.file_name.clone();
    let total_chunks = body.total_chunks;

    // `start_upload` is a sync function but uses the Tauri runtime internally
    // (UploadManager lives in a tokio Mutex). Run on the blocking pool to avoid
    // stalling the Axum reactor.
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::commands::uploads::start_upload(file_name, total_chunks, app)
    })
    .await;

    match result {
        Ok(Ok(resp)) => Json(json!({
            "status": "ok",
            "success": true,
            "upload_id": resp.upload_id,
        })),
        Ok(Err(e)) => Json(json!({
            "status": "error",
            "error": e,
        })),
        Err(e) => Json(json!({
            "status": "error",
            "error": format!("start_upload task panicked: {}", e),
        })),
    }
}

/// POST /api/upload/chunk — Append one base64-encoded chunk.
pub async fn upload_chunk(
    State(state): State<Arc<ApiState>>,
    Json(body): Json<AppendChunkBody>,
) -> Json<Value> {
    *state.last_request.lock().await = std::time::Instant::now();

    let app = state.app.clone();
    let upload_id = body.upload_id.clone();
    let chunk_index = body.chunk_index;
    let chunk_data = body.chunk_data.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::commands::uploads::append_upload_chunk(upload_id, chunk_index, chunk_data, app)
    })
    .await;

    match result {
        Ok(Ok(_)) => Json(json!({ "status": "ok", "success": true })),
        Ok(Err(e)) => Json(json!({ "status": "error", "error": e })),
        Err(e) => Json(json!({
            "status": "error",
            "error": format!("append_upload_chunk task panicked: {}", e),
        })),
    }
}

/// POST /api/upload/process — Finalize the upload and enqueue background
/// processing (Gemini/Groq transcription → LLM extraction → meeting save).
///
/// Returns immediately with a `job_id`. Poll `GET /api/upload/job?job_id=...`
/// to track progress.
pub async fn upload_process(
    State(state): State<Arc<ApiState>>,
    Json(body): Json<ProcessUploadBody>,
) -> Json<Value> {
    *state.last_request.lock().await = std::time::Instant::now();

    // Validate file_type — must be one of the pipeline's accepted values.
    if !["audio", "text", "video"].contains(&body.file_type.as_str()) {
        return Json(json!({
            "status": "error",
            "error": format!("Invalid file_type '{}'. Must be 'audio', 'text', or 'video'.", body.file_type),
        }));
    }

    let app = state.app.clone();
    let upload_id = body.upload_id.clone();
    let params = crate::commands::uploads::ProcessUploadParams {
        project_id: body.project_id.clone(),
        title: body.title.clone(),
        context: body.context.clone(),
        file_type: body.file_type.clone(),
        notes_languages: if body.notes_languages.is_empty() {
            vec!["en".to_string()]
        } else {
            body.notes_languages.clone()
        },
        mime_type: body.mime_type.clone(),
        event_type: body.event_type.clone(),
        event_tags: body.event_tags.clone(),
    };

    // `enqueue_meeting_upload_processing` is a sync function that internally
    // spawns its own background tokio task for processing. Run on the blocking
    // pool so the Axum reactor isn't stalled by SQLite + filesystem I/O.
    let app_for_spawn = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::commands::uploads::enqueue_meeting_upload_processing(
            upload_id, params, app_for_spawn, app,
        )
    })
    .await;

    match result {
        Ok(Ok(resp)) => Json(json!({
            "status": "ok",
            "success": true,
            "job_id": resp.job_id,
            "message": "Upload queued. Poll /api/upload/job?job_id=... to track progress.",
        })),
        Ok(Err(e)) => Json(json!({
            "status": "error",
            "error": e,
        })),
        Err(e) => Json(json!({
            "status": "error",
            "error": format!("enqueue_meeting_upload_processing task panicked: {}", e),
        })),
    }
}

/// GET /api/upload/job?job_id=... — Look up an upload job's current status.
pub async fn upload_job_status(
    State(state): State<Arc<ApiState>>,
    axum::extract::Query(params): axum::extract::Query<GetJobBody>,
) -> Json<Value> {
    *state.last_request.lock().await = std::time::Instant::now();
    let app = state.app.clone();
    let job_id = params.job_id.clone();
    // `get_upload_job` is sync — no AppHandle needed, just look it up in SQLite.
    // Keep `app` clone above to refresh the last_request timestamp + satisfy
    // future expansion if we add WebView emit hooks.
    let _ = app;
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::commands::uploads::get_upload_job(job_id)
    })
    .await;
    match result {
        Ok(Ok(Some(job))) => Json(json!({
            "status": "ok",
            "job": job,
        })),
        Ok(Ok(None)) => Json(json!({
            "status": "error",
            "error": "Job not found",
        })),
        Ok(Err(e)) => Json(json!({
            "status": "error",
            "error": e,
        })),
        Err(e) => Json(json!({
            "status": "error",
            "error": format!("get_upload_job task panicked: {}", e),
        })),
    }
}