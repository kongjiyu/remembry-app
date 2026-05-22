//! Document database operations.

use crate::db::with_db;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub id: String,
    pub project_id: String,
    pub display_name: String,
    pub mime_type: Option<String>,
    pub content: String,
    pub metadata: Option<serde_json::Value>,
    pub created_at: String,
}

pub fn upsert_document(doc: &Document) -> Result<(), String> {
    with_db(|conn| {
        let metadata_json = doc.metadata.as_ref()
            .and_then(|m| serde_json::to_string(m).ok());

        conn.execute(
            "INSERT OR REPLACE INTO project_documents (id, project_id, display_name, mime_type, content, metadata, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                doc.id,
                doc.project_id,
                doc.display_name,
                doc.mime_type,
                doc.content,
                metadata_json,
                doc.created_at,
            ],
        ).map_err(|e| e.to_string())?;

        Ok(())
    }).map_err(|e| e.to_string())
}

#[allow(dead_code)]
pub fn list_documents_for_project(project_id: &str) -> Result<Vec<Document>, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, project_id, display_name, mime_type, content, metadata, created_at FROM project_documents WHERE project_id = ?1 ORDER BY created_at DESC"
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map(params![project_id], |row| {
            let metadata_str: Option<String> = row.get(5)?;
            Ok(Document {
                id: row.get(0)?,
                project_id: row.get(1)?,
                display_name: row.get(2)?,
                mime_type: row.get(3)?,
                content: row.get(4)?,
                metadata: metadata_str.and_then(|s| serde_json::from_str(&s).ok()),
                created_at: row.get(6)?,
            })
        }).map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }).map_err(|e| e.to_string())
}

#[allow(dead_code)]
pub fn delete_document(doc_id: &str) -> Result<(), String> {
    with_db(|conn| {
        conn.execute("DELETE FROM project_documents WHERE id = ?1", params![doc_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }).map_err(|e| e.to_string())
}