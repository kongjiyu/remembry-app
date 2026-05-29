//! Remembry desktop application library.

mod db;
mod secrets;
mod gemini;
mod uploads;
pub mod commands;

use tauri::Manager;

#[tauri::command]
fn get_app_temp_dir(app: tauri::AppHandle) -> Result<String, String> {
    let path = app.path().temp_dir().map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_app_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Recover interrupted upload jobs and clean up stale resources.
/// 1. Clean local temp files for all interrupted jobs (delete or already-gone = success).
///    Jobs whose local temp file deletion fails are tracked separately and marked cleanup_pending
///    WITHOUT clearing temp_path, keeping cleanup_pending retryable.
/// 2. Clean Gemini remote files for jobs that reached Gemini upload.
///    Clear gemini_file_name after confirmed deletion.
/// 3. Mark all jobs terminal as failed.
/// Jobs with meeting_id already set are marked completed once all resources are cleaned.
async fn recover_upload_jobs_with_gemini_cleanup(_app: &tauri::AppHandle) {
    use crate::db::upload_jobs::{self, list_interrupted_jobs, clear_gemini_file_name, clear_temp_path};

    let all_jobs = match list_interrupted_jobs() {
        Ok(jobs) => jobs,
        Err(e) => {
            log::error!("[recovery] Failed to list interrupted jobs: {}", e);
            return;
        }
    };

    if all_jobs.is_empty() {
        return;
    }

    log::info!("[recovery] Found {} interrupted job(s)", all_jobs.len());

    // Step 1: clean local temp files for ALL interrupted jobs
    // Track jobs whose temp file deletion FAILED so we skip them from terminalization
    let mut stuck_job_ids = std::collections::HashSet::new();
    for job in &all_jobs {
        if let Some(ref tp) = job.temp_path {
            let path = std::path::PathBuf::from(tp);
            if path.exists() {
                match std::fs::remove_file(&path) {
                    Ok(_) => {
                        log::info!("[recovery] Removed stale local file: {}", tp);
                    }
                    Err(e) => {
                        log::warn!("[recovery] Failed to remove local file {}: {}", tp, e);
                        // File is stuck — leave temp_path set, mark cleanup_pending, exclude from terminalization
                        stuck_job_ids.insert(job.job_id.clone());
                        let _ = db::upload_jobs::mark_job_cleanup_pending(
                            &job.job_id,
                            "Upload interrupted. Local temp file cleanup failed.",
                            Some(e.to_string()),
                            job.meeting_id.clone(),
                        );
                        continue;
                    }
                }
            }
            // File already gone or never existed — treat as successfully cleaned
            if let Err(e) = clear_temp_path(&job.job_id) {
                log::warn!("[recovery] Failed to clear temp_path for job {}: {}", job.job_id, e);
            }
        }
    }

    // Jobs that never reached Gemini upload AND are not stuck — mark failed directly
    let no_gemini_jobs: Vec<_> = all_jobs.iter()
        .filter(|j| j.gemini_file_name.as_deref().map_or(true, |n| n.is_empty()))
        .filter(|j| !stuck_job_ids.contains(&j.job_id))
        .collect();

    // Mark no-gemini jobs failed
    if !no_gemini_jobs.is_empty() {
        let now = chrono::Utc::now().to_rfc3339();
        for job in &no_gemini_jobs {
            // Clear temp_path before terminalizing
            let _ = clear_temp_path(&job.job_id);
            let intended = if job.meeting_id.is_some() { "completed" } else { "failed" };
            let message = if job.meeting_id.is_some() {
                "Upload completed before interruption."
            } else {
                "Upload interrupted before completion. Please upload again."
            };
            let _ = upload_jobs::update_upload_job_status(
                &job.job_id, intended, 100, message, None, job.meeting_id.clone(), &now,
            );
        }
        log::info!("[recovery] Marked {} job(s) terminal (no Gemini file)", no_gemini_jobs.len());
    }

    // Jobs that reached Gemini upload AND are not stuck — attempt remote cleanup
    let gemini_jobs: Vec<_> = all_jobs.iter()
        .filter(|j| j.gemini_file_name.as_deref().map_or(false, |n| !n.is_empty()))
        .filter(|j| !stuck_job_ids.contains(&j.job_id))
        .collect();

    // Handle gemini-file jobs — attempt remote cleanup
    if gemini_jobs.is_empty() {
        return;
    }

    log::info!("[recovery] Found {} interrupted job(s) with stale Gemini remote files", gemini_jobs.len());

    let api_key = match secrets::get_gemini_key() {
        Ok(k) => k,
        Err(e) => {
            log::warn!("[recovery] Gemini API key not available: {}. Marking {} gemini-file job(s) cleanup_pending.", e, gemini_jobs.len());
            for job in &gemini_jobs {
                let _ = upload_jobs::mark_job_cleanup_pending(
                    &job.job_id,
                    "Upload interrupted. Gemini API key unavailable — remote file cleanup deferred.",
                    Some(format!("{} (cleanup deferred: {})", job.error.as_deref().unwrap_or("interrupted"), e)),
                    job.meeting_id.clone(),
                );
            }
            return;
        }
    };

    let client = crate::gemini::GeminiClient::new(api_key);

    for job in &gemini_jobs {
        let gemini_file_name = job.gemini_file_name.as_deref().unwrap();
        log::info!("[recovery] Attempting to delete stale Gemini file '{}' for job {}", gemini_file_name, job.job_id);
        let now = chrono::Utc::now().to_rfc3339();

        match crate::gemini::delete_file(&client, gemini_file_name).await {
            Ok(_) => {
                log::info!("[recovery] Deleted stale Gemini file '{}'", gemini_file_name);
                if let Err(e) = clear_gemini_file_name(&job.job_id) {
                    log::warn!("[recovery] Failed to clear gemini_file_name for job {}: {}", job.job_id, e);
                }
                // Transition to terminal state: completed if meeting_id exists, else failed
                let intended = if job.meeting_id.is_some() { "completed" } else { "failed" };
                let message = if job.meeting_id.is_some() {
                    "Upload completed before interruption."
                } else {
                    "Upload interrupted before completion. Please upload again."
                };
                let _ = upload_jobs::update_upload_job_status(
                    &job.job_id, intended, 100, message,
                    Some("Stale Gemini remote file cleaned up.".to_string()),
                    job.meeting_id.clone(), &now,
                );
            }
            Err(e) => {
                log::warn!("[recovery] Failed to delete Gemini file '{}': {}. Job set to cleanup_pending.", gemini_file_name, e);
                // Keep gemini_file_name for visibility; set cleanup_pending so it will be retried
                let _ = upload_jobs::mark_job_cleanup_pending(
                    &job.job_id,
                    "Upload interrupted. Remote file cleanup failed.",
                    Some(format!("{} (cleanup failed: {})", job.error.as_deref().unwrap_or("interrupted"), e)),
                    job.meeting_id.clone(),
                );
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    log::info!("Starting Remembry desktop application");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_app_temp_dir,
            get_app_data_dir,
            commands::projects::list_projects,
            commands::projects::create_project,
            commands::projects::delete_project,
            commands::projects::get_project,
            commands::meetings::list_meetings,
            commands::meetings::get_meeting,
            commands::meetings::get_meeting_metadata,
            commands::meetings::upsert_meeting,
            commands::meetings::delete_meeting,
            commands::notes::get_meeting_notes,
            commands::notes::update_meeting_notes,
            commands::notes::extract_meeting_notes,
            commands::notes::regenerate_meeting_notes,
            commands::gemini_key::get_gemini_key_status,
            commands::gemini_key::save_gemini_key,
            commands::gemini_key::delete_gemini_key,
            commands::uploads::start_upload,
            commands::uploads::append_upload_chunk,
            commands::uploads::process_meeting_upload,
            commands::uploads::cancel_upload,
            commands::uploads::enqueue_meeting_upload_processing,
            commands::uploads::list_upload_jobs,
            commands::uploads::get_upload_job,
            commands::uploads::dismiss_upload_job,
            commands::uploads::cancel_upload_job,
            commands::events::get_event_knowledge,
            commands::events::update_event_knowledge,
            commands::events::extract_event_knowledge,
            commands::events::regenerate_event_knowledge,
            commands::events::enqueue_event_knowledge_extraction,
            commands::ask::ask_question,
        ])
        .setup(|app| {
            // Initialize database
            let app_data_dir = app.path().app_data_dir().map_err(|e| {
                log::error!("Failed to get app data dir: {}", e);
                e
            })?;
            log::info!("App data directory: {:?}", app_data_dir);

            db::init_db(&app_data_dir).map_err(|e| {
                log::error!("Failed to initialize database: {}", e);
                anyhow::anyhow!("{}", e)
            })?;

            // Clean up stale Gemini remote files from interrupted jobs BEFORE marking them failed
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                recover_upload_jobs_with_gemini_cleanup(&app_handle).await;
            });

            log::info!("Remembry setup complete");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
