//! Groq API key Tauri commands.
//!
//! Mirrors the structure of `gemini_key.rs` but stores the key under a
//! distinct keyring user label (`groq_local_user`) so the two providers
//! can coexist without collision.

use crate::secrets::{self, mask_key};
use serde::Serialize;

const LOCAL_USER: &str = crate::commands::LOCAL_USER;

#[derive(Debug, Serialize)]
pub struct GetGroqKeyStatusResponse {
    #[serde(rename = "hasKey")]
    pub has_key: bool,
    #[serde(rename = "maskedKey")]
    pub masked_key: Option<String>,
    #[serde(rename = "keyPrefix")]
    pub key_prefix: Option<String>,
    #[serde(rename = "keySuffix")]
    pub key_suffix: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SaveGroqKeyResponse {
    pub success: bool,
}

#[derive(Debug, Serialize)]
pub struct DeleteGroqKeyResponse {
    pub success: bool,
}

#[tauri::command]
pub fn get_groq_key_status() -> Result<GetGroqKeyStatusResponse, String> {
    let api_key = match secrets::get_groq_key() {
        Ok(api_key) if !api_key.trim().is_empty() => api_key,
        Ok(_) | Err(secrets::SecretsError::NotFound) => {
            return Ok(GetGroqKeyStatusResponse {
                has_key: false,
                masked_key: None,
                key_prefix: None,
                key_suffix: None,
            });
        }
        Err(e) => return Err(e.to_string()),
    };
    let (masked, prefix, suffix) = mask_key(&api_key);

    Ok(GetGroqKeyStatusResponse {
        has_key: true,
        masked_key: masked,
        key_prefix: prefix,
        key_suffix: suffix,
    })
}

#[tauri::command]
pub fn save_groq_key(api_key: String) -> Result<SaveGroqKeyResponse, String> {
    let trimmed_key = api_key.trim();
    if trimmed_key.is_empty() {
        return Err("Groq API key cannot be empty".to_string());
    }

    secrets::save_groq_key(trimmed_key).map_err(|e| e.to_string())?;
    // Read it back to confirm the credential store accepted the write.
    let stored_key = secrets::get_groq_key()
        .map_err(|e| format!("Groq API key was saved but could not be read back: {}", e))?;

    if stored_key.trim().is_empty() {
        return Err("Groq API key was saved but read back as empty".to_string());
    }

    Ok(SaveGroqKeyResponse { success: true })
}

#[tauri::command]
pub fn delete_groq_key() -> Result<DeleteGroqKeyResponse, String> {
    match secrets::delete_groq_key() {
        Ok(()) => Ok(DeleteGroqKeyResponse { success: true }),
        Err(secrets::SecretsError::NotFound) => Ok(DeleteGroqKeyResponse { success: true }),
        Err(e) => Err(e.to_string()),
    }
}

// `LOCAL_USER` re-export keeps the import line terse even though we don't
// currently use it — we may surface per-user metadata for Groq in a future pass.
#[allow(dead_code)]
fn _user_marker() -> &'static str {
    LOCAL_USER
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_groq_key_status_shape_when_missing() {
        // We can't easily exercise the real Tauri command without a credential
        // store, but we can verify the response shape is consistent.
        let resp = GetGroqKeyStatusResponse {
            has_key: false,
            masked_key: None,
            key_prefix: None,
            key_suffix: None,
        };
        assert!(!resp.has_key);
        assert!(resp.masked_key.is_none());

        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("\"hasKey\":false"));
        assert!(json.contains("\"maskedKey\":null"));
    }

    #[test]
    fn save_and_delete_response_shape() {
        let save = SaveGroqKeyResponse { success: true };
        assert_eq!(serde_json::to_string(&save).unwrap(), "{\"success\":true}");

        let del = DeleteGroqKeyResponse { success: true };
        assert_eq!(serde_json::to_string(&del).unwrap(), "{\"success\":true}");
    }
}