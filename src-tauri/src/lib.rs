mod chrome;
mod credentials;
mod ipc;
mod sidecar;
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState::new())
        .manage(CredentialState::new())
        .setup(|app| {
            let salt_path = app
                .path()
                .app_local_data_dir()
                .expect("failed to get app local data dir")
                .join("salt.txt");
            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;
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
            credentials::credentials_create_vault,
            credentials::credentials_unlock_vault,
            credentials::credentials_lock_vault,
            credentials::credentials_set_provider_key,
            credentials::credentials_clear_provider_key,
            credentials::credentials_get_status,
            credentials::credentials_get_onboarding_state,
            credentials::credentials_dismiss_api_key_prompt,
            credentials::credentials_sync_to_sidecar,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
