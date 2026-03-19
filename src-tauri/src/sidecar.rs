use std::sync::Mutex;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

pub struct SidecarState {
    pub child: Mutex<Option<CommandChild>>,
}

impl SidecarState {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }
}

pub fn spawn_sidecar(app: &tauri::AppHandle) -> Result<(), String> {
    let shell = app.shell();

    // In dev mode, run the sidecar via tsx directly.
    // In production, use the bundled SEA binary via sidecar().
    let is_dev = cfg!(debug_assertions);

    let (mut rx, child) = if is_dev {
        // Resolve the project root (one level up from src-tauri/)
        let project_root = std::env::current_dir()
            .map_err(|e| format!("Failed to get cwd: {e}"))?
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::env::current_dir().unwrap());
        let sidecar_dir = project_root.join("src-sidecar");

        shell
            .command("node")
            .args(["--import", "tsx", "src/index.ts"])
            .current_dir(sidecar_dir)
            .spawn()
            .map_err(|e| format!("Failed to spawn sidecar (dev): {e}"))?
    } else {
        shell
            .sidecar("localteam-sidecar")
            .map_err(|e| format!("Failed to create sidecar command: {e}"))?
            .spawn()
            .map_err(|e| format!("Failed to spawn sidecar: {e}"))?
    };

    // Store the child process handle
    let state = app.state::<SidecarState>();
    *state.child.lock().unwrap() = Some(child);

    // Spawn a task to read sidecar output
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    // Forward sidecar responses to the frontend
                    let line_str = String::from_utf8_lossy(&line).to_string();
                    let _ = app_handle.emit("sidecar-stdout", &line_str);
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[sidecar stderr] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(status) => {
                    eprintln!("[sidecar] terminated with status: {:?}", status);
                    let _ = app_handle.emit("sidecar-terminated", &format!("{:?}", status));
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}
