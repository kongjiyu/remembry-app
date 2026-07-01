pub mod routes;
pub mod upload;

use axum::{Router, routing::{get, post}};
use serde::Serialize;
use std::sync::Arc;
use std::path::PathBuf;
use tokio::sync::Mutex;
use tauri::AppHandle;

/// Active recording session, if any.
#[derive(Debug, Clone)]
pub struct RecordingSession {
    pub job_id: String,
    pub title: String,
    pub started_at: std::time::Instant,
    pub audio_path: PathBuf,
}

/// The most recent recording that finished saving to disk. Populated by
/// `save_audio_blob` after a successful write; cleared by the MCP after
/// the file has been consumed (so the next MCP call doesn't pick up a
/// stale path). Survives the live `recording` slot being cleared, which
/// is the whole point: once the WebView calls `stop_recording_session`
/// the active session is `None`, but the audio file is still on disk
/// at `audio_path` and the MCP can pick it up.
#[derive(Debug, Clone, Serialize)]
pub struct CompletedRecording {
    pub job_id: String,
    pub title: String,
    pub audio_path: String,
    pub completed_at_ms: i64,
}

/// State shared across the HTTP server
pub struct ApiState {
    pub app: AppHandle,
    pub last_request: Arc<Mutex<std::time::Instant>>,
    pub recording: Arc<Mutex<Option<RecordingSession>>>,
    /// Most recent recording that finished flushing to disk. See
    /// `CompletedRecording` for the lifecycle.
    pub last_completed_recording: Arc<Mutex<Option<CompletedRecording>>>,
}

/// Create the Axum router with all API routes
pub fn create_router(state: Arc<ApiState>) -> Router {
    Router::new()
        .route("/api/health", get(routes::health))
        .route("/api/record/start", post(routes::start_recording))
        .route("/api/record/stop", get(routes::stop_recording))
        .route("/api/record/status", get(routes::recording_status))
        .route("/api/record/last", get(routes::last_completed_recording))
        .route("/api/record/last/clear", post(routes::clear_last_completed_recording))
        // Chunked file upload routes — drive the existing Tauri upload pipeline
        // from external clients (MCP, future HTTP-based integrations).
        .route("/api/upload/start", post(upload::upload_start))
        .route("/api/upload/chunk", post(upload::upload_chunk))
        .route("/api/upload/process", post(upload::upload_process))
        .route("/api/upload/job", get(upload::upload_job_status))
        .with_state(state)
        .layer(tower_http::cors::CorsLayer::permissive())
}

pub const API_PORT: u16 = 17890;
pub const IDLE_TIMEOUT_SECS: u64 = 300; // 5 minutes
