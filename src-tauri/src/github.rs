//! GitHub App sign-in via the OAuth device flow.
//!
//! The user approves a short code in their own browser; the app never sees a
//! password and no token is ever typed in. The endpoints send no CORS headers,
//! so the calls have to happen here rather than in the webview. The resulting
//! token is handed to the frontend and never written to disk by Rust.

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// The Dagobert GitHub App (app id 5035388). A client id is public; there is no
/// secret in the device flow.
const CLIENT_ID: &str = "Iv23litv6NiawS3zubnE";
const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    /// Seconds to wait between polls; GitHub rejects anything faster.
    pub interval: u64,
}

/// A token set as the frontend stores it. `refresh_token` and `expires_in` are
/// absent when the app is configured with non-expiring user tokens.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Token {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub expires_in: Option<u64>,
}

/// Either a token, or why it isn't ready yet. `pending` and `slow_down` are the
/// normal course of a poll, not failures.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum Poll {
    Pending,
    /// Poll this many seconds apart from now on.
    SlowDown {
        interval: u64,
    },
    Token {
        token: Token,
    },
}

#[derive(Deserialize)]
struct Raw {
    error: Option<String>,
    error_description: Option<String>,
    interval: Option<u64>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
}

// A build can blank the id out; clippy sees the constant either way.
#[allow(clippy::const_is_empty)]
fn configured() -> Result<&'static str, String> {
    if CLIENT_ID.is_empty() {
        return Err("no-client-id".into());
    }
    Ok(CLIENT_ID)
}

fn post<T: serde::de::DeserializeOwned>(url: &str, form: &[(&str, &str)]) -> Result<T, String> {
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .build()
        .new_agent();
    agent
        .post(url)
        .header("Accept", "application/json")
        .send_form(form.to_vec())
        .map_err(|e| format!("GitHub sign-in failed: {e}"))?
        .body_mut()
        .read_json::<T>()
        .map_err(|e| format!("GitHub sent an unreadable reply: {e}"))
}

/// Asks GitHub for a code; the frontend shows `user_code` and opens `verification_uri`.
pub fn start() -> Result<DeviceStart, String> {
    let client_id = configured()?;
    post(DEVICE_CODE_URL, &[("client_id", client_id)])
}

/// One poll of the token endpoint. The caller waits `interval` between calls.
pub fn poll(device_code: &str) -> Result<Poll, String> {
    let client_id = configured()?;
    let raw: Raw = post(
        TOKEN_URL,
        &[
            ("client_id", client_id),
            ("device_code", device_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ],
    )?;
    classify(raw)
}

/// Trades a refresh token for a fresh one, when the app expires user tokens.
pub fn refresh(refresh_token: &str) -> Result<Token, String> {
    let client_id = configured()?;
    let raw: Raw = post(
        TOKEN_URL,
        &[
            ("client_id", client_id),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ],
    )?;
    match classify(raw)? {
        Poll::Token { token } => Ok(token),
        _ => Err("GitHub declined to refresh the sign-in.".into()),
    }
}

/// Maps GitHub's reply onto [`Poll`]. Kept separate so it can be tested without
/// a network round trip.
fn classify(raw: Raw) -> Result<Poll, String> {
    if let Some(err) = raw.error.as_deref() {
        return match err {
            "authorization_pending" => Ok(Poll::Pending),
            "slow_down" => Ok(Poll::SlowDown {
                interval: raw.interval.unwrap_or(10),
            }),
            _ => Err(raw.error_description.unwrap_or_else(|| err.to_string())),
        };
    }
    let Some(access_token) = raw.access_token else {
        return Err("GitHub sent no token.".into());
    };
    Ok(Poll::Token {
        token: Token {
            access_token,
            refresh_token: raw.refresh_token,
            expires_in: raw.expires_in,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(error: Option<&str>, token: Option<&str>) -> Raw {
        Raw {
            error: error.map(str::to_string),
            error_description: None,
            interval: Some(7),
            access_token: token.map(str::to_string),
            refresh_token: None,
            expires_in: None,
        }
    }

    #[test]
    fn waiting_is_not_a_failure() {
        assert!(matches!(
            classify(raw(Some("authorization_pending"), None)).unwrap(),
            Poll::Pending
        ));
        assert!(matches!(
            classify(raw(Some("slow_down"), None)).unwrap(),
            Poll::SlowDown { interval: 7 }
        ));
    }

    #[test]
    fn a_real_error_stops_the_poll() {
        assert!(classify(raw(Some("access_denied"), None)).is_err());
        assert!(classify(raw(Some("expired_token"), None)).is_err());
        assert!(classify(raw(None, None)).is_err(), "no error, no token");
    }

    #[test]
    fn a_token_ends_the_poll() {
        match classify(raw(None, Some("gho_x"))).unwrap() {
            Poll::Token { token } => {
                assert_eq!(token.access_token, "gho_x");
                assert!(token.refresh_token.is_none());
            }
            other => panic!("{other:?}"),
        }
    }
}
