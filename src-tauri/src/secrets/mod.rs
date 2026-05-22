//! OS credential store for Gemini API key via keyring.

use keyring::Entry;
use thiserror::Error;

const SERVICE_NAME: &str = "remembry";
const LOCAL_USER: &str = "local_user";

#[derive(Error, Debug)]
pub enum SecretsError {
    #[error("credential store error: {0}")]
    Keyring(String),
    #[error("key not found")]
    NotFound,
}

pub fn save_gemini_key(api_key: &str) -> Result<(), SecretsError> {
    let entry = Entry::new(SERVICE_NAME, LOCAL_USER)
        .map_err(|e| SecretsError::Keyring(e.to_string()))?;
    entry.set_password(api_key)
        .map_err(|e| SecretsError::Keyring(e.to_string()))?;
    log::info!("Gemini API key saved to OS credential store");
    Ok(())
}

pub fn get_gemini_key() -> Result<String, SecretsError> {
    let entry = Entry::new(SERVICE_NAME, LOCAL_USER)
        .map_err(|e| SecretsError::Keyring(e.to_string()))?;
    entry.get_password()
        .map_err(|e| {
            if e.to_string().contains("not found") || e.to_string().contains("No matching") || e.to_string().contains("No password") {
                SecretsError::NotFound
            } else {
                SecretsError::Keyring(e.to_string())
            }
        })
}

pub fn delete_gemini_key() -> Result<(), SecretsError> {
    let entry = Entry::new(SERVICE_NAME, LOCAL_USER)
        .map_err(|e| SecretsError::Keyring(e.to_string()))?;
    match entry.delete_credential() {
        Ok(()) => {
            log::info!("Gemini API key deleted from OS credential store");
            Ok(())
        }
        Err(e) => {
            if e.to_string().contains("not found") || e.to_string().contains("No matching") || e.to_string().contains("No password") {
                Err(SecretsError::NotFound)
            } else {
                Err(SecretsError::Keyring(e.to_string()))
            }
        }
    }
}

pub fn mask_key(key: &str) -> (Option<String>, Option<String>, Option<String>) {
    if key.len() <= 8 {
        (Some(key.to_string()), None, None)
    } else {
        let prefix = key[..4].to_string();
        let suffix = key[key.len()-4..].to_string();
        (Some(format!("{}...{}", prefix, suffix)), Some(prefix), Some(suffix))
    }
}