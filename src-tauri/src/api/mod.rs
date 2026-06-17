pub mod routes;

use axum::{Router, routing::{get, post}};
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::AppHandle;

/// State shared across the HTTP server
pub struct ApiState {
    pub app: AppHandle,
    pub last_request: Arc<Mutex<std::time::Instant>>,
}

/// Create the Axum router with all API routes
pub fn create_router(state: Arc<ApiState>) -> Router {
    Router::new()
        .route("/api/health", get(routes::health))
        .route("/api/record/start", post(routes::start_recording))
        .route("/api/record/stop", get(routes::stop_recording))
        .route("/api/record/status", get(routes::recording_status))
        .with_state(state)
        .layer(tower_http::cors::CorsLayer::permissive())
}

pub const API_PORT: u16 = 17890;
pub const IDLE_TIMEOUT_SECS: u64 = 300; // 5 minutes
