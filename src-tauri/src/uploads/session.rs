//! Upload session state machine.

use std::path::PathBuf;
use std::fs::OpenOptions;
use std::io::Write;
use thiserror::Error;

const MAX_CHUNK_SIZE_BYTES: usize = 5 * 1024 * 1024; // 5MB

#[derive(Error, Debug)]
pub enum UploadError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid chunk: {0}")]
    InvalidChunk(String),
    #[allow(dead_code)]
    #[error("upload session not found")]
    NotFound,
    #[error("session already finalized")]
    AlreadyFinalized,
}

pub struct UploadSession {
    #[allow(dead_code)]
    upload_id: String,
    #[allow(dead_code)]
    file_name: String,
    total_chunks: u32,
    received_chunks: Vec<bool>,
    temp_path: PathBuf,
    finalized: bool,
}

impl UploadSession {
    pub fn new(upload_id: &str, file_name: &str, total_chunks: u32, upload_dir: &PathBuf) -> Result<Self, String> {
        // Use safe internal temp path — never the user-provided file_name directly.
        // This prevents filesystem errors from titles with Windows-invalid chars (/ \ : * ? " < > |)
        let temp_path = upload_dir.join(format!("{}.upload", upload_id));
        let received_chunks = vec![false; total_chunks as usize];

        Ok(Self {
            upload_id: upload_id.to_string(),
            file_name: file_name.to_string(),
            total_chunks,
            received_chunks,
            temp_path,
            finalized: false,
        })
    }

    pub fn append_chunk(&mut self, chunk_index: u32, data: &[u8]) -> Result<(), UploadError> {
        if self.finalized {
            return Err(UploadError::AlreadyFinalized);
        }

        if chunk_index >= self.total_chunks {
            return Err(UploadError::InvalidChunk(format!(
                "chunk index {} exceeds total chunks {}",
                chunk_index, self.total_chunks
            )));
        }

        if data.len() > MAX_CHUNK_SIZE_BYTES {
            return Err(UploadError::InvalidChunk(format!(
                "chunk size {} exceeds max {}",
                data.len(), MAX_CHUNK_SIZE_BYTES
            )));
        }

        // Reject duplicate chunks (unless bytes match, which would indicate a retry bug)
        if self.received_chunks[chunk_index as usize] {
            return Err(UploadError::InvalidChunk(format!(
                "chunk {} already received",
                chunk_index
            )));
        }

        // Seek to chunk offset and write at correct position
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .open(&self.temp_path)?;

        use std::io::Seek;
        let offset = chunk_index as u64 * MAX_CHUNK_SIZE_BYTES as u64;
        file.seek(std::io::SeekFrom::Start(offset))?;
        file.write_all(data)?;
        file.flush()?;
        self.received_chunks[chunk_index as usize] = true;

        Ok(())
    }

    pub fn is_complete(&self) -> bool {
        self.received_chunks.iter().all(|&received| received)
    }

    pub fn finalize(mut self) -> Result<PathBuf, UploadError> {
        self.finalized = true;
        if !self.is_complete() {
            return Err(UploadError::InvalidChunk("Not all chunks received".to_string()));
        }
        Ok(self.temp_path)
    }

    pub fn cancel(self) -> Result<(), UploadError> {
        if self.temp_path.exists() {
            std::fs::remove_file(&self.temp_path)?;
        }
        Ok(())
    }

    #[allow(dead_code)]
    pub fn temp_path(&self) -> &PathBuf {
        &self.temp_path
    }

    #[allow(dead_code)]
    pub fn file_name(&self) -> &str {
        &self.file_name
    }

    #[allow(dead_code)]
    pub fn upload_id(&self) -> &str {
        &self.upload_id
    }
}

pub struct UploadManager {
    state: std::sync::Arc<std::sync::Mutex<super::UploadState>>,
}

impl UploadManager {
    pub fn new(upload_dir: PathBuf) -> Self {
        Self {
            state: std::sync::Arc::new(std::sync::Mutex::new(super::UploadState::new(upload_dir))),
        }
    }

    pub fn start_upload(&self, file_name: &str, total_chunks: u32) -> Result<String, String> {
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        state.create_session(file_name, total_chunks)
    }

    pub fn append_chunk(&self, upload_id: &str, chunk_index: u32, chunk_data: &[u8]) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        let session = state.get_session_mut(upload_id)
            .ok_or_else(|| "Upload session not found".to_string())?;
        session.append_chunk(chunk_index, chunk_data)
            .map_err(|e| e.to_string())
    }

    pub fn process_upload(&self, upload_id: &str) -> Result<PathBuf, String> {
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        let session = state.remove_session(upload_id)
            .ok_or_else(|| "Upload session not found".to_string())?;
        session.finalize().map_err(|e| e.to_string())
    }

    pub fn cancel_upload(&self, upload_id: &str) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        if let Some(session) = state.remove_session(upload_id) {
            session.cancel().map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn has_session(&self, upload_id: &str) -> bool {
        if let Ok(state) = self.state.lock() {
            state.has_session(upload_id)
        } else {
            false
        }
    }

    pub fn session_count(&self) -> usize {
        self.state.lock().map(|s| s.session_count()).unwrap_or(0)
    }

    pub fn session_ids(&self) -> Vec<String> {
        self.state.lock().map(|s| s.session_ids()).unwrap_or_default()
    }
}