//! Self-heal for a stale autostart entry (Linux).
//!
//! `tauri-plugin-autostart` writes `~/.config/autostart/<Name>.desktop` with
//! `Exec=` set to the path of the binary that was running when the user enabled
//! the toggle. Nothing revalidates it afterwards, so when that binary moves or
//! is deleted the entry dangles and autostart fails SILENTLY at login — the app
//! simply never appears.
//!
//! This bites AppImage users in normal use: release AppImages are
//! version-stamped (`Tomato_0.2.0_amd64.AppImage`), so upgrading to the next
//! version and deleting the old file orphans the entry. Package (.deb) installs
//! are unaffected — `/usr/bin/tomato` is stable across upgrades.
//!
//! On every launch we check the recorded target and, only when it no longer
//! exists, re-register autostart so `Exec=` points at the running binary again.
//! The "only when missing" condition matters: an unconditional rewrite would let
//! a `tauri dev` run repoint a working entry at a throwaway build directory.

use std::path::Path;

/// Extract the program path from a `.desktop` body's `Exec=` line.
///
/// Returns the first whitespace-delimited token — the program itself, without
/// any arguments — with surrounding whitespace trimmed. `None` when there is no
/// `Exec=` line or it carries no program. Quoted paths keep their quotes
/// stripped so the value can be used as a filesystem path.
pub fn exec_target(desktop: &str) -> Option<String> {
    let line = desktop
        .lines()
        .map(str::trim_start)
        .find_map(|l| l.strip_prefix("Exec="))?;
    let prog = line.trim().split_whitespace().next()?;
    let prog = prog.trim_matches(['"', '\'']);
    if prog.is_empty() {
        None
    } else {
        Some(prog.to_string())
    }
}

/// Whether the entry needs rewriting: true when it records no usable program,
/// or records one that no longer exists on disk. Pure given `exists`.
pub fn needs_rewrite(desktop: &str, exists: impl Fn(&Path) -> bool) -> bool {
    match exec_target(desktop) {
        None => true,
        Some(p) => !exists(Path::new(&p)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const REAL: &str = "[Desktop Entry]\nType=Application\nVersion=1.0\nName=Tomato\nComment=Tomatostartup script\nExec=/home/u/Builds/tomato/Tomato_0.2.0_amd64.AppImage \nStartupNotify=false\nTerminal=false";

    #[test]
    fn reads_the_exec_program_ignoring_trailing_space() {
        assert_eq!(
            exec_target(REAL).as_deref(),
            Some("/home/u/Builds/tomato/Tomato_0.2.0_amd64.AppImage")
        );
    }

    #[test]
    fn drops_arguments_and_quotes() {
        assert_eq!(
            exec_target("Exec=\"/usr/bin/tomato\" --hidden").as_deref(),
            Some("/usr/bin/tomato")
        );
    }

    #[test]
    fn none_without_a_usable_exec_line() {
        assert_eq!(exec_target("[Desktop Entry]\nName=Tomato"), None);
        assert_eq!(exec_target("Exec=   "), None);
    }

    #[test]
    fn rewrite_only_when_the_target_is_gone() {
        assert!(!needs_rewrite(REAL, |_| true), "present target: leave alone");
        assert!(needs_rewrite(REAL, |_| false), "missing target: rewrite");
        assert!(needs_rewrite("Name=Tomato", |_| true), "no Exec: rewrite");
    }
}
