//! The user's own YouTube sign-in, used only to get past a bot wall.
//!
//! Some networks are flagged so hard that YouTube answers every anonymous
//! `player` request with "Sign in to confirm you're not a bot", whatever the
//! client, identity or address family. A signed-in request is not walled. The
//! user signs in to YouTube in a web tab, which shares the app's `WebView` cookie
//! store, and when the anonymous ladder ends on a bot wall the player is asked
//! once more as the clients that accept an account (TV and web), carrying that
//! session the way a browser does: its cookies and a `SAPISIDHASH`
//! authorization.
//!
//! The cookies never leave the `WebView`'s own store: they are read from it when
//! needed, kept in memory for a few minutes, and never logged or written
//! anywhere by Flow. Only `player` requests made inside [`signed_in`] carry them.

use std::sync::{OnceLock, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use sha1::{Digest, Sha1};

use crate::api::innertube::core::clients::YouTubeClient;

/// "Use my YouTube sign-in for bot checks" in Settings > Network. On unless turned off;
/// it does nothing until the user signs in.
pub const SETTING_KEY: &str = "youtube_account_fallback";

/// How long cookies read from the `WebView` are reused before being read again.
const COOKIE_TTL: Duration = Duration::from_secs(300);

const YOUTUBE_URL: &str = "https://www.youtube.com/";

static ENABLED: RwLock<bool> = RwLock::new(true);
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static CACHE: RwLock<Option<CachedSession>> = RwLock::new(None);

tokio::task_local! {
    /// Set while the player ladder walks as the signed-in user.
    static SIGNED_IN: Session;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Session {
    /// The `Cookie` header a browser would send to www.youtube.com.
    cookie_header: String,
    sapisid: Option<String>,
    sapisid_1p: Option<String>,
    sapisid_3p: Option<String>,
}

struct CachedSession {
    session: Option<Session>,
    read_at: Instant,
}

/// Lets the account read the main window's cookie store. Called once at startup.
pub fn install(app: &tauri::AppHandle) {
    let _ = APP.set(app.clone());
}

pub fn set_enabled(enabled: bool) {
    if let Ok(mut slot) = ENABLED.write() {
        *slot = enabled;
    }
}

fn enabled() -> bool {
    ENABLED.read().map(|slot| *slot).unwrap_or(true)
}

/// Drops the cached cookies, so the next read sees a sign-in or sign-out at once.
pub fn forget_cached() {
    if let Ok(mut slot) = CACHE.write() {
        *slot = None;
    }
}

impl Session {
    /// A session from `(name, value)` cookie pairs, or none without the cookies
    /// a signed-in request needs.
    #[must_use]
    pub fn from_cookies<'a>(cookies: impl IntoIterator<Item = (&'a str, &'a str)>) -> Option<Self> {
        let mut pairs = Vec::new();
        let (mut sapisid, mut sapisid_1p, mut sapisid_3p) = (None, None, None);
        let mut has_sid = false;
        for (name, value) in cookies {
            if name.is_empty() || value.is_empty() || pairs.iter().any(|(n, _)| *n == name) {
                continue;
            }
            match name {
                "SAPISID" => sapisid = Some(value.to_string()),
                "__Secure-1PAPISID" => sapisid_1p = Some(value.to_string()),
                "__Secure-3PAPISID" => sapisid_3p = Some(value.to_string()),
                "SID" | "__Secure-1PSID" | "__Secure-3PSID" => has_sid = true,
                _ => {}
            }
            pairs.push((name, value));
        }
        // SAPISID is mirrored from the secure variant when a browser drops the plain one.
        let sapisid = sapisid.or_else(|| sapisid_3p.clone());
        if !has_sid || sapisid.is_none() {
            return None;
        }
        let cookie_header = pairs
            .iter()
            .map(|(name, value)| format!("{name}={value}"))
            .collect::<Vec<_>>()
            .join("; ");
        Some(Self {
            cookie_header,
            sapisid,
            sapisid_1p,
            sapisid_3p,
        })
    }

    /// The headers a signed-in browser request to `origin` carries, at `now` (Unix seconds).
    #[must_use]
    pub fn headers_at(&self, origin: &str, now: u64) -> Vec<(&'static str, String)> {
        let mut auth = Vec::new();
        for (scheme, secret) in [
            ("SAPISIDHASH", &self.sapisid),
            ("SAPISID1PHASH", &self.sapisid_1p),
            ("SAPISID3PHASH", &self.sapisid_3p),
        ] {
            if let Some(secret) = secret {
                auth.push(format!("{scheme} {}", sapisid_hash(now, secret, origin)));
            }
        }
        let mut headers = vec![("Cookie", format!("{}; SOCS=CAE=", self.cookie_header))];
        if !auth.is_empty() {
            headers.push(("Authorization", auth.join(" ")));
        }
        headers.push(("X-Goog-AuthUser", "0".to_string()));
        headers
    }
}

/// `<now>_<sha1("<now> <secret> <origin>")>`, as youtube.com computes it.
fn sapisid_hash(now: u64, secret: &str, origin: &str) -> String {
    let digest = Sha1::digest(format!("{now} {secret} {origin}").as_bytes());
    let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("{now}_{hex}")
}

/// Whether `client` is one YouTube serves to a signed-in user. The app and
/// headset clients authenticate with OAuth, never cookies.
#[must_use]
pub fn accepts_account(client: &YouTubeClient) -> bool {
    matches!(client.name, "WEB" | "MWEB" | "TVHTML5" | "WEB_REMIX")
}

/// The signed-in headers for a request as `client` to `origin`, when it is made
/// inside [`signed_in`].
#[must_use]
pub fn request_headers(
    client: &YouTubeClient,
    origin: &str,
) -> Option<Vec<(&'static str, String)>> {
    if !accepts_account(client) {
        return None;
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    SIGNED_IN
        .try_with(|session| session.headers_at(origin, now))
        .ok()
}

/// Whether the current request is being made as the signed-in user.
#[must_use]
pub fn in_signed_scope() -> bool {
    SIGNED_IN.try_with(|_| ()).is_ok()
}

/// Runs `future` with its account-capable requests signed in as `session`.
pub async fn signed_in<F: std::future::Future>(session: Session, future: F) -> F::Output {
    SIGNED_IN.scope(session, future).await
}

/// The user's session, when the setting is on and they are signed in to
/// YouTube in a web tab.
pub async fn current_session() -> Option<Session> {
    if !enabled() {
        return None;
    }
    if let Ok(slot) = CACHE.read()
        && let Some(cached) = slot.as_ref()
        && cached.read_at.elapsed() < COOKIE_TTL
    {
        return cached.session.clone();
    }
    let session = read_webview_session().await;
    if let Ok(mut slot) = CACHE.write() {
        *slot = Some(CachedSession {
            session: session.clone(),
            read_at: Instant::now(),
        });
    }
    session
}

/// Whether the user is signed in to YouTube in a web tab, read fresh, whatever
/// the setting says. For the settings row.
pub async fn sign_in_status() -> bool {
    forget_cached();
    read_webview_session().await.is_some()
}

/// Reads youtube.com's cookies from the main window's `WebView`. Off the async
/// runtime: `WebView2` deadlocks a cookie read made from its own thread.
async fn read_webview_session() -> Option<Session> {
    use tauri::Manager;

    let app = APP.get()?.clone();
    let read = tokio::task::spawn_blocking(move || {
        let webview = app.get_webview("main")?;
        let url = tauri::Url::parse(YOUTUBE_URL).ok()?;
        let cookies = webview.cookies_for_url(url).ok()?;
        Session::from_cookies(cookies.iter().map(|cookie| (cookie.name(), cookie.value())))
    });
    match tokio::time::timeout(Duration::from_secs(5), read).await {
        Ok(Ok(session)) => session,
        Ok(Err(error)) => {
            tracing::warn!(%error, "could not read the YouTube sign-in");
            None
        }
        Err(_) => {
            tracing::warn!("reading the YouTube sign-in timed out");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::innertube::core::clients::{ANDROID_VR, TV_TIZEN, VISIONOS, WEB};

    fn signed_in_cookies() -> Vec<(&'static str, &'static str)> {
        vec![
            ("SID", "sid"),
            ("HSID", "hsid"),
            ("SAPISID", "abc/def"),
            ("__Secure-1PAPISID", "abc/def"),
            ("__Secure-3PAPISID", "abc/def"),
            ("PREF", "f6=40000000"),
        ]
    }

    #[test]
    fn a_session_needs_a_sid_and_a_sapisid() {
        assert!(Session::from_cookies(signed_in_cookies()).is_some());
        assert!(Session::from_cookies([("PREF", "x"), ("VISITOR_INFO1_LIVE", "y")]).is_none());
        assert!(Session::from_cookies([("SID", "sid")]).is_none());
        assert!(Session::from_cookies([("SAPISID", "a")]).is_none());
        // The secure variants alone are enough.
        let secure = Session::from_cookies([("__Secure-3PSID", "s"), ("__Secure-3PAPISID", "a")]);
        assert_eq!(secure.and_then(|s| s.sapisid), Some("a".to_string()));
    }

    #[test]
    fn hashes_like_youtube_com() {
        // sha1("1700000000 abc/def https://www.youtube.com")
        let hash = sapisid_hash(1_700_000_000, "abc/def", "https://www.youtube.com");
        let (time, hex) = hash.split_once('_').unwrap();
        assert_eq!(time, "1700000000");
        assert_eq!(hex.len(), 40);
        assert_eq!(
            hash,
            sapisid_hash(1_700_000_000, "abc/def", "https://www.youtube.com")
        );
        assert_ne!(
            hash,
            sapisid_hash(1_700_000_000, "abc/def", "https://music.youtube.com")
        );
    }

    #[test]
    fn signed_headers_carry_cookies_and_every_hash() {
        let session = Session::from_cookies(signed_in_cookies()).unwrap();
        let headers = session.headers_at("https://www.youtube.com", 1_700_000_000);
        let get = |name: &str| {
            headers
                .iter()
                .find(|(n, _)| *n == name)
                .map(|(_, v)| v.as_str())
        };
        let cookie = get("Cookie").unwrap();
        assert!(cookie.starts_with("SID=sid; HSID=hsid; SAPISID=abc/def"));
        assert!(cookie.ends_with("SOCS=CAE="));
        let auth = get("Authorization").unwrap();
        assert!(auth.starts_with("SAPISIDHASH 1700000000_"));
        assert!(auth.contains(" SAPISID1PHASH 1700000000_"));
        assert!(auth.contains(" SAPISID3PHASH 1700000000_"));
        assert_eq!(get("X-Goog-AuthUser"), Some("0"));
    }

    #[test]
    fn only_account_clients_and_only_inside_the_scope() {
        assert!(accepts_account(&WEB));
        assert!(accepts_account(&TV_TIZEN));
        assert!(!accepts_account(&VISIONOS));
        assert!(!accepts_account(&ANDROID_VR));
        assert!(request_headers(&WEB, "https://www.youtube.com").is_none());

        let session = Session::from_cookies(signed_in_cookies()).unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        runtime.block_on(signed_in(session, async {
            assert!(in_signed_scope());
            assert!(request_headers(&TV_TIZEN, "https://www.youtube.com").is_some());
            assert!(request_headers(&VISIONOS, "https://www.youtube.com").is_none());
        }));
        assert!(!in_signed_scope());
    }
}
