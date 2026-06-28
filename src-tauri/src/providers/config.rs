//! Provider configuration types.
//!
//! Users select which backend to use for each step (transcription,
//! structured extraction). The config is persisted as JSON in the
//! app data directory and read by the upload pipeline.

use serde::{Deserialize, Serialize};

pub const GROQ_BASE_URL: &str = "https://api.groq.com/openai/v1";

/// Which backend transcribes audio files.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptionProviderType {
    Groq,
    /// Gemini remains as a fallback for users without a Groq key.
    Gemini,
}

/// Which backend extracts structured knowledge from text.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ExtractionProviderType {
    Groq,
    /// Any OpenAI-compatible endpoint (OpenCode Go, DeepSeek, OpenRouter, custom).
    OpenaiCompatible,
    /// Gemini remains as a last-resort fallback.
    Gemini,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptionModel {
    WhisperLargeV3,
    WhisperLargeV3Turbo,
}

impl TranscriptionModel {
    pub fn api_name(&self) -> &str {
        match self {
            Self::WhisperLargeV3 => "whisper-large-v3",
            Self::WhisperLargeV3Turbo => "whisper-large-v3-turbo",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ExtractionModel {
    Llama33_70b,
    Llama4Scout,
    Qwen3_32b,
    GptOss120b,
    /// User-provided via `custom_model` field; `api_name()` returns "".
    Custom,
}

impl ExtractionModel {
    pub fn api_name(&self) -> &str {
        match self {
            Self::Llama33_70b => "llama-3.3-70b-versatile",
            Self::Llama4Scout => "llama-4-scout",
            Self::Qwen3_32b => "qwen-3-32b",
            Self::GptOss120b => "gpt-oss-120b",
            Self::Custom => "",
        }
    }
}

/// User-facing provider configuration. Persisted as JSON.
///
/// API keys for Groq live in the OS credential store (see `secrets`),
/// NOT here. The `groq_api_key`/`custom_api_key` fields on this struct
/// are intentionally NOT populated on read — they're reserved for the
/// Settings UI write-back path.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub transcription: TranscriptionProviderType,
    pub extraction: ExtractionProviderType,
    pub groq_transcription_model: TranscriptionModel,
    pub groq_extraction_model: ExtractionModel,
    /// Custom provider fields (only used when `extraction == OpenaiCompatible`).
    pub custom_base_url: Option<String>,
    pub custom_model: Option<String>,
    /// Echoed back from the UI when saving a key so the write flow can
    /// persist the value into the keyring. None on disk after save.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub groq_api_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub custom_api_key: Option<String>,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            transcription: TranscriptionProviderType::Groq,
            extraction: ExtractionProviderType::Groq,
            groq_transcription_model: TranscriptionModel::WhisperLargeV3,
            groq_extraction_model: ExtractionModel::Llama33_70b,
            custom_base_url: None,
            custom_model: None,
            groq_api_key: None,
            custom_api_key: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transcription_model_api_names_match_groq_docs() {
        assert_eq!(TranscriptionModel::WhisperLargeV3.api_name(), "whisper-large-v3");
        assert_eq!(TranscriptionModel::WhisperLargeV3Turbo.api_name(), "whisper-large-v3-turbo");
    }

    #[test]
    fn extraction_model_api_names_match_groq_docs() {
        assert_eq!(ExtractionModel::Llama33_70b.api_name(), "llama-3.3-70b-versatile");
        assert_eq!(ExtractionModel::Llama4Scout.api_name(), "llama-4-scout");
        assert_eq!(ExtractionModel::Qwen3_32b.api_name(), "qwen-3-32b");
        assert_eq!(ExtractionModel::GptOss120b.api_name(), "gpt-oss-120b");
        assert_eq!(ExtractionModel::Custom.api_name(), "");
    }

    #[test]
    fn default_config_uses_groq_with_best_models() {
        let cfg = ProviderConfig::default();
        assert_eq!(cfg.transcription, TranscriptionProviderType::Groq);
        assert_eq!(cfg.extraction, ExtractionProviderType::Groq);
        assert_eq!(cfg.groq_transcription_model, TranscriptionModel::WhisperLargeV3);
        assert_eq!(cfg.groq_extraction_model, ExtractionModel::Llama33_70b);
        assert!(cfg.custom_base_url.is_none());
        assert!(cfg.custom_model.is_none());
        assert!(cfg.groq_api_key.is_none());
        assert!(cfg.custom_api_key.is_none());
    }

    #[test]
    fn config_roundtrips_via_json() {
        let cfg = ProviderConfig::default();
        let json = serde_json::to_string(&cfg).unwrap();
        let parsed: ProviderConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.transcription, cfg.transcription);
        assert_eq!(parsed.extraction, cfg.extraction);
        assert_eq!(parsed.groq_transcription_model, cfg.groq_transcription_model);
        assert_eq!(parsed.groq_extraction_model, cfg.groq_extraction_model);
    }

    #[test]
    fn config_serializes_snake_case() {
        let json = serde_json::to_string(&TranscriptionProviderType::Groq).unwrap();
        assert_eq!(json, "\"groq\"");

        let json = serde_json::to_string(&ExtractionProviderType::OpenaiCompatible).unwrap();
        assert_eq!(json, "\"openai_compatible\"");

        let json = serde_json::to_string(&TranscriptionModel::WhisperLargeV3Turbo).unwrap();
        assert_eq!(json, "\"whisper_large_v3_turbo\"");
    }
}