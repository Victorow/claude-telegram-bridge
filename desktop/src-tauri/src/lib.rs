use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

struct SidecarState(Mutex<Option<CommandChild>>);

fn spawn_sidecar(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<SidecarState>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Ok(());
    }
    let sidecar = app
        .shell()
        .sidecar("bridge")
        .map_err(|e| e.to_string())?
        .args(["start"]);
    let (mut rx, child) = sidecar.spawn().map_err(|e| e.to_string())?;
    *guard = Some(child);
    drop(guard);

    // The sidecar can exit on its own (crash, killed externally) without going
    // through `kill_sidecar` - without this, `SidecarState` would keep saying
    // "running" forever after that, and `get_status` would never notice.
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Terminated(_) = event {
                let state = app_handle.state::<SidecarState>();
                if let Ok(mut guard) = state.0.lock() {
                    *guard = None;
                }
                break;
            }
        }
    });

    Ok(())
}

fn kill_sidecar(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<SidecarState>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.take() {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn start_bridge(app: AppHandle) -> Result<(), String> {
    spawn_sidecar(&app)
}

#[tauri::command]
fn stop_bridge(app: AppHandle) -> Result<(), String> {
    kill_sidecar(&app)
}

#[tauri::command]
async fn get_status(app: AppHandle) -> Result<String, String> {
    let running = {
        let state = app.state::<SidecarState>();
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        guard.is_some()
    };
    if !running {
        return Ok(serde_json::json!({ "running": false }).to_string());
    }

    let sidecar = app
        .shell()
        .sidecar("bridge")
        .map_err(|e| e.to_string())?
        .args(["status", "--json"]);
    let output = sidecar.output().await.map_err(|e| e.to_string())?;
    let raw = String::from_utf8(output.stdout).map_err(|e| e.to_string())?;
    let mut value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if let Some(obj) = value.as_object_mut() {
        obj.insert("running".to_string(), serde_json::Value::Bool(true));
    }
    Ok(value.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(SidecarState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![start_bridge, stop_bridge, get_status])
        .setup(|app| {
            let handle = app.handle().clone();
            if let Err(e) = spawn_sidecar(&handle) {
                eprintln!("failed to spawn bridge sidecar on startup: {e}");
            }
            if let Err(e) = app.autolaunch().enable() {
                eprintln!("failed to register autostart: {e}");
            }

            let start_i = MenuItem::with_id(app, "start", "Iniciar", true, None::<&str>)?;
            let stop_i = MenuItem::with_id(app, "stop", "Parar", true, None::<&str>)?;
            let open_i = MenuItem::with_id(app, "open", "Abrir", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&start_i, &stop_i, &open_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "start" => {
                        let _ = spawn_sidecar(app);
                    }
                    "stop" => {
                        let _ = kill_sidecar(app);
                    }
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        let _ = kill_sidecar(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
