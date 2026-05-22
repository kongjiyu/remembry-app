//! Gemini key metadata database operations.

use crate::db::with_db;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeminiKeyMetadata {
    pub user_id: String,
    pub created_at: Option<String>,
    pub last_used: Option<String>,
    pub usage_count: i64,
}

pub fn get_metadata(user_id: &str) -> Result<Option<GeminiKeyMetadata>, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT user_id, created_at, last_used, usage_count FROM gemini_key_metadata WHERE user_id = ?1"
        ).map_err(|e| e.to_string())?;

        let row = stmt.query_row(params![user_id], |row| {
            Ok(GeminiKeyMetadata {
                user_id: row.get(0)?,
                created_at: row.get(1)?,
                last_used: row.get(2)?,
                usage_count: row.get::<_, i64>(3)?,
            })
        }).map_err(|_| "Not found".to_string()).ok();

        Ok(row)
    }).map_err(|e| e.to_string())
}

pub fn upsert_metadata(user_id: &str) -> Result<(), String> {
    with_db(|conn| {
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR REPLACE INTO gemini_key_metadata (user_id, created_at, last_used, usage_count) VALUES (?1, COALESCE((SELECT created_at FROM gemini_key_metadata WHERE user_id = ?1), ?2), ?2, COALESCE((SELECT usage_count FROM gemini_key_metadata WHERE user_id = ?1), 0))",
            params![user_id, now],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }).map_err(|e| e.to_string())
}

pub fn increment_usage(user_id: &str) -> Result<(), String> {
    with_db(|conn| {
        let now = chrono::Utc::now().to_rfc3339();
        let affected = conn.execute(
            "UPDATE gemini_key_metadata SET last_used = ?1, usage_count = usage_count + 1 WHERE user_id = ?2",
            params![now, user_id],
        ).map_err(|e| e.to_string())?;

        if affected == 0 {
            return Err("Metadata not found".to_string());
        }
        Ok(())
    }).map_err(|e| e.to_string())
}