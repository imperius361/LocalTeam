mod chrome;
mod credentials;
mod ipc;
mod sidecar;
mod tray;

use sidecar::SidecarState;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState::new())
        .setup(|app| {
            chrome::setup_app_chrome(app)?;
            sidecar::spawn_sidecar(&app.handle())?;
            tray::setup_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            chrome::open_settings_window,
            ipc::pick_project_folder,
            ipc::send_to_sidecar,
            ipc::restart_sidecar,
            credentials::nemoclaw_get_status,
            credentials::nemoclaw_launch_onboarding,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
