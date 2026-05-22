//! Project Tauri commands.

use crate::db::{self, Project};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct ListProjectsResponse {
    pub success: bool,
    pub projects: Vec<Project>,
    pub count: usize,
}

#[derive(Debug, Serialize)]
pub struct CreateProjectResponse {
    pub success: bool,
    pub project: Project,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct DeleteProjectResponse {
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct UpdateProjectResponse {
    pub success: bool,
    pub project: Project,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateProjectParams {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub goals: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateProjectParams {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub goals: Option<String>,
}

#[tauri::command]
pub fn list_projects() -> Result<ListProjectsResponse, String> {
    let projects = db::projects::list_projects().map_err(|e| e.to_string())?;
    let count = projects.len();
    Ok(ListProjectsResponse {
        success: true,
        projects,
        count,
    })
}

#[tauri::command]
pub fn create_project(params: CreateProjectParams) -> Result<CreateProjectResponse, String> {
    if params.name.trim().is_empty() {
        return Err("Project name is required".to_string());
    }

    let project = db::projects::create_project(
        params.name.trim(),
        params.color.as_deref(),
        params.description.as_deref(),
        params.goals.as_deref(),
    ).map_err(|e| e.to_string())?;

    Ok(CreateProjectResponse {
        success: true,
        project,
        message: "Project created successfully.".to_string(),
    })
}

#[tauri::command]
pub fn delete_project(project_id: String) -> Result<DeleteProjectResponse, String> {
    db::projects::delete_project(&project_id).map_err(|e| e.to_string())?;
    Ok(DeleteProjectResponse {
        success: true,
        message: "Project deleted successfully.".to_string(),
    })
}

#[tauri::command]
pub fn update_project(project_id: String, params: UpdateProjectParams) -> Result<UpdateProjectResponse, String> {
    if params.name.trim().is_empty() {
        return Err("Project name is required".to_string());
    }

    let project = db::projects::update_project(
        &project_id,
        params.name.trim(),
        params.color.as_deref(),
        params.description.as_deref(),
        params.goals.as_deref(),
    ).map_err(|e| e.to_string())?;

    Ok(UpdateProjectResponse {
        success: true,
        project,
        message: "Project updated successfully.".to_string(),
    })
}

#[tauri::command]
pub fn get_project(project_id: String) -> Result<Option<Project>, String> {
    db::projects::get_project(&project_id).map_err(|e| e.to_string())
}