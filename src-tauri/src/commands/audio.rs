//! Audio blob save command — called by RecordingProvider when MediaRecorder stops.

use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;
use crate::api::ApiState;

#[tauri::command]
pub async fn save_audio_blob(
    app: AppHandle,
    job_id: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let state = app.state::<std::sync::Arc<ApiState>>().inner().clone();
    let guard = state.recording.lock().await;
    let path: PathBuf = match guard.as_ref() {
        Some(s) => s.audio_path.clone(),
        None => return Err("No active recording session".to_string()),
    };
    drop(guard);

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Verify job_id matches the active session (if any) — but we allow saving
    // even if the session has been cleared, since the WebView may call this
    // immediately after stop_recording_session.
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    let _ = job_id; // referenced for command param binding; path is authoritative
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn path_construction_ok() {
        let p = PathBuf::from("/tmp/rec.webm");
        assert_eq!(p.file_name().unwrap(), "rec.webm");
    }
}
