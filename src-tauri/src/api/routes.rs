use axum::extract::State;
use axum::Json;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::Emitter;

use super::ApiState;

/// GET /api/health — Health check
pub async fn health(State(state): State<Arc<ApiState>>) -> Json<Value> {
    *state.last_request.lock().await = std::time::Instant::now();
    Json(json!({
        "ok": true,
        "version": "0.3.1",
        "app": "remembry"
    }))
}

/// POST /api/record/start — Start recording in the WebView
pub async fn start_recording(State(state): State<Arc<ApiState>>) -> Json<Value> {
    *state.last_request.lock().await = std::time::Instant::now();

    // Check no active recording
    {
        let guard = state.recording.lock().await;
        if guard.is_some() {
            return Json(json!({
                "status": "error",
                "error": "A recording is already in progress"
            }));
        }
    }

    match state.app.emit("start-record", ()) {
        Ok(_) => {
            log::info!("[API] Emitted start-record event to WebView");
            Json(json!({
                "status": "started",
                "message": "Recording triggered in Remembry app"
            }))
        }
        Err(e) => {
            log::error!("[API] Failed to emit start-record: {}", e);
            Json(json!({
                "status": "error",
                "error": format!("Failed to trigger recording: {}", e)
            }))
        }
    }
}

/// GET /api/record/stop — Stop recording in the WebView
pub async fn stop_recording(State(state): State<Arc<ApiState>>) -> Json<Value> {
    *state.last_request.lock().await = std::time::Instant::now();

    // Emit event to WebView to stop recording
    match state.app.emit("stop-record", ()) {
        Ok(_) => {
            log::info!("[API] Emitted stop-record event to WebView");
            Json(json!({
                "status": "stopping",
                "message": "Recording stop triggered. Transcription will begin shortly."
            }))
        }
        Err(e) => {
            log::error!("[API] Failed to emit stop-record: {}", e);
            Json(json!({
                "status": "error",
                "error": format!("Failed to stop recording: {}", e)
            }))
        }
    }
}

/// GET /api/record/status — Check recording status
pub async fn recording_status(State(state): State<Arc<ApiState>>) -> Json<Value> {
    *state.last_request.lock().await = std::time::Instant::now();
    let guard = state.recording.lock().await;
    match guard.as_ref() {
        Some(s) => Json(json!({
            "status": "recording",
            "job_id": s.job_id,
            "title": s.title,
            "started_at_secs": s.started_at.elapsed().as_secs(),
            "audio_path": s.audio_path.to_string_lossy(),
        })),
        None => Json(json!({
            "status": "idle",
            "message": "No active recording"
        })),
    }
}
