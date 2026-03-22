use crate::sidecar;
use serde_json::Value;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};

pub fn prompt_for_project_folder(
    app: &AppHandle,
    starting_directory: Option<String>,
) -> Result<Option<String>, String> {
    let mut builder = app.dialog().file().set_title("Select a LocalTeam git workspace");

    if let Some(directory) = starting_directory
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        builder = builder.set_directory(PathBuf::from(directory));
    }

    let picked = builder.blocking_pick_folder();
    Ok(picked.and_then(file_path_to_string))
}

#[tauri::command]
pub async fn pick_project_folder(
    app: AppHandle,
    starting_directory: Option<String>,
) -> Result<Option<String>, String> {
    prompt_for_project_folder(&app, starting_directory)
}

fn file_path_to_string(path: FilePath) -> Option<String> {
    match path {
        FilePath::Path(path) => Some(path.display().to_string()),
        FilePath::Url(url) => url.to_file_path().ok().map(|path| path.display().to_string()),
    }
}

#[tauri::command]
pub async fn send_to_sidecar(app: AppHandle, message: String) -> Result<(), String> {
    if let Ok(parsed) = serde_json::from_str::<Value>(&message) {
        if parsed
            .get("method")
            .and_then(Value::as_str)
            .is_some_and(|method| method == "v1.credentials.sync")
        {
            return Err(
                "Direct credential sync is no longer supported. Nemoclaw manages secrets."
                    .into(),
            );
        }
    }

    sidecar::write_to_sidecar(&app, &message)
}

#[tauri::command]
pub async fn restart_sidecar(
    app: AppHandle,
) -> Result<(), String> {
    sidecar::spawn_sidecar(&app)?;
    Ok(())
}
