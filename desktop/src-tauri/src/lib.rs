//! Smurf desktop shell. Hosts the React UI only; the backend is smurf-server
//! (Docker, http://127.0.0.1:47821), which the UI talks to directly over HTTP/WebSocket.

use std::process::Command;

#[cfg(target_os = "macos")]
use tauri::{AppHandle, Manager, RunEvent};

mod directory_picker;

#[tauri::command]
fn clutch_host_os() -> &'static str {
    std::env::consts::OS
}

#[tauri::command]
fn clutch_pick_directory(
    title: Option<String>,
    default_path: Option<String>,
    show_hidden: Option<bool>,
) -> Option<String> {
    directory_picker::pick_directory(
        title.as_deref().unwrap_or("Select folder"),
        default_path.as_deref(),
        show_hidden.unwrap_or(true),
    )
    .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn clutch_cpu_arch() -> String {
    std::env::consts::ARCH.to_string()
}

/// Open a local file/URL with the OS default app (HTML → system browser).
#[tauri::command]
fn clutch_open_path(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("empty path".into());
    }
    let target = std::path::Path::new(trimmed);
    if !target.is_absolute() {
        return Err("path must be absolute".into());
    }
    if !target.exists() {
        return Err(format!("path does not exist: {trimmed}"));
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        // Empty window title is required: `start "" path`
        Command::new("cmd")
            .args(["/C", "start", "", trimmed])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            clutch_pick_directory,
            clutch_host_os,
            clutch_cpu_arch,
            clutch_open_path,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    #[cfg(target_os = "macos")]
    app.run(handle_run_event);
    #[cfg(not(target_os = "macos"))]
    app.run(|_, _| {});
}

#[cfg(target_os = "macos")]
fn handle_run_event(app: &AppHandle, event: RunEvent) {
    if let RunEvent::Reopen { .. } = event {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}
