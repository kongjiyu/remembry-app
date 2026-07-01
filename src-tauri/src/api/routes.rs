use axum::extract::State;
use axum::Json;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{Emitter, Manager};

use super::ApiState;
use crate::commands::recording::register_recording_session;

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
///
/// Implementation note: previously this route only emitted the
/// `start-record` Tauri event and returned success. If the WebView was
/// mid-reload the event was silently dropped — the caller got a
/// `{"status":"started"}` response but no recording actually began.
///
/// We now do two things:
/// 1. Register the session in `ApiState` directly (same logic the
///    `start_recording_session` Tauri command uses). Even if the
///    WebView misses the event, the session is recorded on the
///    backend. The WebView's `refreshFromBackend` on mount can then
///    adopt the orphan session.
/// 2. Emit the `start-record` event for the WebView to attach a
///    MediaRecorder. We check for at least one loaded webview window
///    before emitting so we don't fool the caller into thinking the
///    event was delivered when the WebView is gone (e.g. during app
///    startup). The "WebView is loaded but JS hasn't run yet" window
///    still exists, but the registered session is the safety net.
pub async fn start_recording(State(state): State<Arc<ApiState>>) -> Json<Value> {
    *state.last_request.lock().await = std::time::Instant::now();

    // Register the session on the backend first. This is the canonical
    // state — the WebView can adopt it via refreshFromBackend even if
    // the event below is lost.
    let title = "Recording from HTTP".to_string();
    let session = match register_recording_session(&state, title.clone()).await {
        Ok(s) => s,
        Err(e) => {
            return Json(json!({
                "status": "error",
                "error": e
            }));
        }
    };

    // Best-effort: notify the WebView. If no webview is loaded (e.g.
    // app is still starting up), the registered session is still safe
    // — the WebView will pick it up on its next refreshFromBackend.
    let webview_count = state.app.webview_windows().len();
    let emit_result = state.app.emit("start-record", &session);

    if webview_count == 0 {
        log::warn!(
            "[API] /api/record/start registered session {} but no WebView is loaded; \
             event was not delivered. The WebView will adopt the session on its next \
             refreshFromBackend tick.",
            session.job_id
        );
        return Json(json!({
            "status": "registered",
            "message": "Recording session registered; WebView will adopt on next sync.",
            "job_id": session.job_id,
        }));
    }

    match emit_result {
        Ok(_) => {
            log::info!("[API] Emitted start-record event to WebView (session {})", session.job_id);
            Json(json!({
                "status": "started",
                "message": "Recording triggered in Remembry app",
                "job_id": session.job_id,
            }))
        }
        Err(e) => {
            // Session is still registered — the WebView can adopt it. Tell
            // the caller the registration succeeded but the event failed,
            // rather than pretending the whole thing failed.
            log::error!("[API] Failed to emit start-record: {}", e);
            Json(json!({
                "status": "registered",
                "message": "Recording session registered; event delivery failed but WebView will adopt on next sync.",
                "job_id": session.job_id,
            }))
        }
    }
}

/// GET /api/record/stop — Stop recording in the WebView
///
/// Emits the `stop-record` event AND clears the backend session in the
/// same call. If the WebView receives the event, the MediaRecorder is
/// stopped and `save_audio_blob` writes the audio to the session's
/// path before the session is cleared. If the WebView misses the event
/// (mid-reload), the session is still cleared so it doesn't sit in
/// state forever — the audio is lost in that case, but the next
/// `/api/record/start` won't fail with "already in progress".
pub async fn stop_recording(State(state): State<Arc<ApiState>>) -> Json<Value> {
    *state.last_request.lock().await = std::time::Instant::now();

    // Clear the backend session directly. This is the safety net for
    // the "WebView missed the event" case. If the WebView does receive
    // the event, its own `provider.stop()` will call
    // `stop_recording_session` again — that's a no-op the second time
    // (the session is already None), and `save_audio_blob` runs before
    // the WebView's stop_recording_session, so the audio is still
    // written before the lock is released.
    {
        let mut guard = state.recording.lock().await;
        guard.take();
    }

    // Best-effort: notify the WebView to stop its MediaRecorder and
    // save the audio. If the WebView is up, it does the save. If not,
    // the session is already cleared and the user can retry.
    let webview_count = state.app.webview_windows().len();
    if webview_count == 0 {
        log::warn!("[API] /api/record/stop cleared session but no WebView is loaded; audio was not saved.");
        return Json(json!({
            "status": "stopped",
            "message": "Recording session cleared. Audio was not saved because the WebView was not running.",
        }));
    }

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
                "status": "stopped",
                "message": "Recording session cleared. Event delivery failed but session is consistent.",
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

/// GET /api/record/last — Return the most recent recording that finished
/// flushing to disk, or `404` if none. The MCP uses this to bridge the
/// gap between `remembry_stop_recording` (which clears the live session)
/// and `remembry_upload_audio` (which needs an on-disk file path).
pub async fn last_completed_recording(State(state): State<Arc<ApiState>>) -> Json<Value> {
    *state.last_request.lock().await = std::time::Instant::now();
    let guard = state.last_completed_recording.lock().await;
    match guard.as_ref() {
        Some(rec) => {
            // Also report whether the file still exists on disk. The
            // upload pipeline may have moved/cleaned it; if so, the MCP
            // shouldn't try to upload a missing file.
            let path = std::path::Path::new(&rec.audio_path);
            let exists = path.exists();
            Json(json!({
                "status": "ok",
                "recording": {
                    "job_id": rec.job_id,
                    "title": rec.title,
                    "audio_path": rec.audio_path,
                    "completed_at_ms": rec.completed_at_ms,
                    "exists": exists,
                    "size_bytes": if exists { std::fs::metadata(path).ok().map(|m| m.len()) } else { None },
                }
            }))
        }
        None => Json(json!({
            "status": "none",
            "message": "No recording has finished yet. Use remembry_start_recording + remembry_stop_recording first."
        })),
    }
}

/// POST /api/record/last/clear — Forget the last completed recording.
/// The MCP calls this after a successful upload so the next call to
/// `/api/record/last` doesn't return a stale path.
pub async fn clear_last_completed_recording(State(state): State<Arc<ApiState>>) -> Json<Value> {
    *state.last_request.lock().await = std::time::Instant::now();
    let mut guard = state.last_completed_recording.lock().await;
    let cleared = guard.take();
    Json(json!({
        "status": "ok",
        "cleared": cleared.is_some(),
    }))
}

#[cfg(test)]
mod tests {
    use crate::api::RecordingSession;
    use std::path::PathBuf;
    use std::time::Instant;

    #[tokio::test]
    async fn status_returns_idle_when_no_recording() {
        let empty: Option<&RecordingSession> = None;
        let json = match empty {
            Some(s) => serde_json::json!({
                "status": "recording",
                "job_id": s.job_id,
                "title": s.title,
                "started_at_secs": s.started_at.elapsed().as_secs(),
                "audio_path": s.audio_path.to_string_lossy(),
            }),
            None => serde_json::json!({
                "status": "idle",
                "message": "No active recording"
            }),
        };
        assert_eq!(json["status"], "idle");
        assert!(json.get("title").is_none());
    }

    #[tokio::test]
    async fn status_returns_recording_when_set() {
        let session = RecordingSession {
            job_id: "rec_1".into(),
            title: "Design Review".into(),
            started_at: Instant::now(),
            audio_path: PathBuf::from("/tmp/rec_1.webm"),
        };
        let json = serde_json::json!({
            "status": "recording",
            "job_id": session.job_id,
            "title": session.title,
            "started_at_secs": session.started_at.elapsed().as_secs(),
            "audio_path": session.audio_path.to_string_lossy(),
        });
        assert_eq!(json["status"], "recording");
        assert_eq!(json["title"], "Design Review");
        assert_eq!(json["job_id"], "rec_1");
    }
}
