/*
  Web addresses for browser tabs.

  A browser tab lives at `/browse?url=<page>` in the router, so it gets the same
  per-tab back/forward history, restore-on-launch and Ctrl+Shift+T as every
  other tab. `/browse` with no url is the tab's start page.
*/

export const BROWSE_PATH = "/browse";

/** Where a typed phrase that isn't an address is searched. */
const SEARCH_URL = "https://duckduckgo.com/?q=";

/** Pages a browser tab may open. The backend enforces the same rule. */
export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
}

const HOST_LIKE = /^(localhost|\[[0-9a-f:]+\]|\d{1,3}(\.\d{1,3}){3}|([a-z0-9-]+\.)+[a-z][a-z0-9-]*)(:\d{1,5})?([/?#].*)?$/i;

/**
 * What the address bar should open for what the user typed: a full http(s)
 * address as is, something that looks like a host ("example.com/page",
 * "localhost:3000") over https (http for local hosts), and anything else as a
 * web search. Returns null for an empty box or a non-web scheme.
 */
export function addressToUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return isWebUrl(text) ? new URL(text).href : null;
  // "javascript:", "file:", "mailto:" and friends are never opened.
  if (/^(javascript|data|file|vbscript|about|blob|tauri|flow):/i.test(text)) return null;

  if (!/\s/.test(text) && HOST_LIKE.test(text)) {
    const local = /^(localhost|127\.|\[::1\])/i.test(text);
    const candidate = `${local ? "http" : "https"}://${text}`;
    if (isWebUrl(candidate)) return new URL(candidate).href;
  }

  return SEARCH_URL + encodeURIComponent(text);
}

/** The router path of a browser tab showing `url`, or its start page. */
export function browsePath(url?: string | null): string {
  return url ? `${BROWSE_PATH}?url=${encodeURIComponent(url)}` : BROWSE_PATH;
}

export function isBrowsePath(path: string): boolean {
  return path === BROWSE_PATH || path.startsWith(`${BROWSE_PATH}?`) || path.startsWith(`${BROWSE_PATH}/`);
}

/** The page a browser tab path points at, or null for the start page. */
export function urlFromBrowsePath(path: string): string | null {
  if (!isBrowsePath(path)) return null;
  const query = path.indexOf("?");
  if (query < 0) return null;
  const url = new URLSearchParams(path.slice(query + 1)).get("url");
  return url && isWebUrl(url) ? url : null;
}

/** "example.com" for showing a page before it has a title. */
export function displayHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}
