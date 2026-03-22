mod chrome;
mod credentials;
mod e2e;
mod ipc;
mod sidecar;
mod tray;

use e2e::E2eState;
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
        .manage(E2eState::new())
        .manage(SidecarState::new())
        .setup(|app| {
            chrome::setup_app_chrome(app)?;
            if !e2e::is_e2e_mode() {
                sidecar::spawn_sidecar(&app.handle())?;
            }
            tray::setup_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            chrome::open_settings_window,
            e2e::get_runtime_context,
            e2e::emit_test_workspace_selected,
            e2e::trigger_test_sidecar_termination,
            e2e::shutdown_test_app,
            ipc::pick_project_folder,
            ipc::send_to_sidecar,
            ipc::restart_sidecar,
            credentials::nemoclaw_get_status,
            credentials::nemoclaw_launch_onboarding,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
