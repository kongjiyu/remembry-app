//! Database module for Remembry local SQLite storage.

pub mod projects;
pub mod meetings;
pub mod documents;
pub mod gemini_key_metadata;
pub mod upload_jobs;
pub mod events;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use rusqlite::Connection;
use anyhow::Result;

pub use projects::Project;
pub use meetings::Meeting;
pub use meetings::MeetingNotes;
pub use meetings::TranscriptionResult;
pub use documents::Document;
pub use upload_jobs::UploadJobRecord;
pub use events::EventKnowledge;

pub struct DbPool {
    conn: Arc<Mutex<Connection>>,
}

impl Clone for DbPool {
    fn clone(&self) -> Self {
        Self {
            conn: Arc::clone(&self.conn),
        }
    }
}

pub(crate) static DB_POOL: std::sync::OnceLock<Arc<Mutex<Option<DbPool>>>> = std::sync::OnceLock::new();

fn schema_sql() -> &'static str {
    r#"
    CREATE TABLE IF NOT EXISTS projects (
        id          TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        color       TEXT DEFAULT 'bg-blue-500',
        description TEXT DEFAULT '',
        goals       TEXT DEFAULT '',
        created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_documents (
        id           TEXT PRIMARY KEY,
        project_id   TEXT NOT NULL,
        display_name TEXT NOT NULL,
        mime_type    TEXT,
        content      TEXT NOT NULL,
        metadata     TEXT,
        created_at   TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS meetings (
        id                   TEXT PRIMARY KEY,
        project_id           TEXT NOT NULL,
        title                TEXT NOT NULL,
        context              TEXT,
        file_name            TEXT,
        file_size            INTEGER,
        mime_type            TEXT,
        file_type            TEXT NOT NULL,
        created_at           TEXT NOT NULL,
        transcription        TEXT,
        event_type           TEXT NOT NULL DEFAULT 'meeting',
        event_tags           TEXT,
        knowledge_by_language TEXT,
        default_language     TEXT DEFAULT 'en',
        available_languages  TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS gemini_key_metadata (
        user_id      TEXT PRIMARY KEY,
        created_at   TEXT,
        last_used    TEXT,
        usage_count  INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS upload_jobs (
        job_id          TEXT PRIMARY KEY,
        status          TEXT NOT NULL,
        progress        INTEGER NOT NULL,
        message         TEXT NOT NULL,
        error           TEXT,
        meeting_id      TEXT,
        project_id      TEXT NOT NULL,
        title           TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        temp_path       TEXT,
        params_json     TEXT,
        gemini_file_name TEXT,
        job_type        TEXT NOT NULL DEFAULT 'upload'
    );
    "#
}

impl DbPool {
    pub fn new(db_path: &PathBuf) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(db_path)?;
        conn.execute_batch(schema_sql())?;
        // Migration: add event_type, event_tags, knowledge_by_language columns
        // to existing databases that only have notes_by_language
        migrate_meetings_table(&conn).map_err(|e| anyhow::anyhow!("Migration failed: {}", e))?;
        migrate_upload_jobs_table(&conn).map_err(|e| anyhow::anyhow!("Migration failed: {}", e))?;
        log::info!("SQLite database initialized at {:?}", db_path);
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn conn(&self) -> Arc<Mutex<Connection>> {
        Arc::clone(&self.conn)
    }
}

pub fn init_db(app_data_dir: &PathBuf) -> Result<()> {
    let db_path = app_data_dir.join("remembry.sqlite3");
    let pool = DbPool::new(&db_path)?;
    DB_POOL.set(Arc::new(Mutex::new(Some(pool)))).ok();
    Ok(())
}

/// Migrate existing meetings table to add event_type, event_tags, knowledge_by_language columns.
/// Existing rows get default values; notes_by_language is preserved as-is for later conversion.
fn migrate_meetings_table(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn.prepare("PRAGMA table_info(meetings)").map_err(|e| e.to_string())?;
    let columns: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    if !columns.contains(&"event_type".to_string()) {
        conn.execute(
            "ALTER TABLE meetings ADD COLUMN event_type TEXT NOT NULL DEFAULT 'meeting'",
            [],
        ).map_err(|e| e.to_string())?;
    }

    if !columns.contains(&"event_tags".to_string()) {
        conn.execute(
            "ALTER TABLE meetings ADD COLUMN event_tags TEXT",
            [],
        ).map_err(|e| e.to_string())?;
    }

    if !columns.contains(&"knowledge_by_language".to_string()) {
        conn.execute(
            "ALTER TABLE meetings ADD COLUMN knowledge_by_language TEXT",
            [],
        ).map_err(|e| e.to_string())?;
        // Migrate existing notes_by_language → knowledge_by_language for non-null rows
        conn.execute(
            "UPDATE meetings SET knowledge_by_language = notes_by_language WHERE notes_by_language IS NOT NULL AND knowledge_by_language IS NULL",
            [],
        ).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Migrate existing upload_jobs table to add job_type column.
fn migrate_upload_jobs_table(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn.prepare("PRAGMA table_info(upload_jobs)").map_err(|e| e.to_string())?;
    let columns: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    if !columns.contains(&"job_type".to_string()) {
        conn.execute(
            "ALTER TABLE upload_jobs ADD COLUMN job_type TEXT NOT NULL DEFAULT 'upload'",
            [],
        ).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[allow(dead_code)]
pub fn get_db() -> Option<Arc<Mutex<Option<DbPool>>>> {
    DB_POOL.get().cloned()
}

pub fn with_db<F, T>(f: F) -> Result<T, String>
where
    F: FnOnce(&rusqlite::Connection) -> Result<T, String>,
{
    with_db_impl(DB_POOL.get().cloned(), f)
}

pub fn with_db_impl<F, T>(pool_opt: Option<Arc<Mutex<Option<DbPool>>>>, f: F) -> Result<T, String>
where
    F: FnOnce(&rusqlite::Connection) -> Result<T, String>,
{
    let pool_guard = pool_opt.ok_or_else(|| "Database not initialized".to_string())?;
    let pool = pool_guard.lock().map_err(|_| "Database lock poisoned".to_string())?;
    let pool = pool.as_ref().ok_or_else(|| "Database not initialized".to_string())?;
    let conn_arc = pool.conn();
    let conn_guard = conn_arc.lock().map_err(|_| "Connection lock poisoned".to_string())?;
    f(&conn_guard)
}