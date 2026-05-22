//! Project database operations.

use crate::db::with_db;
use rusqlite::params;
use uuid::Uuid;
use chrono::Utc;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Project {
    pub id: String,
    pub display_name: String,
    pub color: String,
    pub description: String,
    pub goals: String,
    pub created_at: String,
}

pub fn list_projects() -> Result<Vec<Project>, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, display_name, color, description, goals, created_at FROM projects ORDER BY created_at DESC"
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                display_name: row.get(1)?,
                color: row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "bg-blue-500".to_string()),
                description: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                goals: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                created_at: row.get(5)?,
            })
        }).map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }).map_err(|e| e.to_string())
}

pub fn create_project(display_name: &str, color: Option<&str>, description: Option<&str>, goals: Option<&str>) -> Result<Project, String> {
    let id = format!("project_{}", Uuid::new_v4());
    let created_at = Utc::now().to_rfc3339();
    let color = color.unwrap_or("bg-blue-500");
    let description = description.unwrap_or("");
    let goals = goals.unwrap_or("");

    with_db(|conn| {
        conn.execute(
            "INSERT INTO projects (id, display_name, color, description, goals, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, display_name, color, description, goals, created_at],
        ).map_err(|e| e.to_string())?;

        Ok(Project {
            id,
            display_name: display_name.to_string(),
            color: color.to_string(),
            description: description.to_string(),
            goals: goals.to_string(),
            created_at,
        })
    }).map_err(|e| e.to_string())
}

pub fn delete_project(project_id: &str) -> Result<(), String> {
    with_db(|conn| {
        conn.execute("DELETE FROM project_documents WHERE project_id = ?1", params![project_id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM meetings WHERE project_id = ?1", params![project_id])
            .map_err(|e| e.to_string())?;
        let deleted = conn.execute("DELETE FROM projects WHERE id = ?1", params![project_id])
            .map_err(|e| e.to_string())?;
        if deleted == 0 {
            return Err("Project not found".to_string());
        }
        Ok(())
    }).map_err(|e| e.to_string())
}

pub fn get_project(project_id: &str) -> Result<Option<Project>, String> {
    with_db(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, display_name, color, description, goals, created_at FROM projects WHERE id = ?1"
        ).map_err(|e| e.to_string())?;

        let mut rows = stmt.query_map(params![project_id], |row| {
            Ok(Project {
                id: row.get(0)?,
                display_name: row.get(1)?,
                color: row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "bg-blue-500".to_string()),
                description: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                goals: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                created_at: row.get(5)?,
            })
        }).map_err(|e| e.to_string())?;

        Ok(rows.next().transpose().map_err(|e| e.to_string())?)
    }).map_err(|e| e.to_string())
}

pub fn update_project(project_id: &str, display_name: &str, color: Option<&str>, description: Option<&str>, goals: Option<&str>) -> Result<Project, String> {
    with_db(|conn| {
        let color = color.unwrap_or("bg-blue-500");
        let description = description.unwrap_or("");
        let goals = goals.unwrap_or("");

        let updated = conn.execute(
            "UPDATE projects SET display_name = ?1, color = ?2, description = ?3, goals = ?4 WHERE id = ?5",
            params![display_name, color, description, goals, project_id],
        ).map_err(|e| e.to_string())?;

        if updated == 0 {
            return Err("Project not found".to_string());
        }

        let mut stmt = conn.prepare(
            "SELECT id, display_name, color, description, goals, created_at FROM projects WHERE id = ?1"
        ).map_err(|e| e.to_string())?;

        let mut rows = stmt.query_map(params![project_id], |row| {
            Ok(Project {
                id: row.get(0)?,
                display_name: row.get(1)?,
                color: row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "bg-blue-500".to_string()),
                description: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                goals: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                created_at: row.get(5)?,
            })
        }).map_err(|e| e.to_string())?;

        rows.next()
            .transpose()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Project not found after update".to_string())
    }).map_err(|e| e.to_string())
}