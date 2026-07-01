//! Audio blob save command — called by RecordingProvider when MediaRecorder stops.

use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;
use crate::api::{ApiState, CompletedRecording};

#[tauri::command]
pub async fn save_audio_blob(
    app: AppHandle,
    job_id: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let state = app.state::<std::sync::Arc<ApiState>>().inner().clone();

    // Read the session's title and audio path while holding the lock.
    // The WebView's onstop calls this right before it calls
    // stop_recording_session, so the session is still registered.
    let (title, path): (String, PathBuf) = {
        let guard = state.recording.lock().await;
        match guard.as_ref() {
            Some(s) if s.job_id == job_id => (s.title.clone(), s.audio_path.clone()),
            Some(s) => {
                return Err(format!(
                    "Recording session mismatch: caller passed job_id={} but the active session is {}",
                    job_id, s.job_id
                ));
            }
            None => return Err("No active recording session".to_string()),
        }
    };

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;

    // Hand the file off to anything listening on the HTTP API (notably
    // the MCP server, which can now pick up the path via
    // /api/record/last and stream it through the chunked-upload
    // pipeline). Stored after the write so a failed write doesn't
    // advertise a non-existent file.
    let path_str = path.to_string_lossy().to_string();
    {
        let mut last = state.last_completed_recording.lock().await;
        *last = Some(CompletedRecording {
            job_id: job_id.clone(),
            title,
            audio_path: path_str.clone(),
            completed_at_ms: chrono::Utc::now().timestamp_millis(),
        });
    }

    Ok(path_str)
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
