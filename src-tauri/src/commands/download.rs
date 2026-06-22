//! Audio download command — copies recorded audio from app_data_dir to user's Downloads.

use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri::Manager;

const SUBDIR: &str = "Remembry";

#[derive(Debug, PartialEq)]
pub struct DownloadResult {
    pub saved_path: PathBuf,
}

pub fn resolve_download_target(
    app_data_dir: &Path,
    downloads_dir: &Path,
    source_path: &Path,
    suggested_filename: Option<&str>,
) -> Result<PathBuf, String> {
    // 1. Reject if source_path is not under app_data_dir (path traversal guard)
    let canonical_source = source_path.canonicalize().map_err(|e| format!("Source not found: {}", e))?;
    let canonical_app = app_data_dir.canonicalize().map_err(|e| format!("App dir invalid: {}", e))?;
    if !canonical_source.starts_with(&canonical_app) {
        return Err("Source path is outside app data directory".to_string());
    }

    // 2. Resolve filename
    let filename = match suggested_filename {
        Some(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => canonical_source
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .ok_or_else(|| "Cannot derive filename".to_string())?,
    };

    // 3. Create target dir
    let target_dir = downloads_dir.join(SUBDIR);
    std::fs::create_dir_all(&target_dir).map_err(|e| format!("Cannot create dir: {}", e))?;

    // 4. Find non-colliding target
    let target = unique_target_path(&target_dir, &filename);
    Ok(target)
}

fn unique_target_path(dir: &Path, filename: &str) -> PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let stem = Path::new(filename).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = Path::new(filename).extension().map(|e| e.to_string_lossy().to_string());
    for n in 1..1000 {
        let suffix = match &ext {
            Some(e) => format!("{}-{}.{}", stem, n, e),
            None => format!("{}-{}", stem, n),
        };
        let p = dir.join(&suffix);
        if !p.exists() {
            return p;
        }
    }
    candidate
}

#[tauri::command]
pub async fn download_audio(
    app: AppHandle,
    source_path: String,
    suggested_filename: Option<String>,
) -> Result<String, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let downloads = dirs::download_dir()
        .ok_or_else(|| "Cannot find user's Downloads directory".to_string())?;
    let source = PathBuf::from(&source_path);

    let target = resolve_download_target(&app_data, &downloads, &source, suggested_filename.as_deref())?;
    std::fs::copy(&source, &target).map_err(|e| format!("Copy failed: {}", e))?;
    Ok(target.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn make_temp_dir(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("remembry-dl-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn rejects_source_outside_app_data() {
        let app_data = make_temp_dir("app");
        let downloads = make_temp_dir("dl");
        let outside = make_temp_dir("outside").join("evil.webm");
        fs::write(&outside, b"data").unwrap();
        let result = resolve_download_target(&app_data, &downloads, &outside, None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("outside"));
    }

    #[test]
    fn copies_file_inside_app_data() {
        let app_data = make_temp_dir("app2");
        let downloads = make_temp_dir("dl2");
        let audio = app_data.join("rec.webm");
        fs::write(&audio, b"audio-bytes").unwrap();
        let target = resolve_download_target(&app_data, &downloads, &audio, None).unwrap();
        assert!(target.starts_with(&downloads));
        assert_eq!(target.file_name().unwrap(), "rec.webm");
    }

    #[test]
    fn uses_suggested_filename() {
        let app_data = make_temp_dir("app3");
        let downloads = make_temp_dir("dl3");
        let audio = app_data.join("job123.webm");
        fs::write(&audio, b"x").unwrap();
        let target = resolve_download_target(&app_data, &downloads, &audio, Some("idea-discussion.webm")).unwrap();
        assert_eq!(target.file_name().unwrap(), "idea-discussion.webm");
    }

    #[test]
    fn appends_suffix_on_collision() {
        let app_data = make_temp_dir("app4");
        let downloads = make_temp_dir("dl4");
        let audio = app_data.join("rec.webm");
        fs::write(&audio, b"x").unwrap();
        let first = resolve_download_target(&app_data, &downloads, &audio, Some("rec.webm")).unwrap();
        fs::write(&first, b"existing").unwrap();
        let second = resolve_download_target(&app_data, &downloads, &audio, Some("rec.webm")).unwrap();
        assert_eq!(second.file_name().unwrap(), "rec-1.webm");
    }
}
