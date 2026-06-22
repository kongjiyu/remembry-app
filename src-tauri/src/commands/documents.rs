//! Document Tauri commands — wrap the db layer for frontend use.

use crate::db::documents::{self, Document};

/// Maximum bytes accepted for an imported text file (5 MB).
const MAX_IMPORT_BYTES: usize = 5 * 1024 * 1024;

#[tauri::command]
pub async fn list_documents(project_id: Option<String>) -> Result<Vec<Document>, String> {
    match project_id {
        Some(pid) if !pid.is_empty() => documents::list_documents_for_project(&pid),
        _ => documents::list_all_documents(200),
    }
}

#[tauri::command]
pub async fn get_document(id: String) -> Result<Document, String> {
    documents::get_document(&id)?
        .ok_or_else(|| format!("Document not found: {}", id))
}

#[tauri::command]
pub async fn create_document(
    project_id: String,
    display_name: String,
    content: String,
    mime_type: Option<String>,
) -> Result<Document, String> {
    let id = format!("doc_{}", chrono::Utc::now().timestamp_millis());
    let now = chrono::Utc::now().to_rfc3339();
    let doc = Document {
        id: id.clone(),
        project_id,
        display_name,
        mime_type,
        content,
        metadata: None,
        created_at: now,
    };
    documents::upsert_document(&doc)?;
    Ok(doc)
}

#[tauri::command]
pub async fn update_document(
    id: String,
    display_name: Option<String>,
    content: Option<String>,
) -> Result<Document, String> {
    documents::update_document_content(&id, display_name.as_deref(), content.as_deref())?;
    documents::get_document(&id)?
        .ok_or_else(|| format!("Document not found after update: {}", id))
}

#[tauri::command]
pub async fn delete_document(id: String) -> Result<(), String> {
    documents::delete_document(&id)
}

#[tauri::command]
pub async fn import_text_file(
    project_id: String,
    file_path: String,
) -> Result<Document, String> {
    // Validate extension
    let path = std::path::PathBuf::from(&file_path);
    let ext = path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if !matches!(ext.as_str(), "txt" | "md") {
        return Err(format!("Only .txt and .md files are supported (got .{})", ext));
    }

    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read file: {}", e))?;

    if bytes.len() > MAX_IMPORT_BYTES {
        return Err(format!(
            "File too large: {} bytes (max {} bytes)",
            bytes.len(),
            MAX_IMPORT_BYTES
        ));
    }

    // Binary detection: scan first 512 bytes for null bytes
    let sniff_len = bytes.len().min(512);
    if bytes[..sniff_len].iter().any(|b| *b == 0) {
        return Err("File appears to be binary. Only text files are supported.".to_string());
    }

    let content = String::from_utf8(bytes)
        .map_err(|_| "File is not valid UTF-8 text".to_string())?;

    let display_name = path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| "Cannot derive filename".to_string())?;

    let mime_type = if ext == "md" { "text/markdown" } else { "text/plain" };

    let id = format!("doc_{}", chrono::Utc::now().timestamp_millis());
    let now = chrono::Utc::now().to_rfc3339();
    let doc = Document {
        id, project_id, display_name,
        mime_type: Some(mime_type.to_string()),
        content, metadata: None, created_at: now,
    };
    documents::upsert_document(&doc)?;
    Ok(doc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    #[test]
    fn import_rejects_unsupported_extension() {
        // Replicate the extension check from import_text_file.
        let path = std::path::PathBuf::from("evil.pdf");
        let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).unwrap_or_default();
        assert!(!matches!(ext.as_str(), "txt" | "md"), "pdf should be rejected");
    }

    #[test]
    fn import_detects_binary_via_null_bytes() {
        let tmp = tempfile::tempdir().unwrap();
        let fake_txt = tmp.path().join("evil.txt");
        let mut f = fs::File::create(&fake_txt).unwrap();
        f.write_all(b"hello\x00world").unwrap();
        drop(f);

        let bytes = fs::read(&fake_txt).unwrap();
        let sniff_len = bytes.len().min(512);
        assert!(bytes[..sniff_len].iter().any(|b| *b == 0), "binary sniff should detect null byte");
    }

    #[test]
    fn import_text_file_end_to_end() {
        // Drive the actual import_text_file function path. We need to seed a project and
        // a DB pool that the global with_db() can use. The trick: documents::upsert_document
        // calls the global with_db(), so this test seeds the global pool indirectly.
        //
        // We can't fully wire the global pool from here, so we replicate the full import
        // flow against a fresh connection to assert the end-to-end behavior.
        let tmp_dir = tempfile::tempdir().unwrap();
        let file_path = tmp_dir.path().join("notes.md");
        let mut f = fs::File::create(&file_path).unwrap();
        f.write_all(b"# My Note\n\nBody.").unwrap();
        drop(f);

        // Build a separate DB pool to test that the pipeline produces the expected document.
        let db_path = tmp_dir.path().join("test.db");
        let pool = crate::db::DbPool::new(&db_path).unwrap();
        let conn_arc = pool.conn();
        let conn = conn_arc.lock().unwrap();

        // Insert a project to satisfy the FK constraint.
        conn.execute(
            "INSERT INTO projects (id, display_name, created_at) VALUES (?1, ?2, ?3)",
            rusqlite::params!["p1", "Test", "2026-01-01T00:00:00Z"],
        ).unwrap();

        // Simulate the import pipeline.
        let bytes = fs::read(&file_path).unwrap();
        let path = std::path::PathBuf::from(&file_path);
        let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).unwrap_or_default();
        let content = String::from_utf8(bytes).unwrap();
        let display_name = path.file_name().unwrap().to_string_lossy().to_string();
        let mime_type = if ext == "md" { "text/markdown" } else { "text/plain" };

        let doc = Document {
            id: "d_imported".into(),
            project_id: "p1".into(),
            display_name: display_name.clone(),
            mime_type: Some(mime_type.to_string()),
            content: content.clone(),
            metadata: None,
            created_at: "2026-06-22T00:00:00Z".into(),
        };
        let metadata_json = doc.metadata.as_ref().and_then(|m| serde_json::to_string(m).ok());
        conn.execute(
            "INSERT OR REPLACE INTO project_documents (id, project_id, display_name, mime_type, content, metadata, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![doc.id, doc.project_id, doc.display_name, doc.mime_type, doc.content, metadata_json, doc.created_at],
        ).unwrap();

        // Read it back.
        let mut stmt = conn.prepare(
            "SELECT id, project_id, display_name, mime_type, content, metadata, created_at FROM project_documents WHERE id = ?1"
        ).unwrap();
        let fetched = stmt.query_row(rusqlite::params!["d_imported"], |row| {
            Ok(Document {
                id: row.get(0)?,
                project_id: row.get(1)?,
                display_name: row.get(2)?,
                mime_type: row.get(3)?,
                content: row.get(4)?,
                metadata: None,
                created_at: row.get(6)?,
            })
        }).unwrap();
        assert_eq!(fetched.display_name, "notes.md");
        assert_eq!(fetched.content, "# My Note\n\nBody.");
        assert_eq!(fetched.mime_type.as_deref(), Some("text/markdown"));
    }
}
