//! Web browser tabs.
//!
//! A browser tab in the tab strip shows an ordinary web page. Each one is a
//! native child webview of the main window, laid over the area the React page
//! reserves for it: the frontend measures that area and keeps the webview's
//! bounds in step, and hides the webview whenever the tab isn't on screen or an
//! in-app menu or dialog needs to draw over it.
//!
//! The pages are remote content, so they get no IPC: Tauri only lets remote
//! origins call commands that a capability with `remote` URLs allows, and none
//! does. Navigation is limited to http(s), and `window.open` becomes a new
//! browser tab instead of a new OS window.

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, Url, Webview, WebviewUrl,
    webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder},
};

use crate::errors::{AppError, ErrorResponse};

const MAIN_WINDOW_LABEL: &str = "main";
const LABEL_PREFIX: &str = "browser-";
/// Page events for one browser tab: navigation, load start/finish, title.
const STATE_EVENT: &str = "flow:browser-state";
/// A page asked for a new window; the frontend opens it as a new browser tab.
const OPEN_TAB_EVENT: &str = "flow:browser-open-tab";

/// The area the browser page reserves, in CSS pixels relative to the main
/// window's content area (which is where the main webview starts too).
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct BrowserBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserStatePayload {
    id: String,
    kind: &'static str,
    url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct BrowserOpenTabPayload {
    url: String,
    /// Opened by a middle-click or Ctrl-click: the new tab opens behind the
    /// current one, as in a browser.
    background: bool,
}

/// Appended to a link's fragment by [`BACKGROUND_LINK_SCRIPT`] so the
/// new-window handler can tell a background-tab click from a popup. It is
/// stripped again before the page is opened.
const BACKGROUND_MARKER: &str = "~flow-background-tab";

/// Runs in every browser page. A middle-click or Ctrl/Cmd-click on a web link
/// becomes a `window.open` of the link with [`BACKGROUND_MARKER`] on its
/// fragment, so the new tab opens behind the current one instead of in front.
/// The page has no IPC, so the marker is the only way to carry that intent.
const BACKGROUND_LINK_SCRIPT: &str = r#"(() => {
  const MARKER = "~flow-background-tab";
  const linkFor = (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!link || link.hasAttribute("download")) return null;
    const url = new URL(link.href, document.baseURI);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  };
  const openBehind = (event) => {
    const url = linkFor(event);
    if (!url) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    url.hash = url.hash.slice(1) + MARKER;
    window.open(url.href, "_blank");
  };
  addEventListener("auxclick", (event) => {
    if (event.button === 1) openBehind(event);
  }, true);
  addEventListener("click", (event) => {
    if (event.button === 0 && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) openBehind(event);
  }, true);
})();"#;

/// The page a new-window request asks for, and whether it came from a
/// background-tab click (see [`BACKGROUND_MARKER`]).
fn new_tab_target(mut url: Url) -> (Url, bool) {
    let stripped = url
        .fragment()
        .and_then(|fragment| fragment.strip_suffix(BACKGROUND_MARKER))
        .map(str::to_owned);
    match stripped {
        Some(rest) => {
            url.set_fragment((!rest.is_empty()).then_some(rest.as_str()));
            (url, true)
        }
        None => (url, false),
    }
}

fn validation(message: impl Into<String>) -> ErrorResponse {
    ErrorResponse::from(AppError::Validation(message.into()))
}

fn internal(context: &str, error: impl std::fmt::Display) -> ErrorResponse {
    ErrorResponse::from(AppError::Internal(format!("{context}: {error}")))
}

/// Tab ids come from the frontend tab store (`tab-<base36>-<n>`). Only the
/// characters a webview label accepts are let through.
fn label_for(id: &str) -> Result<String, ErrorResponse> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !valid {
        return Err(validation("Invalid browser tab id"));
    }
    Ok(format!("{LABEL_PREFIX}{id}"))
}

fn id_from_label(label: &str) -> Option<&str> {
    label.strip_prefix(LABEL_PREFIX)
}

/// Pages may only load over http(s), plus `about:blank`, which some sites use
/// for frames and popups.
fn is_allowed_url(url: &Url) -> bool {
    match url.scheme() {
        "http" | "https" => url.host_str().is_some(),
        "about" => url.path() == "blank",
        _ => false,
    }
}

fn parse_url(raw: &str) -> Result<Url, ErrorResponse> {
    let url = Url::parse(raw.trim()).map_err(|_| validation("Invalid web address"))?;
    if !is_allowed_url(&url) || url.scheme() == "about" {
        return Err(validation("Only http and https pages can be opened"));
    }
    Ok(url)
}

fn check_bounds(bounds: BrowserBounds) -> Result<BrowserBounds, ErrorResponse> {
    let finite = [bounds.x, bounds.y, bounds.width, bounds.height]
        .iter()
        .all(|v| v.is_finite());
    if !finite {
        return Err(validation("Invalid browser bounds"));
    }
    Ok(BrowserBounds {
        x: bounds.x.max(0.0),
        y: bounds.y.max(0.0),
        width: bounds.width.max(1.0),
        height: bounds.height.max(1.0),
    })
}

#[cfg(not(target_os = "linux"))]
fn apply_bounds<R: Runtime>(
    webview: &Webview<R>,
    bounds: BrowserBounds,
) -> Result<(), ErrorResponse> {
    webview
        .set_bounds(tauri::Rect {
            position: LogicalPosition::new(bounds.x, bounds.y).into(),
            size: LogicalSize::new(bounds.width, bounds.height).into(),
        })
        .map_err(|error| internal("Failed to place the browser view", error))
}

#[cfg(target_os = "linux")]
fn apply_bounds<R: Runtime>(
    webview: &Webview<R>,
    bounds: BrowserBounds,
) -> Result<(), ErrorResponse> {
    webview
        .with_webview(move |platform| gtk_layer::place(&platform.inner(), bounds))
        .map_err(|error| internal("Failed to place the browser view", error))
}

/// On Linux, Tauri packs every webview of a window into one vertical `GtkBox`,
/// so a second webview takes half the window and ignores its bounds. The first
/// time a browser tab opens, the app's own webview is moved into a `GtkOverlay`
/// whose overlay layer is a `GtkFixed`, and browser webviews are placed on that
/// layer at exact positions. The layer passes input through, so the app below
/// keeps working wherever no page is shown.
#[cfg(target_os = "linux")]
mod gtk_layer {
    use gtk::prelude::*;

    use super::BrowserBounds;

    const OVERLAY_NAME: &str = "flow-browser-overlay";

    #[allow(clippy::cast_possible_truncation)]
    fn round(value: f64) -> i32 {
        // Bounds are window coordinates, far inside i32.
        value.round() as i32
    }

    /// The layer browser webviews live on, created on first use. `vbox` is the
    /// window's content box, which holds the app's webview.
    fn layer(vbox: &gtk::Box, exclude: &gtk::Widget) -> Option<gtk::Fixed> {
        for child in vbox.children() {
            if child.widget_name() != OVERLAY_NAME {
                continue;
            }
            let overlay = child.downcast::<gtk::Overlay>().ok()?;
            return overlay
                .children()
                .into_iter()
                .find_map(|c| c.downcast::<gtk::Fixed>().ok());
        }

        let main = vbox
            .children()
            .into_iter()
            .find(|c| c != exclude && c.is::<webkit2gtk::WebView>())?;
        vbox.remove(&main);

        let overlay = gtk::Overlay::new();
        overlay.set_widget_name(OVERLAY_NAME);
        overlay.add(&main);
        let fixed = gtk::Fixed::new();
        overlay.add_overlay(&fixed);
        overlay.set_overlay_pass_through(&fixed, true);
        vbox.pack_start(&overlay, true, true, 0);
        overlay.show();
        fixed.show();
        Some(fixed)
    }

    /// Puts a browser webview at `bounds`, moving it onto the layer if it is
    /// still in the window's box. Runs on the main thread.
    pub fn place(webview: &webkit2gtk::WebView, bounds: BrowserBounds) {
        let (x, y) = (round(bounds.x), round(bounds.y));
        let (width, height) = (round(bounds.width), round(bounds.height));
        let widget = webview.clone().upcast::<gtk::Widget>();

        match widget.parent() {
            Some(parent) if parent.is::<gtk::Fixed>() => {
                let fixed = parent.downcast::<gtk::Fixed>().expect("checked above");
                fixed.move_(&widget, x, y);
            }
            Some(parent) => {
                let Ok(vbox) = parent.downcast::<gtk::Box>() else {
                    return;
                };
                let Some(fixed) = layer(&vbox, &widget) else {
                    return;
                };
                vbox.remove(&widget);
                fixed.put(&widget, x, y);
            }
            None => return,
        }
        widget.set_size_request(width, height);
    }
}

fn emit_state<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    kind: &'static str,
    url: &Url,
    title: Option<String>,
) {
    let Some(id) = id_from_label(label) else {
        return;
    };
    let _ = app.emit_to(
        MAIN_WINDOW_LABEL,
        STATE_EVENT,
        BrowserStatePayload {
            id: id.to_string(),
            kind,
            url: url.to_string(),
            title,
        },
    );
}

fn browser_webview<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
) -> Result<Option<Webview<R>>, ErrorResponse> {
    Ok(app.get_webview(&label_for(id)?))
}

fn build_webview<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    url: Url,
    bounds: BrowserBounds,
) -> Result<Webview<R>, ErrorResponse> {
    let window = app
        .get_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| internal("Failed to open a browser tab", "main window not found"))?;

    let load_app = app.clone();
    let title_app = app.clone();
    let popup_app = app.clone();

    #[allow(unused_mut)]
    let mut builder = WebviewBuilder::new(label, WebviewUrl::External(url))
        .on_navigation(|url| {
            let allowed = is_allowed_url(url);
            if !allowed {
                tracing::debug!(scheme = url.scheme(), "browser_navigation_blocked");
            }
            allowed
        })
        .on_page_load(move |webview, payload| {
            let kind = match payload.event() {
                PageLoadEvent::Started => "loadStarted",
                PageLoadEvent::Finished => "loadFinished",
            };
            emit_state(&load_app, webview.label(), kind, payload.url(), None);
        })
        .on_document_title_changed(move |webview, title| {
            // Single-page sites change the URL without a page load; the title
            // change is the closest signal, so the current URL rides along.
            if let Ok(url) = webview.url() {
                emit_state(&title_app, webview.label(), "title", &url, Some(title));
            }
        })
        .initialization_script(BACKGROUND_LINK_SCRIPT)
        .on_new_window(move |url, _features| {
            if is_allowed_url(&url) && url.scheme() != "about" {
                let (url, background) = new_tab_target(url);
                let _ = popup_app.emit_to(
                    MAIN_WINDOW_LABEL,
                    OPEN_TAB_EVENT,
                    BrowserOpenTabPayload {
                        url: url.to_string(),
                        background,
                    },
                );
            }
            NewWindowResponse::Deny
        });

    // WebView2 refuses a second webview on the same data directory with
    // different arguments, so this must match the main window's.
    #[cfg(windows)]
    {
        builder = builder.additional_browser_args(crate::webview2::BROWSER_ARGS);
    }

    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(bounds.x, bounds.y),
            LogicalSize::new(bounds.width, bounds.height),
        )
        .map_err(|error| internal("Failed to open a browser tab", error))?;

    #[cfg(target_os = "linux")]
    apply_bounds(&webview, bounds)?;

    Ok(webview)
}

/// Shows a tab's page at `bounds`, creating its webview on first use. When
/// `url` is given and differs from what the page shows, it navigates there.
///
/// `async` for the same reason as `open_pip_window`: building a webview from
/// the main thread deadlocks `WebView2`.
#[tauri::command]
pub async fn browser_show<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    url: Option<String>,
    bounds: BrowserBounds,
) -> Result<(), ErrorResponse> {
    let label = label_for(&id)?;
    let bounds = check_bounds(bounds)?;
    let url = url.as_deref().map(parse_url).transpose()?;

    if let Some(webview) = app.get_webview(&label) {
        apply_bounds(&webview, bounds)?;
        if let Some(url) = url
            && webview.url().ok().as_ref() != Some(&url)
        {
            webview
                .navigate(url)
                .map_err(|error| internal("Failed to open the page", error))?;
        }
        webview
            .show()
            .map_err(|error| internal("Failed to show the browser view", error))?;
        return Ok(());
    }

    let Some(url) = url else {
        // Nothing to show yet: the tab is on its start page.
        return Ok(());
    };
    build_webview(&app, &label, url, bounds)?;
    tracing::info!("browser_tab_opened");
    Ok(())
}

#[tauri::command]
pub async fn browser_navigate<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    url: String,
) -> Result<(), ErrorResponse> {
    let url = parse_url(&url)?;
    if let Some(webview) = browser_webview(&app, &id)? {
        webview
            .navigate(url)
            .map_err(|error| internal("Failed to open the page", error))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_set_bounds<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    bounds: BrowserBounds,
) -> Result<(), ErrorResponse> {
    let bounds = check_bounds(bounds)?;
    if let Some(webview) = browser_webview(&app, &id)? {
        apply_bounds(&webview, bounds)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_hide<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), ErrorResponse> {
    if let Some(webview) = browser_webview(&app, &id)? {
        webview
            .hide()
            .map_err(|error| internal("Failed to hide the browser view", error))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_close<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), ErrorResponse> {
    if let Some(webview) = browser_webview(&app, &id)? {
        webview
            .close()
            .map_err(|error| internal("Failed to close the browser tab", error))?;
    }
    Ok(())
}

/// Closes every browser webview whose tab no longer exists (tabs closed while
/// their page was never shown again, or left over from a reload in dev).
#[tauri::command]
pub async fn browser_retain<R: Runtime>(
    app: AppHandle<R>,
    ids: Vec<String>,
) -> Result<(), ErrorResponse> {
    for (label, webview) in app.webviews() {
        let Some(id) = id_from_label(&label) else {
            continue;
        };
        if !ids.iter().any(|keep| keep == id) {
            let _ = webview.close();
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_reload<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<(), ErrorResponse> {
    if let Some(webview) = browser_webview(&app, &id)? {
        webview
            .reload()
            .map_err(|error| internal("Failed to reload the page", error))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_stop<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), ErrorResponse> {
    if let Some(webview) = browser_webview(&app, &id)? {
        webview
            .eval("window.stop()")
            .map_err(|error| internal("Failed to stop the page", error))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_only_accept_tab_ids() {
        assert_eq!(label_for("tab-lq2x9-3").unwrap(), "browser-tab-lq2x9-3");
        assert!(label_for("").is_err());
        assert!(label_for("main").is_ok());
        assert!(label_for("../main").is_err());
        assert!(label_for("tab id").is_err());
        assert!(label_for(&"a".repeat(65)).is_err());
        assert_eq!(id_from_label("browser-tab-1"), Some("tab-1"));
        assert_eq!(id_from_label("main"), None);
    }

    #[test]
    fn only_web_pages_can_be_opened() {
        assert!(parse_url("https://example.com/a?b=c").is_ok());
        assert!(parse_url("  http://localhost:8080/ ").is_ok());
        assert!(parse_url("about:blank").is_err());
        assert!(parse_url("file:///etc/passwd").is_err());
        assert!(parse_url("javascript:alert(1)").is_err());
        assert!(parse_url("tauri://localhost/").is_err());
        assert!(parse_url("flow://watch/abc").is_err());
        assert!(parse_url("example.com").is_err());
    }

    #[test]
    fn pages_may_navigate_to_web_pages_and_blank_frames() {
        assert!(is_allowed_url(&Url::parse("https://example.com").unwrap()));
        assert!(is_allowed_url(&Url::parse("about:blank").unwrap()));
        assert!(!is_allowed_url(&Url::parse("about:config").unwrap()));
        assert!(!is_allowed_url(&Url::parse("file:///tmp/x").unwrap()));
        assert!(!is_allowed_url(&Url::parse("mailto:a@b.c").unwrap()));
    }

    #[test]
    fn background_marker_is_stripped_from_new_tabs() {
        let open = |raw: &str| {
            let (url, background) = new_tab_target(Url::parse(raw).unwrap());
            (url.to_string(), background)
        };
        assert_eq!(
            open("https://example.com/a#~flow-background-tab"),
            ("https://example.com/a".to_string(), true)
        );
        assert_eq!(
            open("https://example.com/a#part~flow-background-tab"),
            ("https://example.com/a#part".to_string(), true)
        );
        assert_eq!(
            open("https://example.com/a#part"),
            ("https://example.com/a#part".to_string(), false)
        );
        assert_eq!(
            open("https://example.com/"),
            ("https://example.com/".to_string(), false)
        );
    }

    #[test]
    fn bounds_are_clamped_and_must_be_finite() {
        let b = check_bounds(BrowserBounds {
            x: -4.0,
            y: 10.0,
            width: 0.0,
            height: 300.0,
        })
        .unwrap();
        assert_eq!((b.x, b.y, b.width, b.height), (0.0, 10.0, 1.0, 300.0));
        assert!(
            check_bounds(BrowserBounds {
                x: f64::NAN,
                y: 0.0,
                width: 1.0,
                height: 1.0
            })
            .is_err()
        );
    }
}
