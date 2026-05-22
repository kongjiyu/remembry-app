//! Gemini key Tauri commands.

use crate::commands::gemini_key_metadata;
use crate::secrets::{self, mask_key};
use serde::Serialize;

const LOCAL_USER: &str = crate::commands::LOCAL_USER;

#[derive(Debug, Serialize)]
pub struct GetGeminiKeyStatusResponse {
    #[serde(rename = "hasKey")]
    pub has_key: bool,
    #[serde(rename = "maskedKey")]
    pub masked_key: Option<String>,
    #[serde(rename = "keyPrefix")]
    pub key_prefix: Option<String>,
    #[serde(rename = "keySuffix")]
    pub key_suffix: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: Option<String>,
    #[serde(rename = "lastUsed")]
    pub last_used: Option<String>,
    #[serde(rename = "usageCount")]
    pub usage_count: i64,
}

#[derive(Debug, Serialize)]
pub struct SaveGeminiKeyResponse {
    pub success: bool,
}

#[derive(Debug, Serialize)]
pub struct DeleteGeminiKeyResponse {
    pub success: bool,
}

#[tauri::command]
pub fn get_gemini_key_status() -> Result<GetGeminiKeyStatusResponse, String> {
    let api_key = match secrets::get_gemini_key() {
        Ok(api_key) if !api_key.trim().is_empty() => api_key,
        Ok(_) | Err(secrets::SecretsError::NotFound) => {
            return Ok(GetGeminiKeyStatusResponse {
                has_key: false,
                masked_key: None,
                key_prefix: None,
                key_suffix: None,
                created_at: None,
                last_used: None,
                usage_count: 0,
            });
        }
        Err(e) => return Err(e.to_string()),
    };
    let (masked, prefix, suffix) = mask_key(&api_key);

    let metadata = gemini_key_metadata::get_metadata(LOCAL_USER)
        .map_err(|e| e.to_string())?
        .unwrap_or(gemini_key_metadata::GeminiKeyMetadata {
            user_id: LOCAL_USER.to_string(),
            created_at: None,
            last_used: None,
            usage_count: 0,
        });

    Ok(GetGeminiKeyStatusResponse {
        has_key: true,
        masked_key: masked,
        key_prefix: prefix,
        key_suffix: suffix,
        created_at: metadata.created_at,
        last_used: metadata.last_used,
        usage_count: metadata.usage_count,
    })
}

#[tauri::command]
pub fn save_gemini_key(api_key: String) -> Result<SaveGeminiKeyResponse, String> {
    let trimmed_key = api_key.trim();
    if trimmed_key.is_empty() {
        return Err("API key cannot be empty".to_string());
    }

    secrets::save_gemini_key(trimmed_key).map_err(|e| e.to_string())?;
    let stored_key = secrets::get_gemini_key()
        .map_err(|e| format!("Gemini API key was saved but could not be read back: {}", e))?;

    if stored_key.trim().is_empty() {
        return Err("Gemini API key was saved but read back as empty".to_string());
    }

    gemini_key_metadata::upsert_metadata(LOCAL_USER).map_err(|e| e.to_string())?;

    Ok(SaveGeminiKeyResponse { success: true })
}

#[tauri::command]
pub fn delete_gemini_key() -> Result<DeleteGeminiKeyResponse, String> {
    match secrets::delete_gemini_key() {
        Ok(()) => {
            // Also clear metadata
            Ok(DeleteGeminiKeyResponse { success: true })
        }
        Err(secrets::SecretsError::NotFound) => {
            Ok(DeleteGeminiKeyResponse { success: true })
        }
        Err(e) => Err(e.to_string()),
    }
}
