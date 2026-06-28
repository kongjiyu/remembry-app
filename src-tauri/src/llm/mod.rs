//! Generic OpenAI-compatible LLM client.
//!
//! Used for both Groq-hosted models and any user-provided endpoint
//! (OpenCode Go, DeepSeek, OpenRouter, etc.). See `client::LlmClient`.

pub mod client;
pub mod types;

pub use client::LlmClient;
pub use types::{ChatCompletionRequest, ChatCompletionResponse, ChatMessage, Choice, ResponseMessage};