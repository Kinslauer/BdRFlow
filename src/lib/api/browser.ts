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

/** Backend → main window: Back or Forward pressed inside a page (Alt+Left/Right, mouse side buttons). */
export const BROWSER_HISTORY_EVENT = "flow:browser-history";

export interface BrowserHistoryPayload {
  delta: number;
}

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

/*
  The backend runs async commands concurrently, so two calls sent back to back
  can finish in either order. A "show" still in flight (opening a tab's page
  for the first time takes a while) could land after the "hide" sent when the
  user switched tabs, leaving the page drawn over the rest of the app. Calls
  that change whether or where a page is shown therefore run one at a time, in
  the order they were made.
*/
let queue: Promise<unknown> = Promise.resolve();

/** Runs `call` after every earlier queued call has finished, failed or not. */
export function inOrder<T>(call: () => Promise<T>): Promise<T> {
  const result = queue.then(call);
  queue = result.catch(() => {});
  return result;
}

/** Show a tab's page at `bounds`; creates it on first use, and navigates when `url` differs. */
export function showBrowserView(id: string, bounds: BrowserBounds, url?: string | null) {
  return inOrder(() => invokeBackend<void>("browser_show", { id, bounds, url: url ?? null }));
}

export function setBrowserViewBounds(id: string, bounds: BrowserBounds) {
  return inOrder(() => invokeBackend<void>("browser_set_bounds", { id, bounds }));
}

export function hideBrowserView(id: string) {
  return inOrder(() => invokeBackend<void>("browser_hide", { id }));
}

/** Hide every tab's page: the browser page is gone, so none should be on screen. */
export function hideAllBrowserViews() {
  return inOrder(() => invokeBackend<void>("browser_hide_all"));
}

export function closeBrowserView(id: string) {
  return inOrder(() => invokeBackend<void>("browser_close", { id }));
}

/** Close every browser view whose tab is not in `ids`. */
export function retainBrowserViews(ids: string[]) {
  return inOrder(() => invokeBackend<void>("browser_retain", { ids }));
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
