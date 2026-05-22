//! Shared test utilities for commands.
//!
//! Integration tests that need a real AppHandle should live in src-tauri/tests/.

/// Holds an isolated test database pool for unit tests.
/// Each instance gets its own temp directory and DB file.
pub struct TestDb {
    pub pool: crate::db::DbPool,
    _guard: std::sync::MutexGuard<'static, ()>,
}

static TEST_GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());

impl TestDb {
    /// Create a new test DB with an isolated pool.
    /// Must hold the guard for the lifetime of the test.
    pub fn new() -> Self {
        let _guard = TEST_GUARD.lock().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("test.db");
        let pool = crate::db::DbPool::new(&db_path).unwrap();
        // Leak tmp so the DB file stays valid for the full test.
        std::mem::forget(tmp);
        Self { pool, _guard }
    }

    /// Run a closure with a borrowed connection from the pool.
    pub fn with_conn<F, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&rusqlite::Connection) -> Result<T, String>,
    {
        let conn_arc = self.pool.conn();
        let conn_guard = conn_arc.lock().map_err(|e| e.to_string())?;
        f(&conn_guard)
    }
}