use std::sync::Mutex;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

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
    stop_sidecar(app);

    let shell = app.shell();
    let is_dev = cfg!(debug_assertions);

    let (mut rx, child) = if is_dev {
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

    let state = app.state::<SidecarState>();
    *state.child.lock().unwrap() = Some(child);

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line_str = String::from_utf8_lossy(&line).to_string();
                    let _ = app_handle.emit("sidecar-stdout", &line_str);
                }
                CommandEvent::Stderr(line) => {
                    let message = String::from_utf8_lossy(&line).to_string();
                    eprintln!("[sidecar stderr] {message}");
                    if message.contains("started") {
                        let _ = app_handle.emit("sidecar-started", message);
                    }
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

pub fn stop_sidecar(app: &tauri::AppHandle) {
    let state = app.state::<SidecarState>();
    let child = {
        let mut child_lock = state.child.lock().unwrap();
        child_lock.take()
    };

    if let Some(child) = child {
        let _ = child.kill();
    }
}

pub fn write_to_sidecar(app: &tauri::AppHandle, message: &str) -> Result<(), String> {
    let state = app.state::<SidecarState>();
    let mut child_lock = state.child.lock().unwrap();
    if let Some(ref mut child) = *child_lock {
        child
            .write((message.to_string() + "\n").as_bytes())
            .map_err(|e| format!("Failed to write to sidecar: {e}"))?;
        Ok(())
    } else {
        Err("Sidecar not running".into())
    }
}
