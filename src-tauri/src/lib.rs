use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(target_os = "linux")]
mod autostart_heal;
mod game;
mod idle_gap;
mod presence;

use idle_gap::{Gap, GapTracker};

/// Idle stretches seen by the native sampler, shared with `idle_sample`.
static GAPS: Mutex<Option<GapTracker>> = Mutex::new(None);

fn now_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0.0, |d| d.as_secs_f64() * 1000.0)
}

/// Read idle time and feed it to the gap tracker. Returns idle seconds.
fn sample_idle() -> Option<f64> {
    let idle = presence::idle_seconds()?;
    if let Ok(mut g) = GAPS.lock() {
        g.get_or_insert_with(GapTracker::default).observe(now_ms(), idle * 1000.0);
    }
    Some(idle)
}

/// Sample idle time 4× a second off the webview, so a break that ends between
/// two (sparse) webview ticks is still seen. See idle_gap.rs.
fn spawn_idle_sampler() {
    std::thread::spawn(|| loop {
        let _ = sample_idle();
        std::thread::sleep(Duration::from_millis(250));
    });
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct IdleSample {
    idle_seconds: Option<f64>,
    gap: Option<Gap>,
}

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

/// Current idle seconds plus the longest idle stretch that ended since the last
/// call (see idle_gap.rs). The webview's tick loop reads this.
#[tauri::command]
fn idle_sample() -> IdleSample {
    let idle_seconds = sample_idle();
    let gap = GAPS.lock().ok().and_then(|mut g| g.as_mut().and_then(GapTracker::take));
    IdleSample { idle_seconds, gap }
}

/// Whether a Steam game is running, so the full-screen nudge never pops over it.
#[tauri::command]
fn game_running() -> bool {
    game::steam_game_running()
}

/// Re-register autostart when its recorded `Exec=` target has gone missing, so a
/// moved or upgraded binary cannot leave the entry dangling. Best-effort: every
/// failure is logged and ignored, because autostart is a convenience and must
/// never stop the app from starting.
#[cfg(target_os = "linux")]
fn heal_autostart(app: &tauri::AppHandle) {
    use tauri_plugin_autostart::ManagerExt;

    let manager = app.autolaunch();
    if !manager.is_enabled().unwrap_or(false) {
        return; // user hasn't asked for autostart — nothing to keep honest
    }

    let Some(base) = std::env::var_os("XDG_CONFIG_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".config")))
    else {
        return;
    };
    let entry = base
        .join("autostart")
        .join(format!("{}.desktop", app.package_info().name));

    let Ok(body) = std::fs::read_to_string(&entry) else {
        return; // is_enabled() said yes but we can't read it — leave it alone
    };
    if !autostart_heal::needs_rewrite(&body, |p| p.exists()) {
        return;
    }

    eprintln!("tomato: autostart entry points at a missing binary; re-registering");
    if let Err(e) = manager.disable().and_then(|_| manager.enable()) {
        eprintln!("tomato: could not repair autostart: {e}");
    }
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
        .setup(|app| {
            // A stale autostart entry fails silently at login; repair it here.
            #[cfg(target_os = "linux")]
            heal_autostart(app.handle());
            spawn_idle_sampler();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![dnd_state, quit, idle_seconds, idle_sample, game_running])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
