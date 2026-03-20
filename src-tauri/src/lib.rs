mod sidecar;
mod ipc;
mod tray;

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
            let salt_path = app
                .path()
                .app_local_data_dir()
                .expect("failed to get app local data dir")
                .join("salt.txt");
            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;
            sidecar::spawn_sidecar(&app.handle())?;
            tray::setup_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            ipc::send_to_sidecar,
            ipc::restart_sidecar,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
