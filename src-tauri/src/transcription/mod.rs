//! Transcription providers.
//!
//! A pluggable interface so we can swap between Groq Whisper, Gemini, and
//! any future backend without rewriting the upload pipeline.
//!
//! Implementation note: we use a concrete `Provider` enum instead of a
//! `dyn Trait` because `async fn` in traits isn't stable without
//! `async-trait`, and the project policy is to add no new crate deps.
//! Enums dispatch statically so there's no vtable cost.

use std::path::Path;
use std::pin::Pin;
use std::future::Future;

pub mod groq;

#[derive(Debug, Clone)]
pub struct TranscriptionResult {
    pub text: String,
    pub language: Option<String>,
}

/// Boxed future alias for the async transcribe method.
pub type TranscribeFuture<'a> =
    Pin<Box<dyn Future<Output = Result<TranscriptionResult, String>> + Send + 'a>>;

/// Transcription backend variants.
#[derive(Debug, Clone)]
pub enum Provider {
    /// Groq Whisper (whisper-large-v3 by default).
    Groq(groq::GroqWhisper),
}

impl Provider {
    /// Transcribe audio at `file_path`. See `Provider::transcribe` for arg docs.
    pub fn transcribe<'a>(
        &'a self,
        file_path: &'a Path,
        mime_type: &'a str,
        context: &'a str,
    ) -> TranscribeFuture<'a> {
        match self {
            Provider::Groq(client) => Box::pin(client.transcribe(file_path, mime_type, context)),
        }
    }
}