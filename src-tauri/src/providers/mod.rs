//! Provider configuration: choose which backend powers each step.

pub mod config;

pub use config::{
    ExtractionModel, ExtractionProviderType, ProviderConfig, TranscriptionModel,
    TranscriptionProviderType, GROQ_BASE_URL,
};