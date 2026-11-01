//! The GitHub CLI's token (`gh auth token`), for orgs that block the app; never logged or stored.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Where `gh` usually lives; a GUI app doesn't inherit the shell's PATH.
fn candidates() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
        .into_iter()
        .map(PathBuf::from)
        .collect();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join("bin"));
    }
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    let exe = if cfg!(windows) { "gh.exe" } else { "gh" };
    dirs.into_iter().map(|d| d.join(exe)).collect()
}

/// Asks the login shell, which has the user's PATH, as a last resort.
#[cfg(unix)]
fn from_login_shell() -> Option<PathBuf> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let out = Command::new(shell)
        .args(["-lc", "command -v gh"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    let path = PathBuf::from(String::from_utf8(out.stdout).ok()?.trim());
    (out.status.success() && path.is_absolute() && path.is_file()).then_some(path)
}

#[cfg(not(unix))]
fn from_login_shell() -> Option<PathBuf> {
    None
}

fn find() -> Option<PathBuf> {
    candidates()
        .into_iter()
        .find(|p| p.is_file())
        .or_else(from_login_shell)
}

/// What `gh auth token` printed, if it is a token.
fn parse(stdout: &[u8]) -> Option<String> {
    let token = std::str::from_utf8(stdout).ok()?.trim();
    (!token.is_empty() && !token.contains(char::is_whitespace)).then(|| token.to_string())
}

fn run(gh: &Path) -> Result<String, String> {
    let out = Command::new(gh)
        .args(["auth", "token", "--hostname", "github.com"])
        .env("GH_PROMPT_DISABLED", "1")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map_err(|_| "gh-missing".to_string())?;
    if !out.status.success() {
        return Err("gh-signed-out".into());
    }
    parse(&out.stdout).ok_or_else(|| "gh-signed-out".into())
}

/// The token `gh` is signed in with: `Err("gh-missing")` when it isn't installed, `Err("gh-signed-out")` when not logged in.
pub fn token() -> Result<String, String> {
    run(&find().ok_or("gh-missing")?)
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn parses_only_a_single_token() {
        assert_eq!(parse(b"gho_abc123\n").as_deref(), Some("gho_abc123"));
        assert_eq!(parse(b"  \n"), None);
        assert_eq!(parse(b"no oauth token found for github.com\n"), None);
    }
}
