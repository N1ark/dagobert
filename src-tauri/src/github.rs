//! GitHub App sign-in via the device flow; it lives here because the endpoints send no CORS headers.

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// The Dagobert GitHub App (app id 5035388); a client id is public, and the device flow has no secret.
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

/// A token set as the frontend stores it; the refresh fields are absent for non-expiring tokens.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Token {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub expires_in: Option<u64>,
}

/// Either a token or why it isn't ready; `pending` and `slow_down` are the normal course.
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

/// The errors that mean the refresh token itself is finished; every other failure is transient.
const DEAD: [&str; 2] = ["bad_refresh_token", "bad_verification_code"];

/// A refresh either renews the sign-in or ends it; a transport failure is neither and stays an `Err`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum Refreshed {
    Token { token: Token },
    Rejected { reason: String },
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
pub fn refresh(refresh_token: &str) -> Result<Refreshed, String> {
    let client_id = configured()?;
    let raw: Raw = post(
        TOKEN_URL,
        &[
            ("client_id", client_id),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ],
    )?;
    classify_refresh(raw)
}

/// Only a grant GitHub calls dead ends the sign-in; anything else is worth retrying.
fn classify_refresh(raw: Raw) -> Result<Refreshed, String> {
    if let Some(err) = raw.error.as_deref() {
        if DEAD.contains(&err) {
            let reason = raw.error_description.unwrap_or_else(|| err.to_string());
            return Ok(Refreshed::Rejected { reason });
        }
        return Err(raw.error_description.unwrap_or_else(|| err.to_string()));
    }
    let Some(access_token) = raw.access_token else {
        return Err("GitHub sent no token.".into());
    };
    Ok(Refreshed::Token {
        token: Token {
            access_token,
            refresh_token: raw.refresh_token,
            expires_in: raw.expires_in,
        },
    })
}

/// Maps GitHub's reply onto [`Poll`], kept separate so it can be tested offline.
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
    fn only_a_dead_grant_ends_the_sign_in() {
        assert!(matches!(
            classify_refresh(raw(Some("bad_refresh_token"), None)).unwrap(),
            Refreshed::Rejected { .. }
        ));
        // A hiccup at GitHub's end must leave the refresh token alone.
        assert!(classify_refresh(raw(Some("slow_down"), None)).is_err());
        assert!(
            classify_refresh(raw(None, None)).is_err(),
            "no error, no token"
        );
        assert!(matches!(
            classify_refresh(raw(None, Some("ghu_x"))).unwrap(),
            Refreshed::Token { .. }
        ));
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
