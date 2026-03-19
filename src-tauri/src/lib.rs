mod credentials;
mod sidecar;
mod ipc;
mod tray;

use credentials::CredentialState;
use sidecar::SidecarState;
use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState::new())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().expect("failed to get app data dir");
            app.manage(CredentialState::new(app_data_dir));
            sidecar::spawn_sidecar(&app.handle())?;
            tray::setup_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            ipc::send_to_sidecar,
            credentials::store_api_key,
            credentials::get_api_key,
            credentials::delete_api_key,
            credentials::list_providers,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
