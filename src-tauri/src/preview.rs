//! Fetches a web page for a link preview; the frontend reads its metadata (`preview.ts`).

use std::io::Read;
use std::time::Duration;

use serde::Serialize;
use ureq::ResponseExt;

/// Some pages (YouTube) put their metadata deep in a huge `<head>`.
const MAX_BYTES: usize = 2 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Debug, Serialize)]
pub struct Page {
    /// Where the redirects ended.
    pub url: String,
    pub content_type: String,
    /// The start of the page, when it's HTML.
    pub html: Option<String>,
}

pub fn fetch(url: &str) -> Result<Page, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("not a web link".into());
    }
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(TIMEOUT))
        .build()
        .new_agent();
    let mut res = agent
        .get(url)
        // Sites serve their preview tags to link unfurlers; a browser-like agent gets the page.
        .header(
            "User-Agent",
            "Mozilla/5.0 (compatible; Dagobert link preview)",
        )
        .header("Accept", "text/html,application/xhtml+xml,*/*;q=0.8")
        .call()
        .map_err(|e| e.to_string())?;
    let final_url = res.get_uri().to_string();
    let content_type = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    let html = if content_type.contains("html") {
        Some(read_head(res.body_mut().as_reader())?)
    } else {
        None
    };
    Ok(Page {
        url: final_url,
        content_type,
        html,
    })
}

/// The page up to the end of its `<head>`, where the metadata sits.
fn read_head(mut r: impl Read) -> Result<String, String> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    while buf.len() < MAX_BYTES {
        let n = r.read(&mut chunk).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        let from = buf.len().saturating_sub(7);
        buf.extend_from_slice(&chunk[..n]);
        if buf[from..]
            .windows(7)
            .any(|w| w.eq_ignore_ascii_case(b"</head>"))
        {
            break;
        }
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

#[cfg(test)]
mod tests {
    #[test]
    fn refuses_other_schemes() {
        assert!(super::fetch("file:///etc/passwd").is_err());
        assert!(super::fetch("javascript:alert(1)").is_err());
    }

    #[test]
    fn stops_after_the_head() {
        let page = format!(
            "<html><head><title>x</title></HEAD>{}",
            "body ".repeat(100_000)
        );
        let head = super::read_head(page.as_bytes()).unwrap();
        assert!(head.contains("</HEAD>") && head.len() < 20 * 1024);
    }
}
