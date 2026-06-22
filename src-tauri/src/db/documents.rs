//! Document database operations (project notes + imported text files).

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
                doc.id, doc.project_id, doc.display_name, doc.mime_type,
                doc.content, metadata_json, doc.created_at,
            ],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }).map_err(|e| e.to_string())
}

pub fn get_document(id: &str) -> Result<Option<Document>, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, project_id, display_name, mime_type, content, metadata, created_at FROM project_documents WHERE id = ?1"
        ).map_err(|e| e.to_string())?;
        let mut rows = stmt.query_map(params![id], |row| {
            let metadata_str: Option<String> = row.get(5)?;
            Ok(Document {
                id: row.get(0)?, project_id: row.get(1)?, display_name: row.get(2)?,
                mime_type: row.get(3)?, content: row.get(4)?,
                metadata: metadata_str.and_then(|s| serde_json::from_str(&s).ok()),
                created_at: row.get(6)?,
            })
        }).map_err(|e| e.to_string())?;
        rows.next().transpose().map_err(|e| e.to_string())
    }).map_err(|e| e.to_string())
}

pub fn list_documents_for_project(project_id: &str) -> Result<Vec<Document>, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, project_id, display_name, mime_type, content, metadata, created_at FROM project_documents WHERE project_id = ?1 ORDER BY created_at DESC"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![project_id], |row| {
            let metadata_str: Option<String> = row.get(5)?;
            Ok(Document {
                id: row.get(0)?, project_id: row.get(1)?, display_name: row.get(2)?,
                mime_type: row.get(3)?, content: row.get(4)?,
                metadata: metadata_str.and_then(|s| serde_json::from_str(&s).ok()),
                created_at: row.get(6)?,
            })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }).map_err(|e| e.to_string())
}

pub fn list_all_documents(limit: i64) -> Result<Vec<Document>, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, project_id, display_name, mime_type, content, metadata, created_at FROM project_documents ORDER BY created_at DESC LIMIT ?1"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![limit], |row| {
            let metadata_str: Option<String> = row.get(5)?;
            Ok(Document {
                id: row.get(0)?, project_id: row.get(1)?, display_name: row.get(2)?,
                mime_type: row.get(3)?, content: row.get(4)?,
                metadata: metadata_str.and_then(|s| serde_json::from_str(&s).ok()),
                created_at: row.get(6)?,
            })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }).map_err(|e| e.to_string())
}

pub fn update_document_content(id: &str, display_name: Option<&str>, content: Option<&str>) -> Result<(), String> {
    with_db(|conn| {
        if let Some(name) = display_name {
            conn.execute("UPDATE project_documents SET display_name = ?1 WHERE id = ?2", params![name, id])
                .map_err(|e| e.to_string())?;
        }
        if let Some(c) = content {
            conn.execute("UPDATE project_documents SET content = ?1 WHERE id = ?2", params![c, id])
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }).map_err(|e| e.to_string())
}

pub fn delete_document(id: &str) -> Result<(), String> {
    with_db(|conn| {
        conn.execute("DELETE FROM project_documents WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// Test wrapper with its own isolated DB pool. Each test gets its own
    /// DbPool that is NOT shared with other tests via a global. This avoids
    /// all test interference issues.
    struct TestDb {
        pool: crate::db::DbPool,
        _guard: std::sync::MutexGuard<'static, ()>,
    }

    static TEST_GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());

    impl TestDb {
        fn new() -> Self {
            let _guard = TEST_GUARD.lock().unwrap();

            let tmp = tempfile::tempdir().unwrap();
            let db_path = tmp.path().join("test.db");
            let pool = crate::db::DbPool::new(&db_path).unwrap();
            // Leak tmp so the DB file stays valid for the full test.
            std::mem::forget(tmp);
            Self { pool, _guard }
        }

        fn with_conn<F, T>(&self, f: F) -> Result<T, String>
        where
            F: FnOnce(&rusqlite::Connection) -> Result<T, String>,
        {
            let conn_arc = self.pool.conn();
            let conn_guard = conn_arc.lock().map_err(|e| e.to_string())?;
            f(&conn_guard)
        }

        fn pool_arc(&self) -> Arc<Mutex<Option<crate::db::DbPool>>> {
            Arc::new(Mutex::new(Some(self.pool.clone())))
        }
    }

    fn insert_project(td: &TestDb, id: &str) {
        td.with_conn(|conn| {
            conn.execute(
                "INSERT INTO projects (id, display_name, created_at) VALUES (?1, ?2, ?3)",
                params![id, "Test Project", "2026-01-01T00:00:00Z"],
            ).unwrap();
            Ok(())
        }).unwrap();
    }

    fn call_with_pool<F, T>(td: &TestDb, f: F) -> Result<T, String>
    where
        F: FnOnce(&rusqlite::Connection) -> Result<T, String>,
    {
        crate::db::with_db_impl(Some(td.pool_arc()), f)
    }

    #[test]
    fn round_trip_create_and_get() {
        let td = TestDb::new();
        insert_project(&td, "p1");
        let doc = Document {
            id: "d1".into(), project_id: "p1".into(), display_name: "Note 1".into(),
            mime_type: Some("text/markdown".into()), content: "# Hello".into(),
            metadata: None, created_at: "2026-06-22T00:00:00Z".into(),
        };
        call_with_pool(&td, |conn| upsert_document_with_conn(conn, &doc)).unwrap();
        let fetched = call_with_pool(&td, |conn| get_document_with_conn(conn, "d1")).unwrap().unwrap();
        assert_eq!(fetched.content, "# Hello");
        assert_eq!(fetched.display_name, "Note 1");
        assert_eq!(fetched.mime_type.as_deref(), Some("text/markdown"));
    }

    #[test]
    fn list_for_project_filters_correctly() {
        let td = TestDb::new();
        insert_project(&td, "p1");
        insert_project(&td, "p2");
        let d1 = Document {
            id: "d1".into(), project_id: "p1".into(), display_name: "A".into(),
            mime_type: None, content: "x".into(), metadata: None,
            created_at: "2026-06-22T00:00:00Z".into(),
        };
        let d2 = Document {
            id: "d2".into(), project_id: "p2".into(), display_name: "B".into(),
            mime_type: None, content: "y".into(), metadata: None,
            created_at: "2026-06-22T00:00:00Z".into(),
        };
        call_with_pool(&td, |conn| upsert_document_with_conn(conn, &d1)).unwrap();
        call_with_pool(&td, |conn| upsert_document_with_conn(conn, &d2)).unwrap();
        let p1_docs = call_with_pool(&td, |conn| list_documents_for_project_with_conn(conn, "p1")).unwrap();
        assert_eq!(p1_docs.len(), 1);
        assert_eq!(p1_docs[0].id, "d1");
    }

    #[test]
    fn list_all_documents_includes_every_project() {
        let td = TestDb::new();
        insert_project(&td, "p1");
        insert_project(&td, "p2");
        let d1 = Document {
            id: "d1".into(), project_id: "p1".into(), display_name: "A".into(),
            mime_type: None, content: "x".into(), metadata: None,
            created_at: "2026-06-22T00:00:00Z".into(),
        };
        let d2 = Document {
            id: "d2".into(), project_id: "p2".into(), display_name: "B".into(),
            mime_type: None, content: "y".into(), metadata: None,
            created_at: "2026-06-22T00:00:00Z".into(),
        };
        call_with_pool(&td, |conn| upsert_document_with_conn(conn, &d1)).unwrap();
        call_with_pool(&td, |conn| upsert_document_with_conn(conn, &d2)).unwrap();
        let all = call_with_pool(&td, |conn| list_all_documents_with_conn(conn, 100)).unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn update_document_content_modifies_both_fields() {
        let td = TestDb::new();
        insert_project(&td, "p1");
        let d = Document {
            id: "d1".into(), project_id: "p1".into(), display_name: "A".into(),
            mime_type: None, content: "old".into(), metadata: None,
            created_at: "2026-06-22T00:00:00Z".into(),
        };
        call_with_pool(&td, |conn| upsert_document_with_conn(conn, &d)).unwrap();
        call_with_pool(&td, |conn| update_document_content_with_conn(conn, "d1", Some("Renamed"), Some("new"))).unwrap();
        let f = call_with_pool(&td, |conn| get_document_with_conn(conn, "d1")).unwrap().unwrap();
        assert_eq!(f.display_name, "Renamed");
        assert_eq!(f.content, "new");
    }

    #[test]
    fn delete_document_removes_row() {
        let td = TestDb::new();
        insert_project(&td, "p1");
        let d = Document {
            id: "d1".into(), project_id: "p1".into(), display_name: "A".into(),
            mime_type: None, content: "x".into(), metadata: None,
            created_at: "2026-06-22T00:00:00Z".into(),
        };
        call_with_pool(&td, |conn| upsert_document_with_conn(conn, &d)).unwrap();
        call_with_pool(&td, |conn| delete_document_with_conn(conn, "d1")).unwrap();
        let fetched = call_with_pool(&td, |conn| get_document_with_conn(conn, "d1")).unwrap();
        assert!(fetched.is_none());
    }

    // -- conn-taking variants for testing --

    pub fn upsert_document_with_conn(conn: &rusqlite::Connection, doc: &Document) -> Result<(), String> {
        let metadata_json = doc.metadata.as_ref()
            .and_then(|m| serde_json::to_string(m).ok());
        conn.execute(
            "INSERT OR REPLACE INTO project_documents (id, project_id, display_name, mime_type, content, metadata, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                doc.id, doc.project_id, doc.display_name, doc.mime_type,
                doc.content, metadata_json, doc.created_at,
            ],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_document_with_conn(conn: &rusqlite::Connection, id: &str) -> Result<Option<Document>, String> {
        let mut stmt = conn.prepare(
            "SELECT id, project_id, display_name, mime_type, content, metadata, created_at FROM project_documents WHERE id = ?1"
        ).map_err(|e| e.to_string())?;
        let mut rows = stmt.query_map(params![id], |row| {
            let metadata_str: Option<String> = row.get(5)?;
            Ok(Document {
                id: row.get(0)?, project_id: row.get(1)?, display_name: row.get(2)?,
                mime_type: row.get(3)?, content: row.get(4)?,
                metadata: metadata_str.and_then(|s| serde_json::from_str(&s).ok()),
                created_at: row.get(6)?,
            })
        }).map_err(|e| e.to_string())?;
        rows.next().transpose().map_err(|e| e.to_string())
    }

    pub fn list_documents_for_project_with_conn(conn: &rusqlite::Connection, project_id: &str) -> Result<Vec<Document>, String> {
        let mut stmt = conn.prepare(
            "SELECT id, project_id, display_name, mime_type, content, metadata, created_at FROM project_documents WHERE project_id = ?1 ORDER BY created_at DESC"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![project_id], |row| {
            let metadata_str: Option<String> = row.get(5)?;
            Ok(Document {
                id: row.get(0)?, project_id: row.get(1)?, display_name: row.get(2)?,
                mime_type: row.get(3)?, content: row.get(4)?,
                metadata: metadata_str.and_then(|s| serde_json::from_str(&s).ok()),
                created_at: row.get(6)?,
            })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn list_all_documents_with_conn(conn: &rusqlite::Connection, limit: i64) -> Result<Vec<Document>, String> {
        let mut stmt = conn.prepare(
            "SELECT id, project_id, display_name, mime_type, content, metadata, created_at FROM project_documents ORDER BY created_at DESC LIMIT ?1"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![limit], |row| {
            let metadata_str: Option<String> = row.get(5)?;
            Ok(Document {
                id: row.get(0)?, project_id: row.get(1)?, display_name: row.get(2)?,
                mime_type: row.get(3)?, content: row.get(4)?,
                metadata: metadata_str.and_then(|s| serde_json::from_str(&s).ok()),
                created_at: row.get(6)?,
            })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn update_document_content_with_conn(
        conn: &rusqlite::Connection,
        id: &str,
        display_name: Option<&str>,
        content: Option<&str>,
    ) -> Result<(), String> {
        if let Some(name) = display_name {
            conn.execute("UPDATE project_documents SET display_name = ?1 WHERE id = ?2", params![name, id])
                .map_err(|e| e.to_string())?;
        }
        if let Some(c) = content {
            conn.execute("UPDATE project_documents SET content = ?1 WHERE id = ?2", params![c, id])
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn delete_document_with_conn(conn: &rusqlite::Connection, id: &str) -> Result<(), String> {
        conn.execute("DELETE FROM project_documents WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
