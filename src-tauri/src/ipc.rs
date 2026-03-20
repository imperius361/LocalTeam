use crate::sidecar;
use tauri::AppHandle;

#[tauri::command]
pub async fn send_to_sidecar(app: AppHandle, message: String) -> Result<(), String> {
    sidecar::write_to_sidecar(&app, &message)
}

#[tauri::command]
pub async fn restart_sidecar(app: AppHandle) -> Result<(), String> {
    sidecar::spawn_sidecar(&app)
}
