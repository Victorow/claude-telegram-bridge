use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

struct SidecarState(Mutex<Option<CommandChild>>);

async fn run_sidecar_with_stdin_line(app: &AppHandle, args: &[&str], stdin_line: &str) -> Result<String, String> {
    let sidecar = app
        .shell()
        .sidecar("bridge")
        .map_err(|e| e.to_string())?
        .args(args);
    let (mut rx, mut child) = sidecar.spawn().map_err(|e| e.to_string())?;

    child
        .write(format!("{stdin_line}\n").as_bytes())
        .map_err(|e| e.to_string())?;

    let mut stdout = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => stdout.push_str(&String::from_utf8_lossy(&bytes)),
            CommandEvent::Terminated(_) => break,
            _ => {}
        }
    }
    Ok(stdout.trim().to_string())
}

async fn spawn_sidecar(app: &AppHandle) -> Result<(), String> {
    let sidecar = app
        .shell()
        .sidecar("bridge")
        .map_err(|e| e.to_string())?
        .args(["status", "--json"]);
    let output = sidecar.output().await.map_err(|e| e.to_string())?;
    let raw = String::from_utf8(output.stdout).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let configured = value.get("configured").and_then(|v| v.as_bool()).unwrap_or(false);
    if !configured {
        return Ok(()); // nothing to do yet - the onboarding view is what's shown while unconfigured
    }

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
async fn start_bridge(app: AppHandle) -> Result<(), String> {
    spawn_sidecar(&app).await
}

#[tauri::command]
fn stop_bridge(app: AppHandle) -> Result<(), String> {
    kill_sidecar(&app)
}

#[tauri::command]
async fn complete_onboarding(app: AppHandle, token: String) -> Result<String, String> {
    run_sidecar_with_stdin_line(&app, &["onboard", "--json"], &token).await
}

#[tauri::command]
async fn update_settings(app: AppHandle, enabled: Option<bool>, granularity: Option<String>) -> Result<String, String> {
    let mut args: Vec<String> = vec!["settings".to_string(), "--json".to_string()];
    if let Some(e) = enabled {
        args.push("--set-enabled".to_string());
        args.push(e.to_string());
    }
    if let Some(g) = granularity {
        args.push("--set-granularity".to_string());
        args.push(g);
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    let sidecar = app
        .shell()
        .sidecar("bridge")
        .map_err(|e| e.to_string())?
        .args(arg_refs);
    let output = sidecar.output().await.map_err(|e| e.to_string())?;
    let result = String::from_utf8(output.stdout).map_err(|e| e.to_string())?.trim().to_string();

    kill_sidecar(&app)?;
    spawn_sidecar(&app).await?;

    Ok(result)
}

#[tauri::command]
async fn get_status(app: AppHandle) -> Result<String, String> {
    let running = {
        let state = app.state::<SidecarState>();
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        guard.is_some()
    };

    let sidecar = app
        .shell()
        .sidecar("bridge")
        .map_err(|e| e.to_string())?
        .args(["status", "--json"]);
    let output = sidecar.output().await.map_err(|e| e.to_string())?;
    let raw = String::from_utf8(output.stdout).map_err(|e| e.to_string())?;
    let mut value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if let Some(obj) = value.as_object_mut() {
        obj.insert("running".to_string(), serde_json::Value::Bool(running));
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
        .invoke_handler(tauri::generate_handler![
            start_bridge,
            stop_bridge,
            get_status,
            complete_onboarding,
            update_settings
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = spawn_sidecar(&handle).await {
                    eprintln!("failed to spawn bridge sidecar on startup: {e}");
                }
            });
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
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = spawn_sidecar(&app_handle).await;
                        });
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
