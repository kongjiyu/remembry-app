//! Upload job database operations.

use crate::db::with_db;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadJobRecord {
    pub job_id: String,
    pub status: String,
    pub progress: u8,
    pub message: String,
    pub error: Option<String>,
    pub meeting_id: Option<String>,
    pub project_id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub temp_path: Option<String>,
    pub params_json: Option<String>,
    pub gemini_file_name: Option<String>,
}

/// Insert or replace an upload job record in SQLite.
pub fn upsert_upload_job(job: &UploadJobRecord) -> Result<(), String> {
    with_db(|conn| {
        conn.execute(
            "INSERT OR REPLACE INTO upload_jobs (job_id, status, progress, message, error, meeting_id, project_id, title, created_at, updated_at, temp_path, params_json, gemini_file_name) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                job.job_id,
                job.status,
                job.progress,
                job.message,
                job.error,
                job.meeting_id,
                job.project_id,
                job.title,
                job.created_at,
                job.updated_at,
                job.temp_path,
                job.params_json,
                job.gemini_file_name,
            ],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }).map_err(|e| e.to_string())
}

/// List all upload jobs ordered by created_at descending.
pub fn list_upload_jobs() -> Result<Vec<UploadJobRecord>, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT job_id, status, progress, message, error, meeting_id, project_id, title, created_at, updated_at, temp_path, params_json, gemini_file_name FROM upload_jobs ORDER BY created_at DESC"
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map([], |row| {
            Ok(UploadJobRecord {
                job_id: row.get(0)?,
                status: row.get(1)?,
                progress: row.get(2)?,
                message: row.get(3)?,
                error: row.get(4)?,
                meeting_id: row.get(5)?,
                project_id: row.get(6)?,
                title: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                temp_path: row.get(10)?,
                params_json: row.get(11)?,
                gemini_file_name: row.get(12)?,
            })
        }).map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }).map_err(|e| e.to_string())
}

/// Get a single upload job by job_id.
pub fn get_upload_job(job_id: &str) -> Result<Option<UploadJobRecord>, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT job_id, status, progress, message, error, meeting_id, project_id, title, created_at, updated_at, temp_path, params_json, gemini_file_name FROM upload_jobs WHERE job_id = ?1"
        ).map_err(|e| e.to_string())?;

        let mut rows = stmt.query_map(params![job_id], |row| {
            Ok(UploadJobRecord {
                job_id: row.get(0)?,
                status: row.get(1)?,
                progress: row.get(2)?,
                message: row.get(3)?,
                error: row.get(4)?,
                meeting_id: row.get(5)?,
                project_id: row.get(6)?,
                title: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
                temp_path: row.get(10)?,
                params_json: row.get(11)?,
                gemini_file_name: row.get(12)?,
            })
        }).map_err(|e| e.to_string())?;

        Ok(rows.next().transpose().map_err(|e| e.to_string())?)
    }).map_err(|e| e.to_string())
}

/// Update the status/progress/message/error/meeting_id/updated_at of an upload job.
pub fn update_upload_job_status(
    job_id: &str,
    status: &str,
    progress: u8,
    message: &str,
    error: Option<String>,
    meeting_id: Option<String>,
    updated_at: &str,
) -> Result<(), String> {
    with_db(|conn| {
        conn.execute(
            "UPDATE upload_jobs SET status = ?2, progress = ?3, message = ?4, error = ?5, meeting_id = ?6, updated_at = ?7 WHERE job_id = ?1",
            params![job_id, status, progress, message, error, meeting_id, updated_at],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }).map_err(|e| e.to_string())
}

/// Update the gemini_file_name on a job row.
pub fn update_gemini_file_name(job_id: &str, gemini_file_name: &str) -> Result<(), String> {
    with_db(|conn| {
        conn.execute(
            "UPDATE upload_jobs SET gemini_file_name = ?2 WHERE job_id = ?1",
            params![job_id, gemini_file_name],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }).map_err(|e| e.to_string())
}

/// Mark any non-terminal persisted jobs as failed on app startup.
/// Terminal statuses: completed, failed, cancelled
#[allow(dead_code)]
pub fn recover_interrupted_jobs() -> Result<usize, String> {
    with_db(recover_interrupted_jobs_with_conn)
}

#[allow(dead_code)]
pub fn recover_interrupted_jobs_with_conn(conn: &rusqlite::Connection) -> Result<usize, String> {
    let rows = conn.execute(
        "UPDATE upload_jobs SET status = 'failed', progress = 100, message = 'Upload interrupted before completion. Please upload again.', updated_at = datetime('now') WHERE status IN ('queued', 'uploading', 'processing', 'transcribing', 'saving', 'cleanup_pending')",
        [],
    ).map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Delete an upload job by job_id.
#[allow(dead_code)]
pub fn delete_upload_job(job_id: &str) -> Result<(), String> {
    with_db(|conn| {
        conn.execute("DELETE FROM upload_jobs WHERE job_id = ?1", params![job_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }).map_err(|e| e.to_string())
}

fn list_interrupted_jobs_query() -> &'static str {
    "SELECT job_id, status, progress, message, error, meeting_id, project_id, title, created_at, updated_at, temp_path, params_json, gemini_file_name FROM upload_jobs WHERE status IN ('queued', 'uploading', 'processing', 'transcribing', 'saving', 'cleanup_pending')"
}

/// List all non-terminal job records (used by startup recovery).
/// Terminal statuses: completed, failed, cancelled
pub fn list_interrupted_jobs() -> Result<Vec<UploadJobRecord>, String> {
    with_db(list_interrupted_jobs_with_conn)
}

pub fn list_interrupted_jobs_with_conn(conn: &rusqlite::Connection) -> Result<Vec<UploadJobRecord>, String> {
    let mut stmt = conn.prepare(list_interrupted_jobs_query()).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok(UploadJobRecord {
            job_id: row.get(0)?,
            status: row.get(1)?,
            progress: row.get(2)?,
            message: row.get(3)?,
            error: row.get(4)?,
            meeting_id: row.get(5)?,
            project_id: row.get(6)?,
            title: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
            temp_path: row.get(10)?,
            params_json: row.get(11)?,
            gemini_file_name: row.get(12)?,
        })
    }).map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn list_interrupted_jobs_with_gemini_file_query() -> &'static str {
    "SELECT job_id, status, progress, message, error, meeting_id, project_id, title, created_at, updated_at, temp_path, params_json, gemini_file_name FROM upload_jobs WHERE status IN ('queued', 'uploading', 'processing', 'transcribing', 'saving', 'cleanup_pending') AND gemini_file_name IS NOT NULL AND gemini_file_name != ''"
}

/// List non-terminal jobs that have a gemini_file_name set.
/// These represent uploads that were sent to Gemini but never completed.
/// Used during startup recovery to clean up stale remote files.
#[allow(dead_code)]
pub fn list_interrupted_jobs_with_gemini_file() -> Result<Vec<UploadJobRecord>, String> {
    with_db(list_interrupted_jobs_with_gemini_file_with_conn)
}

#[allow(dead_code)]
pub fn list_interrupted_jobs_with_gemini_file_with_conn(conn: &rusqlite::Connection) -> Result<Vec<UploadJobRecord>, String> {
    let mut stmt = conn.prepare(list_interrupted_jobs_with_gemini_file_query()).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok(UploadJobRecord {
            job_id: row.get(0)?,
            status: row.get(1)?,
            progress: row.get(2)?,
            message: row.get(3)?,
            error: row.get(4)?,
            meeting_id: row.get(5)?,
            project_id: row.get(6)?,
            title: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
            temp_path: row.get(10)?,
            params_json: row.get(11)?,
            gemini_file_name: row.get(12)?,
        })
    }).map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Clear the gemini_file_name field on a job, indicating the remote file has been deleted.
pub fn clear_gemini_file_name(job_id: &str) -> Result<(), String> {
    with_db(|conn| clear_gemini_file_name_with_conn(conn, job_id))
}

pub fn clear_gemini_file_name_with_conn(conn: &rusqlite::Connection, job_id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE upload_jobs SET gemini_file_name = NULL WHERE job_id = ?1",
        params![job_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Mark a specific job as failed with a given message and optional error.
#[allow(dead_code)]
pub fn mark_job_failed(job_id: &str, message: &str, error: Option<String>) -> Result<(), String> {
    with_db(|conn| {
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE upload_jobs SET status = 'failed', progress = 100, message = ?2, error = ?3, updated_at = ?4 WHERE job_id = ?1",
            params![job_id, message, error, now],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }).map_err(|e| e.to_string())
}

/// Clear the temp_path field on a job, indicating local file has been cleaned up.
pub fn clear_temp_path(job_id: &str) -> Result<(), String> {
    with_db(|conn| clear_temp_path_with_conn(conn, job_id)).map_err(|e| e.to_string())
}

pub fn clear_temp_path_with_conn(conn: &rusqlite::Connection, job_id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE upload_jobs SET temp_path = NULL WHERE job_id = ?1",
        params![job_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Mark a job as cleanup_pending — a non-terminal state indicating resources need cleanup.
/// When meeting_id is Some, a meeting was already saved and should be preserved.
pub fn mark_job_cleanup_pending(job_id: &str, message: &str, error: Option<String>, meeting_id: Option<String>) -> Result<(), String> {
    with_db(|conn| mark_job_cleanup_pending_with_conn(conn, job_id, message, error, meeting_id))
}

pub fn mark_job_cleanup_pending_with_conn(conn: &rusqlite::Connection, job_id: &str, message: &str, error: Option<String>, meeting_id: Option<String>) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE upload_jobs SET status = 'cleanup_pending', message = ?2, error = ?3, meeting_id = ?4, updated_at = ?5 WHERE job_id = ?1",
        params![job_id, message, error, meeting_id, now],
    ).map_err(|e| e.to_string())?;
    Ok(())
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
    }

    fn insert_job(
        conn: &rusqlite::Connection,
        job_id: &str,
        status: &str,
        gemini_file_name: Option<&str>,
    ) -> Result<(), String> {
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO upload_jobs (job_id, status, progress, message, project_id, title, created_at, updated_at, temp_path, params_json, gemini_file_name) VALUES (?1, ?2, 0, 'test', 'pid', 'title', ?3, ?3, NULL, NULL, ?4)",
            rusqlite::params![job_id, status, now, gemini_file_name],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    #[test]
    fn list_interrupted_jobs_returns_only_non_terminal() {
        let td = TestDb::new();

        td.with_conn(|conn| {
            insert_job(conn, "job_active", "queued", None).unwrap();
            insert_job(conn, "job_uploading", "uploading", Some("gemini_123")).unwrap();
            insert_job(conn, "job_completed", "completed", None).unwrap();
            insert_job(conn, "job_failed", "failed", None).unwrap();
            insert_job(conn, "job_cancelled", "cancelled", None).unwrap();
            Ok(())
        }).unwrap();

        let pool_arc: Arc<Mutex<Option<crate::db::DbPool>>> = Arc::new(Mutex::new(Some(td.pool.clone())));
        let jobs = crate::db::with_db_impl(Some(pool_arc), list_interrupted_jobs_with_conn).unwrap();

        let statuses: Vec<&str> = jobs.iter().map(|j| j.status.as_str()).collect();
        assert!(statuses.contains(&"queued"), "should contain queued, got {:?}", statuses);
        assert!(statuses.contains(&"uploading"), "should contain uploading, got {:?}", statuses);
        assert!(!statuses.contains(&"completed"), "should NOT contain completed");
        assert!(!statuses.contains(&"failed"), "should NOT contain failed");
        assert!(!statuses.contains(&"cancelled"), "should NOT contain cancelled");
    }

    #[test]
    fn list_interrupted_jobs_with_gemini_file_returns_only_active_with_remote_file() {
        let td = TestDb::new();

        td.with_conn(|conn| {
            insert_job(conn, "job_active_gemini", "uploading", Some("gemini_abc")).unwrap();
            insert_job(conn, "job_active_no_gemini", "queued", None).unwrap();
            insert_job(conn, "job_completed_gemini", "completed", Some("gemini_completed")).unwrap();
            insert_job(conn, "job_active_empty", "transcribing", Some("")).unwrap();
            insert_job(conn, "job_active_null", "saving", None).unwrap();
            Ok(())
        }).unwrap();

        let pool_arc: Arc<Mutex<Option<crate::db::DbPool>>> = Arc::new(Mutex::new(Some(td.pool.clone())));
        let jobs = crate::db::with_db_impl(Some(pool_arc), list_interrupted_jobs_with_gemini_file_with_conn).unwrap();

        assert_eq!(jobs.len(), 1, "expected 1 gemini job, got {:?}", jobs);
        assert_eq!(jobs[0].job_id, "job_active_gemini");
        assert_eq!(jobs[0].gemini_file_name.as_deref(), Some("gemini_abc"));
    }

    #[test]
    fn clear_gemini_file_name_clears_only_target_job() {
        let td = TestDb::new();

        td.with_conn(|conn| {
            insert_job(conn, "job_a", "uploading", Some("gemini_a")).unwrap();
            insert_job(conn, "job_b", "uploading", Some("gemini_b")).unwrap();
            insert_job(conn, "job_c", "uploading", Some("gemini_c")).unwrap();
            Ok(())
        }).unwrap();

        td.with_conn(|conn| {
            clear_gemini_file_name_with_conn(conn, "job_b")
        }).unwrap();

        let pool_arc: Arc<Mutex<Option<crate::db::DbPool>>> = Arc::new(Mutex::new(Some(td.pool.clone())));
        let jobs = crate::db::with_db_impl(Some(pool_arc), list_interrupted_jobs_with_gemini_file_with_conn).unwrap();

        let ids: Vec<&str> = jobs.iter().map(|j| j.job_id.as_str()).collect();
        assert!(ids.contains(&"job_a"), "job_a should remain, got {:?}", ids);
        assert!(!ids.contains(&"job_b"), "job_b should be cleared, got {:?}", ids);
        assert!(ids.contains(&"job_c"), "job_c should remain, got {:?}", ids);
    }

    #[test]
    fn recover_interrupted_jobs_marks_active_failed_but_not_terminal() {
        let td = TestDb::new();

        td.with_conn(|conn| {
            insert_job(conn, "active_1", "queued", None).unwrap();
            insert_job(conn, "active_2", "uploading", Some("gemini_x")).unwrap();
            insert_job(conn, "completed_1", "completed", None).unwrap();
            insert_job(conn, "failed_1", "failed", None).unwrap();
            insert_job(conn, "cancelled_1", "cancelled", None).unwrap();
            Ok(())
        }).unwrap();

        let pool_arc: Arc<Mutex<Option<crate::db::DbPool>>> = Arc::new(Mutex::new(Some(td.pool.clone())));
        let count = crate::db::with_db_impl(Some(pool_arc.clone()), recover_interrupted_jobs_with_conn).unwrap();

        assert_eq!(count, 2, "expected 2 rows updated, got {}", count);

        let records: std::collections::HashMap<String, String> = td.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT job_id, status FROM upload_jobs")
                .map_err(|e| e.to_string())?;
            let rows: Vec<(String, String)> = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            Ok(rows.into_iter().collect())
        }).unwrap();

        assert_eq!(records.get("active_1").map(|s| s.as_str()), Some("failed"), "active_1 should be failed");
        assert_eq!(records.get("active_2").map(|s| s.as_str()), Some("failed"), "active_2 should be failed");
        assert_eq!(records.get("completed_1").map(|s| s.as_str()), Some("completed"), "completed_1 unchanged");
        assert_eq!(records.get("failed_1").map(|s| s.as_str()), Some("failed"), "failed_1 unchanged");
        assert_eq!(records.get("cancelled_1").map(|s| s.as_str()), Some("cancelled"), "cancelled_1 unchanged");
    }

    #[test]
    fn recovery_marks_interrupted_job_without_gemini_file_failed() {
        let td = TestDb::new();

        td.with_conn(|conn| {
            insert_job(conn, "has_gemini", "transcribing", Some("gemini_xyz")).unwrap();
            insert_job(conn, "no_gemini", "queued", None).unwrap();
            insert_job(conn, "done", "completed", None).unwrap();
            Ok(())
        }).unwrap();

        let pool_arc: Arc<Mutex<Option<crate::db::DbPool>>> = Arc::new(Mutex::new(Some(td.pool.clone())));
        let count = crate::db::with_db_impl(Some(pool_arc.clone()), recover_interrupted_jobs_with_conn).unwrap();

        assert_eq!(count, 2, "expected 2 updated, got {}", count);

        let records: std::collections::HashMap<String, (String, Option<String>)> = td.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT job_id, status, gemini_file_name FROM upload_jobs")
                .map_err(|e| e.to_string())?;
            let rows: Vec<(String, String, Option<String>)> = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            Ok(rows.into_iter().map(|r| (r.0, (r.1, r.2))).collect())
        }).unwrap();

        assert_eq!(records.get("has_gemini").map(|r| r.0.as_str()), Some("failed"), "has_gemini should be failed");
        assert_eq!(records.get("has_gemini").and_then(|r| r.1.as_ref()).map(|s| s.as_str()), Some("gemini_xyz"), "gemini_file_name preserved");
        assert_eq!(records.get("no_gemini").map(|r| r.0.as_str()), Some("failed"), "no_gemini should be failed");
        assert!(records.get("no_gemini").and_then(|r| r.1.as_ref()).is_none(), "no_gemini gemini_file_name should be null");
        assert_eq!(records.get("done").map(|r| r.0.as_str()), Some("completed"), "done unchanged");
    }

    #[test]
    fn cleanup_pending_included_in_list_interrupted_jobs() {
        let td = TestDb::new();

        td.with_conn(|conn| {
            insert_job(conn, "job_cleanup_pending", "cleanup_pending", Some("gemini_cleanup")).unwrap();
            insert_job(conn, "job_completed", "completed", None).unwrap();
            insert_job(conn, "job_failed", "failed", None).unwrap();
            Ok(())
        }).unwrap();

        let pool_arc: Arc<Mutex<Option<crate::db::DbPool>>> = Arc::new(Mutex::new(Some(td.pool.clone())));
        let jobs = crate::db::with_db_impl(Some(pool_arc.clone()), list_interrupted_jobs_with_conn).unwrap();

        let statuses: Vec<&str> = jobs.iter().map(|j| j.status.as_str()).collect();
        assert!(statuses.contains(&"cleanup_pending"), "should contain cleanup_pending, got {:?}", statuses);
        assert_eq!(jobs.iter().find(|j| j.job_id == "job_cleanup_pending").map(|j| j.gemini_file_name.as_deref()), Some(Some("gemini_cleanup")));
    }

    #[test]
    fn mark_job_cleanup_pending_sets_correct_fields() {
        let td = TestDb::new();

        td.with_conn(|conn| {
            insert_job(conn, "job_pending", "uploading", Some("gemini_to_cleanup")).unwrap();
            Ok(())
        }).unwrap();

        let pool_arc: Arc<Mutex<Option<crate::db::DbPool>>> = Arc::new(Mutex::new(Some(td.pool.clone())));
        crate::db::with_db_impl(Some(pool_arc.clone()), |conn| {
            mark_job_cleanup_pending_with_conn(conn, "job_pending", "Cleanup required", Some("gemini delete failed".to_string()), Some("meeting_123".to_string()))
        }).unwrap();

        let jobs = crate::db::with_db_impl(Some(pool_arc), list_interrupted_jobs_with_conn).unwrap();
        let job = jobs.iter().find(|j| j.job_id == "job_pending").unwrap();
        assert_eq!(job.status, "cleanup_pending");
        assert_eq!(job.message, "Cleanup required");
        assert_eq!(job.error.as_deref(), Some("gemini delete failed"));
        assert_eq!(job.meeting_id.as_deref(), Some("meeting_123"));
        assert_eq!(job.gemini_file_name.as_deref(), Some("gemini_to_cleanup"), "gemini_file_name preserved for visibility");
    }

    #[test]
    fn clear_temp_path_clears_only_target_job() {
        let td = TestDb::new();

        td.with_conn(|conn| {
            let now = chrono::Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO upload_jobs (job_id, status, progress, message, project_id, title, created_at, updated_at, temp_path, params_json, gemini_file_name) VALUES (?1, ?2, 0, 'test', 'pid', 'title', ?3, ?3, ?4, NULL, NULL)",
                rusqlite::params!["job_a", "uploading", now, "/tmp/file_a.upload"],
            ).map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO upload_jobs (job_id, status, progress, message, project_id, title, created_at, updated_at, temp_path, params_json, gemini_file_name) VALUES (?1, ?2, 0, 'test', 'pid', 'title', ?3, ?3, ?4, NULL, NULL)",
                rusqlite::params!["job_b", "uploading", now, "/tmp/file_b.upload"],
            ).map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO upload_jobs (job_id, status, progress, message, project_id, title, created_at, updated_at, temp_path, params_json, gemini_file_name) VALUES (?1, ?2, 0, 'test', 'pid', 'title', ?3, ?3, ?4, NULL, NULL)",
                rusqlite::params!["job_c", "uploading", now, "/tmp/file_c.upload"],
            ).map_err(|e| e.to_string())?;
            Ok(())
        }).unwrap();

        td.with_conn(|conn| {
            clear_temp_path_with_conn(conn, "job_b")
        }).unwrap();

        let pool_arc: Arc<Mutex<Option<crate::db::DbPool>>> = Arc::new(Mutex::new(Some(td.pool.clone())));
        let jobs: Vec<UploadJobRecord> = crate::db::with_db_impl(Some(pool_arc), |conn| {
            let mut stmt = conn.prepare("SELECT job_id, status, temp_path FROM upload_jobs WHERE job_id IN ('job_a', 'job_b', 'job_c') ORDER BY job_id")
                .map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |row| Ok(UploadJobRecord {
                job_id: row.get(0)?,
                status: row.get(1)?,
                progress: 0,
                message: String::new(),
                error: None,
                meeting_id: None,
                project_id: String::new(),
                title: String::new(),
                created_at: String::new(),
                updated_at: String::new(),
                temp_path: row.get(2)?,
                params_json: None,
                gemini_file_name: None,
            })).map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
            Ok(rows)
        }).unwrap();

        assert_eq!(jobs[0].temp_path.as_deref(), Some("/tmp/file_a.upload"), "job_a unchanged");
        assert_eq!(jobs[1].temp_path.as_deref(), None, "job_b cleared");
        assert_eq!(jobs[2].temp_path.as_deref(), Some("/tmp/file_c.upload"), "job_c unchanged");
    }
}