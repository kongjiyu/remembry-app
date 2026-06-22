//! Document Tauri commands — wrap the db layer for frontend use.

use crate::db::documents::{self, Document};

/// Maximum bytes accepted for an imported text file (5 MB).
const MAX_IMPORT_BYTES: u64 = 5 * 1024 * 1024;

/// Pure helper that does file-content validation and Document construction.
/// Returns Ok(Document) ready to insert, or Err with a user-facing message.
pub(crate) fn build_imported_document(
    project_id: &str,
    file_path: &std::path::Path,
    max_bytes: u64,
) -> Result<Document, String> {
    // 1. Extension check
    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if !matches!(ext.as_str(), "txt" | "md") {
        return Err(format!(
            "Only .txt and .md files are supported (got .{})",
            ext
        ));
    }

    // 2. Path safety — reject parent-dir traversal attempts
    let path_str = file_path.to_string_lossy();
    if path_str.contains("..") {
        return Err("File path must not contain '..' components".to_string());
    }

    // 3. Size check BEFORE reading (avoids loading huge files into memory)
    let metadata =
        std::fs::metadata(file_path).map_err(|e| format!("Cannot stat file: {}", e))?;
    if metadata.len() > max_bytes {
        return Err(format!(
            "File too large ({} bytes; max {})",
            metadata.len(),
            max_bytes
        ));
    }

    // 4. Read + binary sniff
    let bytes =
        std::fs::read(file_path).map_err(|e| format!("Cannot read file: {}", e))?;
    let sniff_len = bytes.len().min(512);
    if bytes[..sniff_len].iter().any(|b| *b == 0) {
        return Err(
            "File appears to be binary. Only text files are supported.".to_string(),
        );
    }

    // 5. UTF-8 validation
    let content =
        String::from_utf8(bytes).map_err(|_| "File is not valid UTF-8 text".to_string())?;

    // 6. Build Document
    let display_name = file_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| "Cannot derive filename".to_string())?;
    let mime_type = if ext == "md" {
        "text/markdown"
    } else {
        "text/plain"
    };
    let id = format!("doc_{}", chrono::Utc::now().timestamp_millis());
    let now = chrono::Utc::now().to_rfc3339();

    Ok(Document {
        id,
        project_id: project_id.to_string(),
        display_name,
        mime_type: Some(mime_type.to_string()),
        content,
        metadata: None,
        created_at: now,
    })
}

#[tauri::command]
pub async fn import_text_file(
    project_id: String,
    file_path: String,
) -> Result<Document, String> {
    let path = std::path::PathBuf::from(&file_path);
    let doc = build_imported_document(&project_id, &path, MAX_IMPORT_BYTES)?;
    documents::upsert_document(&doc)?;
    Ok(doc)
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_file(name: &str, contents: &[u8]) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!(
            "remembry-imp-{}-{}",
            std::process::id(),
            name
        ));
        fs::write(&p, contents).unwrap();
        p
    }

    #[test]
    fn build_import_accepts_txt_file() {
        let f = temp_file("ok.txt", b"hello world\n");
        let doc = build_imported_document("p1", &f, 1024).unwrap();
        assert_eq!(doc.content, "hello world\n");
        assert_eq!(doc.mime_type.as_deref(), Some("text/plain"));
        assert!(fs::remove_file(&f).is_ok());
    }

    #[test]
    fn build_import_accepts_md_file() {
        let f = temp_file("ok.md", b"# Title\n\nbody\n");
        let doc = build_imported_document("p1", &f, 1024).unwrap();
        assert_eq!(doc.mime_type.as_deref(), Some("text/markdown"));
        assert!(fs::remove_file(&f).is_ok());
    }

    #[test]
    fn build_import_rejects_pdf_extension() {
        let f = temp_file("doc.pdf", b"%PDF-1.4 fake");
        let result = build_imported_document("p1", &f, 1024);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Only .txt and .md"));
        let _ = fs::remove_file(&f);
    }

    #[test]
    fn build_import_rejects_binary_via_null_bytes() {
        let f = temp_file("bin.txt", b"hello\x00world");
        let result = build_imported_document("p1", &f, 1024);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("binary"));
        let _ = fs::remove_file(&f);
    }

    #[test]
    fn build_import_rejects_oversized_file() {
        let f = temp_file("big.txt", &vec![b'a'; 2048]);
        let result = build_imported_document("p1", &f, 1024);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too large"));
        let _ = fs::remove_file(&f);
    }

    #[test]
    fn build_import_rejects_parent_traversal_in_path() {
        // Use a path that has a valid extension (.txt) but contains ".." in the
        // path components. On Windows this might normalize, so we build a path
        // that definitely contains ".." when rendered as a string.
        let base =
            std::env::temp_dir().join(format!("remembry-traversal-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        // dir/../secret.txt — extension is valid (.txt) so we reach the path check.
        let escape_path = base.join("dir").join("..").join("secret.txt");
        let result = build_imported_document("p1", &escape_path, 1024);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains(".."),
            "expected path-guard error with '..', got: {}",
            err
        );
        let _ = std::fs::remove_dir_all(&base);
    }
}
