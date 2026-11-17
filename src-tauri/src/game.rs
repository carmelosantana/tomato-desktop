//! Is a Steam game running? Used to keep the full-screen nudge overlay from
//! popping over a game; the nudge falls back to the quiet notification instead.
//!
//! Linux: Steam starts every game under its `reaper` process, whose command line
//! reads `reaper SteamLaunch AppId=<id> -- …`. The Steam client itself (and
//! `steam.sh steam://rungameid/…`) never carries that pair, so it is a clean
//! "a game is running" signal.
//! macOS: games run from `…/steamapps/common/…`.

/// True when one process command line (NULs already turned into spaces) is a
/// Steam game launch.
pub fn is_steam_game(cmdline: &str) -> bool {
    (cmdline.contains("SteamLaunch") && cmdline.contains("AppId="))
        || cmdline.contains("/steamapps/common/")
}

#[cfg(target_os = "linux")]
fn command_lines() -> Vec<String> {
    let Ok(dir) = std::fs::read_dir("/proc") else { return Vec::new() };
    dir.flatten()
        .filter(|e| e.file_name().to_string_lossy().bytes().all(|b| b.is_ascii_digit()))
        .filter_map(|e| std::fs::read(e.path().join("cmdline")).ok())
        .map(|b| String::from_utf8_lossy(&b).replace('\0', " "))
        .collect()
}

#[cfg(target_os = "macos")]
fn command_lines() -> Vec<String> {
    std::process::Command::new("ps")
        .args(["-Axo", "command="])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().map(str::to_owned).collect())
        .unwrap_or_default()
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn command_lines() -> Vec<String> {
    Vec::new()
}

pub fn steam_game_running() -> bool {
    command_lines().iter().any(|c| is_steam_game(c))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reaper_launch_is_a_game() {
        assert!(is_steam_game(
            "/home/u/.steam/debian-installation/ubuntu12_32/reaper SteamLaunch AppId=570 -- /home/u/.steam/steamapps/common/dota 2 beta/game/dota.sh"
        ));
    }

    #[test]
    fn macos_game_path_is_a_game() {
        assert!(is_steam_game(
            "/Users/u/Library/Application Support/Steam/steamapps/common/Hades/Hades.app/Contents/MacOS/Hades"
        ));
    }

    #[test]
    fn steam_client_alone_is_not() {
        assert!(!is_steam_game("bash /home/u/.steam/debian-installation/steam.sh -nominidumps steam://rungameid/2310"));
        assert!(!is_steam_game("/home/u/.steam/debian-installation/steamrt64/steamwebhelper --type=zygote"));
        assert!(!is_steam_game("/usr/bin/code --type=renderer"));
    }
}
