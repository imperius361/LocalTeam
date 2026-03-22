use serde::{Deserialize, Serialize};
use std::fs::{create_dir_all, read_to_string, write};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const NEMOCLAW_STATE_FILE: &str = "nemoclaw-state.json";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProfileSummary {
    pub id: String,
    pub label: String,
    pub provider: String,
    pub model: String,
    pub availability: String,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NemoclawStateFile {
    onboarding_completed: bool,
    updated_at: u64,
    profiles: Vec<RuntimeProfileSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NemoclawStatus {
    pub onboarding_completed: bool,
    pub profiles: Vec<RuntimeProfileSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?;
    create_dir_all(&dir)
        .map_err(|error| format!("Failed to prepare Nemoclaw state directory: {error}"))?;
    Ok(dir.join(NEMOCLAW_STATE_FILE))
}

fn read_nemoclaw_state(app: &AppHandle) -> Result<NemoclawStateFile, String> {
    let path = state_path(app)?;
    match read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|error| format!("Failed to parse Nemoclaw state file: {error}")),
        Err(_) => Ok(NemoclawStateFile::default()),
    }
}

fn write_nemoclaw_state(app: &AppHandle, state: &NemoclawStateFile) -> Result<(), String> {
    let path = state_path(app)?;
    let raw = serde_json::to_string_pretty(state)
        .map_err(|error| format!("Failed to serialize Nemoclaw state: {error}"))?;
    write(path, format!("{raw}\n"))
        .map_err(|error| format!("Failed to persist Nemoclaw state: {error}"))
}

fn current_nemoclaw_status(app: &AppHandle) -> Result<NemoclawStatus, String> {
    let state = read_nemoclaw_state(app)?;
    Ok(NemoclawStatus {
        onboarding_completed: state.onboarding_completed,
        profiles: state.profiles,
        last_error: state.last_error,
    })
}

#[tauri::command]
pub async fn nemoclaw_get_status(app: AppHandle) -> Result<NemoclawStatus, String> {
    current_nemoclaw_status(&app)
}

#[tauri::command]
pub async fn nemoclaw_launch_onboarding(app: AppHandle) -> Result<NemoclawStatus, String> {
    let mut state = read_nemoclaw_state(&app)?;
    state.onboarding_completed = true;
    state.updated_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    if state.profiles.is_empty() {
        state.profiles = vec![
            RuntimeProfileSummary {
                id: "nemoclaw/local-default".into(),
                label: "Local Default".into(),
                provider: "local".into(),
                model: "openclaw-local".into(),
                availability: "ready".into(),
            },
            RuntimeProfileSummary {
                id: "nemoclaw/hosted-default".into(),
                label: "Hosted Default".into(),
                provider: "hosted".into(),
                model: "openclaw-hosted".into(),
                availability: "ready".into(),
            },
        ];
    }
    write_nemoclaw_state(&app, &state)?;
    current_nemoclaw_status(&app)
}
