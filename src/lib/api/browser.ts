import { invokeBackend } from "./errors";

/*
  Native web views behind browser tabs (`src-tauri/src/commands/browser.rs`).
  Each browser tab gets its own webview, keyed by the tab id, laid over the
  area the browser page reserves for it.
*/

/** CSS pixels relative to the window's content area. */
export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Backend → main window: something happened in a tab's page. */
export const BROWSER_STATE_EVENT = "flow:browser-state";
/** Backend → main window: a page asked for a new window (`window.open`, target=_blank). */
export const BROWSER_OPEN_TAB_EVENT = "flow:browser-open-tab";

export interface BrowserStatePayload {
  id: string;
  kind: "loadStarted" | "loadFinished" | "title";
  url: string;
  title?: string;
}

export interface BrowserOpenTabPayload {
  url: string;
  /** A middle-click or Ctrl-click in the page: open the tab behind the current one. */
  background?: boolean;
}

/** Show a tab's page at `bounds`; creates it on first use, and navigates when `url` differs. */
export function showBrowserView(id: string, bounds: BrowserBounds, url?: string | null) {
  return invokeBackend<void>("browser_show", { id, bounds, url: url ?? null });
}

export function setBrowserViewBounds(id: string, bounds: BrowserBounds) {
  return invokeBackend<void>("browser_set_bounds", { id, bounds });
}

export function hideBrowserView(id: string) {
  return invokeBackend<void>("browser_hide", { id });
}

export function closeBrowserView(id: string) {
  return invokeBackend<void>("browser_close", { id });
}

/** Close every browser view whose tab is not in `ids`. */
export function retainBrowserViews(ids: string[]) {
  return invokeBackend<void>("browser_retain", { ids });
}

export function reloadBrowserView(id: string) {
  return invokeBackend<void>("browser_reload", { id });
}

export function stopBrowserView(id: string) {
  return invokeBackend<void>("browser_stop", { id });
}

/** Whether the user is signed in to YouTube in a web tab (the cookie store web tabs share). */
export function youtubeAccountStatus(): Promise<boolean> {
  return invokeBackend<boolean>("youtube_account_status");
}
