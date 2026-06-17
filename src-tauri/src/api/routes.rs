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

    // Emit event to WebView to start recording
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

    // Emit event to WebView to get status, return placeholder for now
    // The WebView will update its own state; this endpoint is for MCP to poll
    Json(json!({
        "status": "idle",
        "message": "Use /api/record/start to begin recording"
    }))
}
