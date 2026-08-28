// macOS — CoreGraphics extern (no crate, no TCC permission needed).
#[cfg(target_os = "macos")]
fn idle_seconds_macos() -> f64 {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state_id: i32, event_type: u32) -> f64;
    }
    // state 0 = CombinedSessionState; event_type ~0 = kCGAnyInputEventType.
    unsafe { CGEventSourceSecondsSinceLastEventType(0, u32::MAX) }
}

// Linux GNOME — Mutter IdleMonitor over D-Bus (zbus 5 blocking).
#[cfg(target_os = "linux")]
#[zbus::proxy(
    interface = "org.gnome.Mutter.IdleMonitor",
    default_service = "org.gnome.Mutter.IdleMonitor",
    default_path = "/org/gnome/Mutter/IdleMonitor/Core"
)]
trait IdleMonitor {
    #[zbus(name = "GetIdletime")]
    fn get_idletime(&self) -> zbus::Result<u64>; // milliseconds
}
#[cfg(target_os = "linux")]
fn idle_seconds_gnome() -> zbus::Result<f64> {
    let conn = zbus::blocking::Connection::session()?;
    let proxy = IdleMonitorProxyBlocking::new(&conn)?;
    Ok(proxy.get_idletime()? as f64 / 1000.0)
}

// Linux GNOME fallback — gdbus Command (parses "(uint64 12345,)").
#[cfg(target_os = "linux")]
fn idle_seconds_gnome_gdbus() -> Option<f64> {
    use std::process::Command;
    let out = Command::new("gdbus").args([
        "call","--session","--dest","org.gnome.Mutter.IdleMonitor",
        "--object-path","/org/gnome/Mutter/IdleMonitor/Core",
        "--method","org.gnome.Mutter.IdleMonitor.GetIdletime",
    ]).output().ok()?;
    if !out.status.success() { return None; }
    let s = String::from_utf8_lossy(&out.stdout);
    let ms: u64 = s.trim().trim_start_matches('(').trim_end_matches(')')
        .trim_end_matches(',').trim().strip_prefix("uint64")?.trim().parse().ok()?;
    Some(ms as f64 / 1000.0)
}

// Linux X11 — XScreenSaver (x11 crate, xss feature). .idle is milliseconds.
#[cfg(target_os = "linux")]
fn idle_seconds_x11() -> Option<f64> {
    use std::ptr;
    use x11::xlib::{XOpenDisplay, XCloseDisplay, XDefaultRootWindow, XFree};
    use x11::xss::{XScreenSaverAllocInfo, XScreenSaverQueryInfo};
    unsafe {
        let dpy = XOpenDisplay(ptr::null());
        if dpy.is_null() { return None; }
        let info = XScreenSaverAllocInfo();
        if info.is_null() { XCloseDisplay(dpy); return None; }
        let root = XDefaultRootWindow(dpy);
        let status = XScreenSaverQueryInfo(dpy, root, info);
        let result = if status != 0 { Some((*info).idle as f64 / 1000.0) } else { None };
        XFree(info as *mut _);
        XCloseDisplay(dpy);
        result
    }
}

/// Seconds since last input, or None when no provider is available (honest manual mode).
pub fn idle_seconds() -> Option<f64> {
    #[cfg(target_os = "macos")]
    { return Some(idle_seconds_macos()); }
    #[cfg(target_os = "linux")]
    {
        let session = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
        let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().to_ascii_uppercase();
        if desktop.contains("GNOME") {
            if let Ok(s) = idle_seconds_gnome() { return Some(s); }
            if let Some(s) = idle_seconds_gnome_gdbus() { return Some(s); }
        }
        if session != "wayland" {
            if let Some(s) = idle_seconds_x11() { return Some(s); }
        }
        return None;
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    { None }
}
