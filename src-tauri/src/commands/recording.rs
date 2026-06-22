//! Recording session commands — own the canonical state on the Rust side.

use std::time::Instant;
use tauri::{AppHandle, Manager};
use crate::api::RecordingSession;
use crate::api::ApiState;

#[tauri::command]
pub async fn start_recording_session(
    app: AppHandle,
    title: String,
) -> Result<RecordingSessionDto, String> {
    let state = app.state::<std::sync::Arc<ApiState>>().inner().clone();
    let mut guard = state.recording.lock().await;
    if guard.is_some() {
        return Err("A recording is already in progress".to_string());
    }
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let temp_dir = app_data.join("temp_uploads");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    let job_id = format!("rec_{}", chrono::Utc::now().timestamp_millis());
    let audio_path = temp_dir.join(format!("{}.webm", job_id));
    let session = RecordingSession {
        job_id: job_id.clone(),
        title: title.clone(),
        started_at: Instant::now(),
        audio_path: audio_path.clone(),
    };
    *guard = Some(session.clone());
    Ok(RecordingSessionDto {
        job_id,
        title,
        started_at_ms: chrono::Utc::now().timestamp_millis(),
        audio_path: audio_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn stop_recording_session(
    app: AppHandle,
) -> Result<Option<RecordingSessionDto>, String> {
    let state = app.state::<std::sync::Arc<ApiState>>().inner().clone();
    let mut guard = state.recording.lock().await;
    let taken = guard.take();
    Ok(taken.map(|s| RecordingSessionDto {
        job_id: s.job_id,
        title: s.title,
        started_at_ms: 0,
        audio_path: s.audio_path.to_string_lossy().to_string(),
    }))
}

#[tauri::command]
pub async fn get_recording_state(app: AppHandle) -> Result<Option<RecordingSessionDto>, String> {
    let state = app.state::<std::sync::Arc<ApiState>>().inner().clone();
    let guard = state.recording.lock().await;
    Ok(guard.as_ref().map(|s| RecordingSessionDto {
        job_id: s.job_id.clone(),
        title: s.title.clone(),
        started_at_ms: chrono::Utc::now().timestamp_millis() - s.started_at.elapsed().as_millis() as i64,
        audio_path: s.audio_path.to_string_lossy().to_string(),
    }))
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct RecordingSessionDto {
    pub job_id: String,
    pub title: String,
    pub started_at_ms: i64,
    pub audio_path: String,
}

#[cfg(test)]
mod tests {
    // Recording state logic is tested through the API integration in Commit 4
    // (requires real AppHandle). Unit-test the DTO serialization here:
    use super::*;
    #[test]
    fn dto_serializes() {
        let dto = RecordingSessionDto {
            job_id: "rec_1".into(),
            title: "Test".into(),
            started_at_ms: 1000,
            audio_path: "/tmp/test.webm".into(),
        };
        let json = serde_json::to_string(&dto).unwrap();
        assert!(json.contains("\"job_id\":\"rec_1\""));
        assert!(json.contains("\"title\":\"Test\""));
    }
}
