//! Chunked file upload staging for Tauri desktop.

mod session;

pub use session::{UploadSession, UploadManager};

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

#[allow(dead_code)]
const MAX_CHUNK_SIZE_BYTES: usize = 5 * 1024 * 1024; // 5MB
const MAX_UPLOAD_SESSIONS: usize = 10;

pub struct UploadState {
    sessions: HashMap<String, UploadSession>,
    upload_dir: PathBuf,
}

#[allow(dead_code)]
pub type UploadStateHandle = Arc<Mutex<UploadState>>;

impl UploadState {
    pub fn new(upload_dir: PathBuf) -> Self {
        std::fs::create_dir_all(&upload_dir).ok();
        Self {
            sessions: HashMap::new(),
            upload_dir,
        }
    }

    pub fn create_session(&mut self, file_name: &str, total_chunks: u32) -> Result<String, String> {
        if self.sessions.len() >= MAX_UPLOAD_SESSIONS {
            return Err("Too many concurrent upload sessions".to_string());
        }

        let upload_id = Uuid::new_v4().to_string();
        let session = UploadSession::new(&upload_id, file_name, total_chunks, &self.upload_dir)?;
        log::info!(
            "[UploadState] create_session id={} file={} chunks={} dir={} active={}",
            upload_id,
            file_name,
            total_chunks,
            self.upload_dir.display(),
            self.sessions.len() + 1
        );
        self.sessions.insert(upload_id.clone(), session);
        Ok(upload_id)
    }

    #[allow(dead_code)]
    pub fn get_session(&self, upload_id: &str) -> Option<&UploadSession> {
        self.sessions.get(upload_id)
    }

    pub fn get_session_mut(&mut self, upload_id: &str) -> Option<&mut UploadSession> {
        self.sessions.get_mut(upload_id)
    }

    pub fn remove_session(&mut self, upload_id: &str) -> Option<UploadSession> {
        log::info!(
            "[UploadState] remove_session id={} remaining={}",
            upload_id,
            self.sessions.len().saturating_sub(1)
        );
        self.sessions.remove(upload_id)
    }

    pub fn has_session(&self, upload_id: &str) -> bool {
        self.sessions.contains_key(upload_id)
    }

    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }

    pub fn session_ids(&self) -> Vec<String> {
        self.sessions.keys().cloned().collect()
    }
}