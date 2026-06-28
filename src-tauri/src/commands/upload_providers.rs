//! Provider-aware upload helpers.
//!
//! These dispatchers read `ProviderConfig` and route transcription and
//! extraction through the appropriate backend. The upload pipeline calls
//! through them instead of importing `gemini::*` directly so swapping
//! providers doesn't require rewriting `uploads.rs`.
//!
//! Fallback chain (Task 10) lives in `fallback.rs` and wraps these.

use crate::db::{EventKnowledge, MeetingNotes, TranscriptionResult};
use crate::gemini::{self, GeminiClient};
use crate::llm::LlmClient;
use crate::providers::{
    ExtractionProviderType, ProviderConfig, TranscriptionProviderType, GROQ_BASE_URL,
};
use crate::secrets;

/// Build the concrete transcription provider from a `ProviderConfig`.
/// Returns an error if the configured provider's key is missing.
fn build_transcription_provider(config: &ProviderConfig) -> Result<crate::transcription::Provider, String> {
    match config.transcription {
        TranscriptionProviderType::Groq => {
            let key = secrets::get_groq_key().map_err(|_| "Groq API key not configured".to_string())?;
            let model = config.groq_transcription_model.api_name().to_string();
            Ok(crate::transcription::Provider::Groq(
                crate::transcription::groq::GroqWhisper::new(key, model),
            ))
        }
        // For Gemini, the upload pipeline still uses the existing
        // `gemini::upload_file` + `gemini::transcribe_audio` two-step flow
        // because the upload-then-transcribe pattern doesn't fit the
        // single-call Provider trait. The dispatcher returns a clear error
        // here; callers should detect Gemini mode and use the legacy path.
        TranscriptionProviderType::Gemini => {
            Err("Gemini transcription uses the legacy upload-then-transcribe path; use transcribe_legacy instead".to_string())
        }
    }
}

/// Transcribe audio using the configured provider.
///
/// On the Gemini path this does the full upload-then-transcribe dance
/// against the Gemini Files API. On the Groq path it uploads the file
/// bytes directly to Groq Whisper (no intermediate remote file).
///
/// `gemini_client` is the pre-built Gemini client (needed because the
/// Gemini path needs both upload and transcription). It's only consulted
/// when `config.transcription == Gemini`.
pub async fn transcribe_with_provider(
    config: &ProviderConfig,
    gemini_client: &GeminiClient,
    file_path: &std::path::Path,
    mime_type: &str,
    context: &str,
) -> Result<TranscriptionResult, String> {
    match config.transcription {
        TranscriptionProviderType::Groq => {
            let provider = build_transcription_provider(config)?;
            let result = provider.transcribe(file_path, mime_type, context).await?;
            Ok(TranscriptionResult {
                text: result.text,
                language: result.language,
            })
        }
        TranscriptionProviderType::Gemini => {
            // Legacy two-step path: upload to Gemini Files API, then transcribe by URI.
            let upload = gemini::upload_file(gemini_client, file_path, mime_type).await
                .map_err(|e| format!("Gemini upload failed: {}", e))?;
            // Best-effort cleanup of the remote file regardless of transcription outcome.
            let result = gemini::transcribe_audio(gemini_client, &upload.uri, mime_type, context).await;
            let _ = gemini::delete_file(gemini_client, &upload.name).await;
            result
        }
    }
}

/// Extract structured meeting notes from a transcript.
pub async fn extract_meeting_notes_with_provider(
    config: &ProviderConfig,
    gemini_client: &GeminiClient,
    transcription: &str,
    context: &str,
    language: &str,
) -> Result<MeetingNotes, String> {
    let prompt = crate::prompts::meeting_notes_prompt(transcription, context, language);

    match config.extraction {
        ExtractionProviderType::Groq => {
            let key = secrets::get_groq_key().map_err(|_| "Groq API key not configured".to_string())?;
            let model = config.groq_extraction_model.api_name();
            let client = LlmClient::new(key, GROQ_BASE_URL.to_string());
            let value = client.extract_json(model, &prompt, 0.3, 2048).await?;
            serde_json::from_value(value)
                .map_err(|e| format!("Failed to parse meeting notes JSON: {}", e))
        }
        ExtractionProviderType::OpenaiCompatible => {
            let key = secrets::get_groq_key().map_err(|_| "Custom provider API key not configured".to_string())?;
            let base_url = config.custom_base_url.as_deref()
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| "Custom provider base URL not configured".to_string())?;
            // The Custom model name lives on the config directly. For now we
            // pass it through as the model identifier — `api_name()` is "" for
            // `ExtractionModel::Custom`, but the user provides the real model
            // name in the `custom_model` field.
            let model = config.custom_model.as_deref()
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| "Custom provider model name not configured".to_string())?;
            let client = LlmClient::new(key, base_url.to_string());
            let value = client.extract_json(model, &prompt, 0.3, 2048).await?;
            serde_json::from_value(value)
                .map_err(|e| format!("Failed to parse meeting notes JSON: {}", e))
        }
        ExtractionProviderType::Gemini => {
            gemini::extract_meeting_notes(gemini_client, transcription, context, language).await
        }
    }
}

/// Extract structured event knowledge from a transcript.
pub async fn extract_event_knowledge_with_provider(
    config: &ProviderConfig,
    gemini_client: &GeminiClient,
    transcription: &str,
    context: &str,
    event_type: &str,
    event_tags: &[String],
    language: &str,
) -> Result<EventKnowledge, String> {
    let prompt = crate::prompts::event_knowledge_prompt(
        transcription, context, event_type, event_tags, language,
    );

    match config.extraction {
        ExtractionProviderType::Groq => {
            let key = secrets::get_groq_key().map_err(|_| "Groq API key not configured".to_string())?;
            let model = config.groq_extraction_model.api_name();
            let client = LlmClient::new(key, GROQ_BASE_URL.to_string());
            let value = client.extract_json(model, &prompt, 0.3, 4096).await?;
            serde_json::from_value(value)
                .map_err(|e| format!("Failed to parse EventKnowledge JSON: {}", e))
        }
        ExtractionProviderType::OpenaiCompatible => {
            let key = secrets::get_groq_key().map_err(|_| "Custom provider API key not configured".to_string())?;
            let base_url = config.custom_base_url.as_deref()
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| "Custom provider base URL not configured".to_string())?;
            let model = config.custom_model.as_deref()
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| "Custom provider model name not configured".to_string())?;
            let client = LlmClient::new(key, base_url.to_string());
            let value = client.extract_json(model, &prompt, 0.3, 4096).await?;
            serde_json::from_value(value)
                .map_err(|e| format!("Failed to parse EventKnowledge JSON: {}", e))
        }
        ExtractionProviderType::Gemini => {
            gemini::extract_event_knowledge(gemini_client, transcription, context, event_type, event_tags, language).await
        }
    }
}

/// Load the persisted `ProviderConfig`. Defaults if no file exists or it's corrupt.
pub fn load_provider_config() -> ProviderConfig {
    crate::commands::providers::get_provider_config().unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::{ExtractionModel, TranscriptionModel};

    #[test]
    fn groq_extraction_model_lookup_matches_config() {
        // Pure data-flow test that doesn't need an async runtime — verifies
        // the config → API name mapping the dispatchers rely on.
        let cfg = ProviderConfig {
            extraction: ExtractionProviderType::Groq,
            groq_extraction_model: ExtractionModel::Llama4Scout,
            ..ProviderConfig::default()
        };
        assert_eq!(cfg.groq_extraction_model.api_name(), "llama-4-scout");

        let cfg = ProviderConfig {
            extraction: ExtractionProviderType::Groq,
            groq_extraction_model: ExtractionModel::Llama33_70b,
            ..ProviderConfig::default()
        };
        assert_eq!(cfg.groq_extraction_model.api_name(), "llama-3.3-70b-versatile");
    }

    #[test]
    fn custom_model_field_used_as_identifier() {
        // For `ExtractionProviderType::OpenaiCompatible`, the actual model
        // identifier is whatever the user typed in `custom_model` —
        // `ExtractionModel::Custom.api_name()` returns "".
        let cfg = ProviderConfig {
            extraction: ExtractionProviderType::OpenaiCompatible,
            custom_model: Some("deepseek-chat".into()),
            ..ProviderConfig::default()
        };
        // The dispatcher reads `config.custom_model`, not the enum's api_name.
        assert_eq!(cfg.custom_model.as_deref(), Some("deepseek-chat"));
        assert_eq!(ExtractionModel::Custom.api_name(), "");
    }

    #[test]
    fn transcription_provider_build_requires_key_for_groq() {
        // We can't easily test the async path without a tokio runtime, but
        // we can confirm the precondition: building a Groq provider with
        // no key in the keyring must error before any HTTP call.
        let config = ProviderConfig {
            transcription: TranscriptionProviderType::Groq,
            ..ProviderConfig::default()
        };
        let result = build_transcription_provider(&config);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Groq API key"));
    }

    #[test]
    fn transcription_provider_build_rejects_gemini_via_trait() {
        // The Gemini path is handled inline in transcribe_with_provider,
        // not through the trait. Confirm the trait dispatcher refuses
        // Gemini mode rather than silently picking a default.
        let config = ProviderConfig {
            transcription: TranscriptionProviderType::Gemini,
            ..ProviderConfig::default()
        };
        let result = build_transcription_provider(&config);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("legacy"));
    }

    #[test]
    fn load_provider_config_falls_back_to_default_when_no_file() {
        // When the JSON file is missing or unreadable, we get the default
        // config. Can't easily exercise the success path here without a
        // tmp dir, but we can verify the function returns without panicking.
        let cfg = load_provider_config();
        // Default is Groq for both transcription and extraction.
        assert_eq!(cfg.transcription, TranscriptionProviderType::Groq);
        assert_eq!(cfg.extraction, ExtractionProviderType::Groq);
    }
}