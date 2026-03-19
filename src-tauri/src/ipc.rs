use tauri::State;
use crate::sidecar::SidecarState;

#[tauri::command]
pub async fn send_to_sidecar(
    state: State<'_, SidecarState>,
    message: String,
) -> Result<(), String> {
    let mut child_lock = state.child.lock().unwrap();
    if let Some(ref mut child) = *child_lock {
        child
            .write((message + "\n").as_bytes())
            .map_err(|e| format!("Failed to write to sidecar: {e}"))?;
        Ok(())
    } else {
        Err("Sidecar not running".into())
    }
}
