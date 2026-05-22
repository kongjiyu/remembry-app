//! Tauri command registration and error types.

pub mod projects;
pub mod meetings;
pub mod notes;
pub mod gemini_key;
pub mod uploads;
pub mod events;
pub mod ask;

#[cfg(test)]
pub mod tests;

pub use crate::db::gemini_key_metadata;
pub use crate::db::Meeting;
pub use crate::db::Project;

const LOCAL_USER: &str = "local_user";

use thiserror::Error;

#[derive(Error, Debug)]
pub enum CommandError {
    #[error("{0}")]
    User(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("database error: {0}")]
    Database(String),
    #[error("Gemini API error: {0}")]
    GeminiApi(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl From<String> for CommandError {
    fn from(s: String) -> Self {
        CommandError::User(s)
    }
}

impl From<&str> for CommandError {
    fn from(s: &str) -> Self {
        CommandError::User(s.to_string())
    }
}

impl serde::Serialize for CommandError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<CommandError> for (u16, String) {
    fn from(err: CommandError) -> Self {
        match err {
            CommandError::User(_) => (400, err.to_string()),
            CommandError::NotFound(_) => (404, err.to_string()),
            CommandError::Database(_) => (500, err.to_string()),
            CommandError::GeminiApi(_) => (502, err.to_string()),
            CommandError::Network(_) => (503, err.to_string()),
            CommandError::Internal(_) => (500, err.to_string()),
        }
    }
}