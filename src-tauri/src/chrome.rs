use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};

pub const SETTINGS_WINDOW_LABEL: &str = "settings";
const WORKSPACE_SELECTED_EVENT: &str = "localteam://workspace-selected";
const OPEN_WORKSPACE_MENU_ID: &str = "open-project-workspace";
const OPEN_SETTINGS_MENU_ID: &str = "open-settings-window";
const RELOAD_MENU_ID: &str = "reload-window";
const TOGGLE_FULLSCREEN_MENU_ID: &str = "toggle-fullscreen-window";

pub fn setup_app_chrome(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle();
    let menu = build_app_menu(handle)?;
    handle.set_menu(menu)?;

    handle.on_menu_event(|app, event| match event.id().as_ref() {
        OPEN_WORKSPACE_MENU_ID => {
            if let Ok(Some(root_path)) = crate::ipc::prompt_for_project_folder(app, None) {
                let _ = app.emit(WORKSPACE_SELECTED_EVENT, serde_json::json!({ "rootPath": root_path }));
            }
        }
        OPEN_SETTINGS_MENU_ID => {
            let _ = open_or_focus_settings_window(app);
        }
        RELOAD_MENU_ID => {
            if let Some(window) = focused_webview_window(app) {
                let _ = window.eval("window.location.reload()");
            }
        }
        TOGGLE_FULLSCREEN_MENU_ID => {
            if let Some(window) = focused_webview_window(app) {
                if let Ok(is_fullscreen) = window.is_fullscreen() {
                    let _ = window.set_fullscreen(!is_fullscreen);
                }
            }
        }
        _ => {}
    });

    Ok(())
}

fn focused_webview_window(app: &AppHandle) -> Option<tauri::WebviewWindow<tauri::Wry>> {
    app.webview_windows().into_values().find(|window| {
        window.is_focused().unwrap_or(false)
    })
}

pub fn open_or_focus_settings_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        window.show()?;
        window.set_focus()?;
        return Ok(());
    }

    WebviewWindowBuilder::new(
        app,
        SETTINGS_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("LocalTeam Settings")
    .center()
    .inner_size(960.0, 820.0)
    .min_inner_size(760.0, 640.0)
    .resizable(true)
    .build()?;

    Ok(())
}

#[tauri::command]
pub async fn open_settings_window(app: AppHandle) -> Result<(), String> {
    open_or_focus_settings_window(&app).map_err(|error| error.to_string())
}

fn build_app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let pkg_info = app.package_info();
    let config = app.config();
    let about_metadata = tauri::menu::AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|publisher| vec![publisher]),
        ..Default::default()
    };

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(
                app,
                OPEN_WORKSPACE_MENU_ID,
                "Open Workspace...",
                true,
                Some("CmdOrCtrl+O"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, OPEN_SETTINGS_MENU_ID, "Settings...", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(app, RELOAD_MENU_ID, "Reload", true, Some("CmdOrCtrl+R"))?,
            &MenuItem::with_id(
                app,
                TOGGLE_FULLSCREEN_MENU_ID,
                "Toggle Full Screen",
                true,
                Some("F11"),
            )?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let help_menu = Submenu::with_items(
        app,
        "Help",
        true,
        &[&PredefinedMenuItem::about(app, None, Some(about_metadata))?],
    )?;

    Menu::with_items(app, &[&file_menu, &edit_menu, &view_menu, &window_menu, &help_menu])
}
