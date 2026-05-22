//! Meeting database operations.

use crate::db::events::EventKnowledge;
use crate::db::with_db;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Meeting {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub context: Option<String>,
    pub file_name: Option<String>,
    pub file_size: Option<i64>,
    pub mime_type: Option<String>,
    pub file_type: String,
    pub created_at: String,
    pub transcription: Option<TranscriptionResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub knowledge_by_language: Option<serde_json::Value>,
    pub default_language: Option<String>,
    pub available_languages: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionResult {
    pub text: String,
    pub language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingNotes {
    pub summary: String,
    pub action_items: Vec<ActionItem>,
    pub decisions: Vec<String>,
    pub questions_and_answers: Vec<QAndA>,
    pub key_points: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionItem {
    pub task: String,
    pub assignee: Option<String>,
    pub due_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QAndA {
    pub question: String,
    pub answer: String,
}

pub fn list_meetings(project_id: Option<&str>) -> Result<Vec<Meeting>, String> {
    with_db(|conn| {
        let sql = match project_id {
            Some(_) => {
                "SELECT id, project_id, title, context, file_name, file_size, mime_type, file_type, \
                 created_at, transcription, knowledge_by_language, event_type, event_tags, \
                 default_language, available_languages \
                 FROM meetings WHERE project_id = ?1 ORDER BY created_at DESC"
            }
            None => {
                "SELECT id, project_id, title, context, file_name, file_size, mime_type, file_type, \
                 created_at, transcription, knowledge_by_language, event_type, event_tags, \
                 default_language, available_languages \
                 FROM meetings ORDER BY created_at DESC"
            }
        };

        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;

        let rows = if let Some(pid) = project_id {
            stmt.query_map(params![pid], meeting_row_map)
        } else {
            stmt.query_map([], meeting_row_map)
        }.map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }).map_err(|e| e.to_string())
}

fn meeting_row_map(row: &rusqlite::Row) -> rusqlite::Result<Meeting> {
    let transcription_str: Option<String> = row.get(9)?;
    let knowledge_by_language_str: Option<String> = row.get(10)?;
    let event_type_str: Option<String> = row.get(11)?;
    let event_tags_str: Option<String> = row.get(12)?;
    let default_language: Option<String> = row.get(13)?;
    let available_languages_str: Option<String> = row.get(14)?;

    Ok(Meeting {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        context: row.get(3)?,
        file_name: row.get(4)?,
        file_size: row.get(5)?,
        mime_type: row.get(6)?,
        file_type: row.get(7)?,
        created_at: row.get(8)?,
        transcription: transcription_str.and_then(|s| serde_json::from_str(&s).ok()),
        event_type: event_type_str,
        event_tags: event_tags_str.and_then(|s| serde_json::from_str(&s).ok()),
        knowledge_by_language: knowledge_by_language_str.and_then(|s| serde_json::from_str(&s).ok()),
        default_language,
        available_languages: available_languages_str.and_then(|s| serde_json::from_str(&s).ok()),
    })
}

pub fn get_meeting(meeting_id: &str) -> Result<Option<Meeting>, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, project_id, title, context, file_name, file_size, mime_type, file_type, \
             created_at, transcription, knowledge_by_language, event_type, event_tags, \
             default_language, available_languages \
             FROM meetings WHERE id = ?1"
        ).map_err(|e| e.to_string())?;

        let mut rows = stmt.query_map(params![meeting_id], meeting_row_map)
            .map_err(|e| e.to_string())?;

        Ok(rows.next().transpose().map_err(|e| e.to_string())?)
    }).map_err(|e| e.to_string())
}

pub fn upsert_meeting(meeting: &Meeting) -> Result<(), String> {
    with_db(|conn| {
        let transcription_json = meeting.transcription.as_ref()
            .and_then(|t| serde_json::to_string(t).ok());
        let knowledge_json = meeting.knowledge_by_language.as_ref()
            .and_then(|n| serde_json::to_string(n).ok());
        let event_tags_json = meeting.event_tags.as_ref()
            .and_then(|t| serde_json::to_string(t).ok());
        let available_langs_json = meeting.available_languages.as_ref()
            .and_then(|a| serde_json::to_string(a).ok());

        conn.execute(
            "INSERT OR REPLACE INTO meetings \
             (id, project_id, title, context, file_name, file_size, mime_type, file_type, created_at, \
              transcription, knowledge_by_language, event_type, event_tags, default_language, available_languages) \
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
            params![
                meeting.id,
                meeting.project_id,
                meeting.title,
                meeting.context,
                meeting.file_name,
                meeting.file_size,
                meeting.mime_type,
                meeting.file_type,
                meeting.created_at,
                transcription_json,
                knowledge_json,
                meeting.event_type,
                event_tags_json,
                meeting.default_language,
                available_langs_json,
            ],
        ).map_err(|e| e.to_string())?;

        Ok(())
    }).map_err(|e| e.to_string())
}

pub fn get_meeting_notes(meeting_id: &str, language: &str) -> Result<Option<MeetingNotes>, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare("SELECT knowledge_by_language FROM meetings WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        let notes_json: Option<String> = stmt.query_row(params![meeting_id], |row| row.get(0))
            .map_err(|e| e.to_string())
            .ok();

        let notes_value = match notes_json {
            Some(s) => serde_json::from_str::<serde_json::Value>(&s).map_err(|e| e.to_string())?,
            None => return Ok(None),
        };

        let lang_notes = if language == "en" {
            notes_value.get("en").or(notes_value.get("default"))
        } else {
            notes_value.get(language)
        };

        match lang_notes {
            Some(v) => {
                let notes: MeetingNotes = serde_json::from_value(v.clone())
                    .map_err(|e| e.to_string())?;
                Ok(Some(notes))
            }
            None => Ok(None),
        }
    }).map_err(|e| e.to_string())
}

pub fn update_meeting_notes(meeting_id: &str, language: &str, notes: &MeetingNotes) -> Result<(), String> {
    with_db(|conn| {
        let mut stmt = conn.prepare("SELECT knowledge_by_language FROM meetings WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        let existing: Option<String> = stmt.query_row(params![meeting_id], |row| row.get(0))
            .map_err(|e| e.to_string())
            .ok();

        let mut notes_map = existing
            .and_then(|s| serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&s).ok())
            .unwrap_or_default();

        let notes_value = serde_json::to_value(notes).map_err(|e| e.to_string())?;
        notes_map.insert(language.to_string(), notes_value);

        let notes_json = serde_json::to_string(&notes_map).map_err(|e| e.to_string())?;

        let languages: Vec<String> = notes_map.keys().cloned().collect();
        let langs_json = serde_json::to_string(&languages).map_err(|e| e.to_string())?;

        conn.execute(
            "UPDATE meetings SET knowledge_by_language = ?1, available_languages = ?2, \
             default_language = COALESCE(default_language, ?3) WHERE id = ?4",
            params![notes_json, langs_json, language, meeting_id],
        ).map_err(|e| e.to_string())?;

        Ok(())
    }).map_err(|e| e.to_string())
}

/// Get EventKnowledge for a meeting and language.
pub fn get_event_knowledge(meeting_id: &str, language: &str) -> Result<Option<EventKnowledge>, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare("SELECT knowledge_by_language FROM meetings WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        let notes_json: Option<String> = stmt.query_row(params![meeting_id], |row| row.get(0))
            .map_err(|e| e.to_string())
            .ok();

        let notes_value = match notes_json {
            Some(s) => serde_json::from_str::<serde_json::Value>(&s).map_err(|e| e.to_string())?,
            None => return Ok(None),
        };

        let lang_notes = if language == "en" {
            notes_value.get("en").or(notes_value.get("default"))
        } else {
            notes_value.get(language)
        };

        match lang_notes {
            Some(v) => {
                let knowledge: EventKnowledge = serde_json::from_value(v.clone())
                    .map_err(|e| e.to_string())?;
                Ok(Some(knowledge))
            }
            None => Ok(None),
        }
    }).map_err(|e| e.to_string())
}

/// Update EventKnowledge for a meeting and language.
pub fn update_event_knowledge(meeting_id: &str, language: &str, knowledge: &EventKnowledge) -> Result<(), String> {
    with_db(|conn| {
        let mut stmt = conn.prepare("SELECT knowledge_by_language FROM meetings WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        let existing: Option<String> = stmt.query_row(params![meeting_id], |row| row.get(0))
            .map_err(|e| e.to_string())
            .ok();

        let mut notes_map = existing
            .and_then(|s| serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&s).ok())
            .unwrap_or_default();

        let notes_value = serde_json::to_value(knowledge).map_err(|e| e.to_string())?;
        notes_map.insert(language.to_string(), notes_value);

        let notes_json = serde_json::to_string(&notes_map).map_err(|e| e.to_string())?;

        let languages: Vec<String> = notes_map.keys().cloned().collect();
        let langs_json = serde_json::to_string(&languages).map_err(|e| e.to_string())?;

        conn.execute(
            "UPDATE meetings SET knowledge_by_language = ?1, available_languages = ?2, \
             default_language = COALESCE(default_language, ?3) WHERE id = ?4",
            params![notes_json, langs_json, language, meeting_id],
        ).map_err(|e| e.to_string())?;

        Ok(())
    }).map_err(|e| e.to_string())
}

pub fn get_meeting_metadata(meeting_id: &str) -> Result<Option<MeetingMetadata>, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT available_languages, default_language, created_at FROM meetings WHERE id = ?1"
        ).map_err(|e| e.to_string())?;

        let row = stmt.query_row(params![meeting_id], |row| {
            let langs_str: Option<String> = row.get(0)?;
            let available_languages = langs_str.and_then(|s| serde_json::from_str(&s).ok());
            Ok(MeetingMetadata {
                available_languages,
                default_language: row.get(1)?,
                created_at: row.get(2)?,
            })
        }).map_err(|e| e.to_string()).ok();

        Ok(row)
    }).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MeetingMetadata {
    pub available_languages: Option<Vec<String>>,
    pub default_language: Option<String>,
    pub created_at: Option<String>,
}

pub fn delete_meeting(meeting_id: &str) -> Result<bool, String> {
    with_db(|conn| delete_meeting_inner(conn, meeting_id))
}

/// Delete a meeting and its associated transcript documents.
/// Takes an explicit connection so tests can use with_db_impl on an isolated pool.
pub fn delete_meeting_inner(conn: &rusqlite::Connection, meeting_id: &str) -> Result<bool, String> {
    let meeting: Option<Meeting> = {
        let mut stmt = conn.prepare(
            "SELECT id, project_id, title, context, file_name, file_size, mime_type, file_type, \
             created_at, transcription, knowledge_by_language, event_type, event_tags, \
             default_language, available_languages \
             FROM meetings WHERE id = ?1"
        ).map_err(|e| e.to_string())?;
        let mut rows = stmt.query_map(params![meeting_id], meeting_row_map)
            .map_err(|e| e.to_string())?;
        rows.next().transpose().map_err(|e| e.to_string())?
    };

    let Some(meeting) = meeting else {
        return Ok(false);
    };

    // Delete deterministic transcript document
    let deterministic_id = format!("meeting-transcript/{}", meeting_id);
    conn.execute(
        "DELETE FROM project_documents WHERE id = ?1",
        params![deterministic_id],
    ).map_err(|e| e.to_string())?;

    // Delete legacy transcript documents where id matches old pattern (documents/uuid)
    if let Some(ref transcription) = meeting.transcription {
        let legacy_display_name = format!("{}.txt", meeting.title);
        conn.execute(
            "DELETE FROM project_documents WHERE id LIKE 'documents/%' AND project_id = ?1 AND display_name = ?2 AND mime_type = 'text/plain' AND content = ?3",
            params![meeting.project_id, legacy_display_name, transcription.text],
        ).map_err(|e| e.to_string())?;
    }

    // Delete the meeting row
    conn.execute("DELETE FROM meetings WHERE id = ?1", params![meeting_id])
        .map_err(|e| e.to_string())?;

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

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
            std::mem::forget(tmp);
            Self { pool, _guard }
        }

        fn with_db<F, T>(&self, f: F) -> Result<T, String>
        where
            F: FnOnce(&rusqlite::Connection) -> Result<T, String>,
        {
            let conn_arc = self.pool.conn();
            let conn_guard = conn_arc.lock().map_err(|e| e.to_string())?;
            f(&conn_guard)
        }
    }

    #[test]
    fn delete_meeting_removes_deterministic_transcript_document() {
        let td = TestDb::new();
        let meeting_id = "test-meeting-det-001";
        let project_id = "test-project-det-001";
        let now = chrono::Utc::now().to_rfc3339();

        td.with_db(|conn| {
            conn.execute(
                "INSERT OR IGNORE INTO projects (id, display_name, color, description, goals, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![project_id, "Test Project", "bg-blue-500", "", "", &now],
            ).map_err(|e| e.to_string())?;
            Ok(())
        }).unwrap();

        let transcription_json = serde_json::to_string(&TranscriptionResult {
            text: "Test transcript content".to_string(),
            language: Some("en".to_string()),
        }).unwrap();

        td.with_db(|conn| {
            conn.execute(
                "INSERT INTO meetings (id, project_id, title, context, file_name, file_size, mime_type, file_type, created_at, transcription, knowledge_by_language, event_type, event_tags, default_language, available_languages) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                rusqlite::params![
                    meeting_id, project_id, "Test Meeting", Option::<String>::None,
                    "test.mp3", 1234_i64, "audio/mpeg", "audio", &now,
                    &transcription_json, Option::<String>::None, "meeting", Option::<String>::None,
                    "en", Option::<String>::None,
                ],
            ).map_err(|e| e.to_string())?;
            Ok(())
        }).unwrap();

        let doc_id = format!("meeting-transcript/{}", meeting_id);
        td.with_db(|conn| {
            conn.execute(
                "INSERT INTO project_documents (id, project_id, display_name, mime_type, content, metadata, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    &doc_id, project_id, "Test Meeting.txt", "text/plain",
                    "Test transcript content",
                    serde_json::to_string(&serde_json::json!({"source": "meeting_transcript", "meeting_id": meeting_id})).unwrap(),
                    &now,
                ],
            ).map_err(|e| e.to_string())?;
            Ok(())
        }).unwrap();

        let doc_exists_before = td.with_db(|conn| {
            let mut stmt = conn.prepare("SELECT 1 FROM project_documents WHERE id = ?1 LIMIT 1").map_err(|e| e.to_string())?;
            Ok(stmt.query_row(params![&doc_id], |_row| Ok(())).is_ok())
        }).unwrap();
        assert!(doc_exists_before, "Document should exist before deletion");

        let pool_arc: Arc<Mutex<Option<crate::db::DbPool>>> = Arc::new(Mutex::new(Some(td.pool.clone())));
        let result = crate::db::with_db_impl(Some(pool_arc.clone()), |conn| {
            delete_meeting_inner(conn, meeting_id)
        });
        assert!(result.is_ok(), "delete_meeting should succeed");
        assert!(result.unwrap(), "delete_meeting should return true for existing meeting");

        let meeting_still_exists = td.with_db(|conn| {
            let mut stmt = conn.prepare("SELECT 1 FROM meetings WHERE id = ?1 LIMIT 1").map_err(|e| e.to_string())?;
            Ok(stmt.query_row(params![meeting_id], |_row| Ok(())).is_ok())
        }).unwrap();
        assert!(!meeting_still_exists, "Meeting should be deleted");

        let doc_still_exists = td.with_db(|conn| {
            let mut stmt = conn.prepare("SELECT 1 FROM project_documents WHERE id = ?1 LIMIT 1").map_err(|e| e.to_string())?;
            Ok(stmt.query_row(params![&doc_id], |_row| Ok(())).is_ok())
        }).unwrap();
        assert!(!doc_still_exists, "Deterministic transcript document should be deleted with meeting");
    }

    #[test]
    fn delete_meeting_removes_legacy_transcript_document() {
        let td = TestDb::new();
        let meeting_id = "test-meeting-legacy-001";
        let project_id = "test-project-legacy-001";
        let legacy_doc_id = "documents/test-legacy-doc-001";
        let now = chrono::Utc::now().to_rfc3339();
        let transcript_text = "Legacy transcript content for cleanup test";

        td.with_db(|conn| {
            conn.execute(
                "INSERT OR IGNORE INTO projects (id, display_name, color, description, goals, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![project_id, "Test Project", "bg-blue-500", "", "", &now],
            ).map_err(|e| e.to_string())?;
            Ok(())
        }).unwrap();

        let transcription_json = serde_json::to_string(&TranscriptionResult {
            text: transcript_text.to_string(),
            language: Some("en".to_string()),
        }).unwrap();

        td.with_db(|conn| {
            conn.execute(
                "INSERT INTO meetings (id, project_id, title, context, file_name, file_size, mime_type, file_type, created_at, transcription, knowledge_by_language, event_type, event_tags, default_language, available_languages) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                rusqlite::params![
                    meeting_id, project_id, "Legacy Meeting Title", Option::<String>::None,
                    "test.mp3", 1234_i64, "audio/mpeg", "audio", &now,
                    &transcription_json, Option::<String>::None, "meeting", Option::<String>::None,
                    "en", Option::<String>::None,
                ],
            ).map_err(|e| e.to_string())?;
            Ok(())
        }).unwrap();

        td.with_db(|conn| {
            conn.execute(
                "INSERT INTO project_documents (id, project_id, display_name, mime_type, content, metadata, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    &legacy_doc_id, project_id, "Legacy Meeting Title.txt", "text/plain",
                    transcript_text, Option::<String>::None, &now,
                ],
            ).map_err(|e| e.to_string())?;
            Ok(())
        }).unwrap();

        let doc_exists_before = td.with_db(|conn| {
            let mut stmt = conn.prepare("SELECT 1 FROM project_documents WHERE id = ?1 LIMIT 1").map_err(|e| e.to_string())?;
            Ok(stmt.query_row(params![&legacy_doc_id], |_row| Ok(())).is_ok())
        }).unwrap();
        assert!(doc_exists_before, "Legacy document should exist before deletion");

        let pool_arc: Arc<Mutex<Option<crate::db::DbPool>>> = Arc::new(Mutex::new(Some(td.pool.clone())));
        let result = crate::db::with_db_impl(Some(pool_arc.clone()), |conn| {
            delete_meeting_inner(conn, meeting_id)
        });
        assert!(result.is_ok(), "delete_meeting should succeed");
        assert!(result.unwrap(), "delete_meeting should return true for existing meeting");

        let meeting_still_exists = td.with_db(|conn| {
            let mut stmt = conn.prepare("SELECT 1 FROM meetings WHERE id = ?1 LIMIT 1").map_err(|e| e.to_string())?;
            Ok(stmt.query_row(params![meeting_id], |_row| Ok(())).is_ok())
        }).unwrap();
        assert!(!meeting_still_exists, "Meeting should be deleted");

        let doc_still_exists = td.with_db(|conn| {
            let mut stmt = conn.prepare("SELECT 1 FROM project_documents WHERE id = ?1 LIMIT 1").map_err(|e| e.to_string())?;
            Ok(stmt.query_row(params![&legacy_doc_id], |_row| Ok(())).is_ok())
        }).unwrap();
        assert!(!doc_still_exists, "Legacy transcript document should be deleted when content matches");
    }

    #[test]
    fn delete_meeting_returns_false_for_nonexistent() {
        let td = TestDb::new();

        let pool_arc: Arc<Mutex<Option<crate::db::DbPool>>> = Arc::new(Mutex::new(Some(td.pool.clone())));
        let result = crate::db::with_db_impl(Some(pool_arc.clone()), |conn| {
            delete_meeting_inner(conn, "nonexistent-meeting-id")
        });
        assert!(result.is_ok(), "delete_meeting should succeed");
        assert!(!result.unwrap(), "delete_meeting should return false for nonexistent meeting");
    }
}