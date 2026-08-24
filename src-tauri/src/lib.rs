use std::process::Command;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![dnd_state])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
