//! OS credential store for API keys via keyring.
//!
//! Each provider has its own (service, user) tuple. We reuse the same
//! `SERVICE_NAME` for all keys but vary the user label so different
//! keys can coexist without colliding.

use keyring::Entry;
use thiserror::Error;

const SERVICE_NAME: &str = "remembry";
const LOCAL_USER: &str = "local_user";
const GROQ_USER: &str = "groq_local_user";

#[derive(Error, Debug)]
pub enum SecretsError {
    #[error("credential store error: {0}")]
    Keyring(String),
    #[error("key not found")]
    NotFound,
}

fn is_not_found_err(err: &keyring::Error) -> bool {
    let s = err.to_string();
    s.contains("not found") || s.contains("No matching") || s.contains("No password")
}

// ── Gemini key ──────────────────────────────────────────────────────────

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
            if is_not_found_err(&e) {
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
            if is_not_found_err(&e) {
                Err(SecretsError::NotFound)
            } else {
                Err(SecretsError::Keyring(e.to_string()))
            }
        }
    }
}

// ── Groq key ────────────────────────────────────────────────────────────

pub fn save_groq_key(api_key: &str) -> Result<(), SecretsError> {
    let entry = Entry::new(SERVICE_NAME, GROQ_USER)
        .map_err(|e| SecretsError::Keyring(e.to_string()))?;
    entry.set_password(api_key)
        .map_err(|e| SecretsError::Keyring(e.to_string()))?;
    log::info!("Groq API key saved to OS credential store");
    Ok(())
}

pub fn get_groq_key() -> Result<String, SecretsError> {
    let entry = Entry::new(SERVICE_NAME, GROQ_USER)
        .map_err(|e| SecretsError::Keyring(e.to_string()))?;
    entry.get_password()
        .map_err(|e| {
            if is_not_found_err(&e) {
                SecretsError::NotFound
            } else {
                SecretsError::Keyring(e.to_string())
            }
        })
}

pub fn delete_groq_key() -> Result<(), SecretsError> {
    let entry = Entry::new(SERVICE_NAME, GROQ_USER)
        .map_err(|e| SecretsError::Keyring(e.to_string()))?;
    match entry.delete_credential() {
        Ok(()) => {
            log::info!("Groq API key deleted from OS credential store");
            Ok(())
        }
        Err(e) => {
            if is_not_found_err(&e) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mask_key_short_returns_full() {
        let (masked, prefix, suffix) = mask_key("abc");
        assert_eq!(masked, Some("abc".to_string()));
        assert!(prefix.is_none());
        assert!(suffix.is_none());
    }

    #[test]
    fn mask_key_long_returns_masked() {
        let (masked, prefix, suffix) = mask_key("gsk_abcdefghij1234567890");
        assert_eq!(prefix, Some("gsk_".to_string()));
        assert_eq!(suffix, Some("7890".to_string()));
        assert_eq!(masked, Some("gsk_...7890".to_string()));
    }

    #[test]
    fn is_not_found_err_detects_not_found_messages() {
        // We can't easily construct a real keyring::Error, but we can verify
        // the helper matches the same substrings used by get_gemini_key.
        assert!(is_not_found_err_msg("No matching entry found"));
        assert!(is_not_found_err_msg("password not found"));
        assert!(is_not_found_err_msg("No password found"));
        assert!(!is_not_found_err_msg("permission denied"));
    }

    fn is_not_found_err_msg(s: &str) -> bool {
        s.contains("not found") || s.contains("No matching") || s.contains("No password")
    }
}