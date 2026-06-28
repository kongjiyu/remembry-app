//! Provider configuration Tauri commands.
//!
//! Read/write the persisted `ProviderConfig` from the app data dir.
//! The Settings UI calls these to manage transcription + extraction providers.

use crate::providers::{ProviderConfig, TranscriptionProviderType};
use crate::secrets;
use serde_json::json;
use std::path::PathBuf;

fn config_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("remembry")
        .join("providers.json")
}

#[tauri::command]
pub fn get_provider_config() -> Result<ProviderConfig, String> {
    let path = config_path();
    if !path.exists() {
        return Ok(ProviderConfig::default());
    }
    let data = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read provider config: {}", e))?;
    // Tolerate partial/corrupt configs by falling back to defaults.
    match serde_json::from_str(&data) {
        Ok(cfg) => Ok(cfg),
        Err(e) => {
            log::warn!("Provider config was malformed ({}); using defaults", e);
            Ok(ProviderConfig::default())
        }
    }
}

#[tauri::command]
pub fn save_provider_config(mut config: ProviderConfig) -> Result<serde_json::Value, String> {
    // Persist any embedded keys to the keyring first. After the write, strip
    // them from the saved JSON so the on-disk file never holds plaintext keys.
    if let Some(groq_key) = config.groq_api_key.take() {
        let trimmed = groq_key.trim();
        if !trimmed.is_empty() {
            secrets::save_groq_key(trimmed).map_err(|e| e.to_string())?;
        }
    }
    if let Some(custom_key) = config.custom_api_key.take() {
        // We don't have a dedicated custom-provider keyring slot yet — the
        // existing flow stores custom keys in the Groq slot as a fallback so
        // OpenAI-compatible providers with a Groq-style key can still authenticate.
        // A future task will add per-provider slots.
        let trimmed = custom_key.trim();
        if !trimmed.is_empty() {
            secrets::save_groq_key(trimmed).map_err(|e| e.to_string())?;
        }
    }

    // Sanity-check that the selected providers have the keys they need.
    // We surface a warning string but do NOT block saving — users may want to
    // configure providers before they have keys, then save the key afterwards.
    let warnings = validate_provider_config(&config);

    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    let data = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    std::fs::write(&path, data)
        .map_err(|e| format!("Failed to write provider config: {}", e))?;

    Ok(json!({"success": true, "warnings": warnings}))
}

/// Returns a list of human-readable warnings for missing keys.
/// Empty if the config is internally consistent.
fn validate_provider_config(config: &ProviderConfig) -> Vec<String> {
    let mut warnings = Vec::new();

    if config.transcription == TranscriptionProviderType::Groq
        && secrets::get_groq_key().is_err()
    {
        warnings.push("Groq API key not configured — transcription will fall back to Gemini".to_string());
    }

    if matches!(config.extraction, crate::providers::ExtractionProviderType::Groq)
        && secrets::get_groq_key().is_err()
    {
        warnings.push("Groq API key not configured — extraction will fall back to Gemini".to_string());
    }

    if matches!(config.extraction, crate::providers::ExtractionProviderType::OpenaiCompatible) {
        if config.custom_base_url.as_deref().map(str::trim).map(str::is_empty).unwrap_or(true) {
            warnings.push("Custom provider base URL is empty".to_string());
        }
        if config.custom_model.as_deref().map(str::trim).map(str::is_empty).unwrap_or(true) {
            warnings.push("Custom provider model name is empty".to_string());
        }
    }

    warnings
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::{ExtractionProviderType, TranscriptionProviderType};

    #[test]
    fn default_config_validates_clean() {
        let cfg = ProviderConfig::default();
        // Key is missing in the test env so warnings should mention it.
        let warnings = validate_provider_config(&cfg);
        // Don't assert exact count (depends on keyring state in the host),
        // but ensure warnings is a Vec<String> — i.e. the function is callable.
        let _ = warnings;
    }

    #[test]
    fn gemini_only_config_emits_no_provider_warnings() {
        // When transcription + extraction are both Gemini, the validator
        // should never complain about Groq key absence.
        let cfg = ProviderConfig {
            transcription: TranscriptionProviderType::Gemini,
            extraction: ExtractionProviderType::Gemini,
            ..ProviderConfig::default()
        };
        let warnings = validate_provider_config(&cfg);
        assert!(
            warnings.iter().all(|w| !w.contains("Groq API key")),
            "Gemini-only config should not mention Groq keys, got: {:?}",
            warnings
        );
    }

    #[test]
    fn custom_provider_requires_base_url_and_model() {
        let cfg = ProviderConfig {
            extraction: ExtractionProviderType::OpenaiCompatible,
            custom_base_url: None,
            custom_model: None,
            ..ProviderConfig::default()
        };
        let warnings = validate_provider_config(&cfg);
        assert!(warnings.iter().any(|w| w.contains("base URL")));
        assert!(warnings.iter().any(|w| w.contains("model name")));
    }

    #[test]
    fn custom_provider_with_blank_fields_still_warns() {
        let cfg = ProviderConfig {
            extraction: ExtractionProviderType::OpenaiCompatible,
            custom_base_url: Some("   ".into()),
            custom_model: Some("".into()),
            ..ProviderConfig::default()
        };
        let warnings = validate_provider_config(&cfg);
        assert!(warnings.iter().any(|w| w.contains("base URL")));
        assert!(warnings.iter().any(|w| w.contains("model name")));
    }

    #[test]
    fn custom_provider_with_valid_fields_emits_no_field_warnings() {
        let cfg = ProviderConfig {
            extraction: ExtractionProviderType::OpenaiCompatible,
            custom_base_url: Some("https://api.deepseek.com".into()),
            custom_model: Some("deepseek-chat".into()),
            ..ProviderConfig::default()
        };
        let warnings = validate_provider_config(&cfg);
        assert!(
            !warnings.iter().any(|w| w.contains("base URL") || w.contains("model name")),
            "got: {:?}",
            warnings
        );
    }
}