use std::process::Command;

mod presence;

/// Report the desktop Do-Not-Disturb state by reading GNOME's notification
/// banner setting.
///
/// `gsettings get org.gnome.desktop.notifications show-banners` prints `true`
/// when banners are shown (DND inactive) and `false` when they are suppressed
/// (DND active). Anything else — a non-GNOME desktop, gsettings missing, a
/// non-zero exit, or unexpected output — is reported as `"unknown"` so the UI
/// can degrade to the quiet path rather than guess wrong.
#[tauri::command]
fn dnd_state() -> String {
    let output = Command::new("gsettings")
        .args(["get", "org.gnome.desktop.notifications", "show-banners"])
        .output();

    match output {
        Ok(out) if out.status.success() => {
            match String::from_utf8_lossy(&out.stdout).trim() {
                "false" => "active".to_string(),
                "true" => "inactive".to_string(),
                _ => "unknown".to_string(),
            }
        }
        _ => "unknown".to_string(),
    }
}

/// Quit the whole app. The tray "Quit" menu item invokes this so quitting is
/// reliable across platforms (the predefined Quit item does not exit on every
/// Linux tray), and because the main window is hidden there is no window to close.
#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

/// Seconds since the last user input (keyboard/mouse), from the platform's
/// presence provider, or `None` when no provider is available so the UI can
/// fall back to honest manual mode.
#[tauri::command]
fn idle_seconds() -> Option<f64> {
    presence::idle_seconds()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        // Autostart-on-login. On macOS we register a LaunchAgent; the launch
        // args keep the app starting hidden-to-tray exactly as a normal launch.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .invoke_handler(tauri::generate_handler![dnd_state, quit, idle_seconds])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
