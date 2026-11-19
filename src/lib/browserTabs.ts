import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  BROWSER_OPEN_TAB_EVENT,
  BROWSER_STATE_EVENT,
  closeBrowserView,
  retainBrowserViews,
  type BrowserOpenTabPayload,
  type BrowserStatePayload,
} from "./api/browser";
import { browsePath, isBrowsePath, isWebUrl } from "./browserUrl";
import { createPath } from "react-router-dom";
import { useTabsStore } from "../store/useTabsStore";
import { selectBrowserPage, useBrowserStore } from "../store/useBrowserStore";
import { currentEntry, type TabHistory } from "./tabs/tabHistory";
import { switchToTab } from "./tabs/tabPlayback";

/** Fired on Ctrl+L while a browser tab is open: focus its address bar. */
export const FOCUS_ADDRESS_BAR_EVENT = "flow-browser-focus-address";

/** The router path a tab is showing, search included. */
export function tabPath(tab: TabHistory): string {
  return createPath(currentEntry(tab));
}

export function isBrowserTab(tab: TabHistory): boolean {
  return isBrowsePath(tabPath(tab));
}

/** Open a new web tab, on its start page unless a url is given. */
export function openWebTab(url?: string | null, activate = true) {
  const tabs = useTabsStore.getState();
  const id = tabs.openTab(browsePath(url), { activate: false });
  // Through switchToTab, so a video playing in the tab being left parks there.
  if (activate) switchToTab(id);
  return id;
}

/**
 * Record a navigation on a browser tab, keeping the title the tab already had
 * when only the address is being corrected.
 */
function recordTabNavigation(id: string, path: string, kind: "push" | "replace", title?: string) {
  const tabs = useTabsStore.getState();
  const tab = tabs.tabs.find((t) => t.id === id);
  if (!tab || tabPath(tab) === path) return;
  tabs.navigateTab(id, path, kind);
  if (!title) return;
  const updated = useTabsStore.getState().tabs.find((t) => t.id === id);
  if (updated) useTabsStore.getState().setTabTitle(id, currentEntry(updated).key, title);
}

/** The title shown for a tab's current page, if it has one. */
function currentTitle(tab: TabHistory): string | undefined {
  const title = useTabsStore.getState().titles[tab.id];
  return title?.key === currentEntry(tab).key ? title.text : undefined;
}

/**
 * Apply a page event to the tab it belongs to. Navigations the user makes
 * inside the page become entries in the tab's own back/forward history; loads
 * the app started itself (address bar, back, forward) and their redirects only
 * correct the address shown.
 */
export function handleBrowserState(event: BrowserStatePayload) {
  const tabs = useTabsStore.getState();
  const tab = tabs.tabs.find((t) => t.id === event.id);
  if (!tab || !isBrowserTab(tab) || !isWebUrl(event.url)) return;

  const browser = useBrowserStore.getState();
  const page = selectBrowserPage(event.id)(browser);
  const path = browsePath(event.url);

  switch (event.kind) {
    case "loadStarted": {
      if (page.pending) {
        browser.update(event.id, { loading: true });
        return;
      }
      browser.update(event.id, { url: event.url, loading: true, pending: true });
      recordTabNavigation(event.id, path, "push");
      return;
    }
    case "loadFinished": {
      browser.update(event.id, { url: event.url, loading: false, pending: false });
      recordTabNavigation(event.id, path, "replace", currentTitle(tab));
      return;
    }
    case "title": {
      const title = event.title?.trim() ?? "";
      // Single-page sites change their address without a page load.
      if (!page.pending && page.url !== event.url) {
        browser.update(event.id, { url: event.url });
        recordTabNavigation(event.id, path, "replace");
      }
      const now = useTabsStore.getState().tabs.find((t) => t.id === event.id);
      if (title && now) useTabsStore.getState().setTabTitle(event.id, currentEntry(now).key, title);
      return;
    }
  }
}

/**
 * Wires browser tabs to their native pages: page events update the tabs, a
 * page's `window.open` opens a new browser tab, and closing a tab (or moving it
 * off the web) closes its page.
 */
export function useBrowserTabsController() {
  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const track = (pending: Promise<() => void>) => {
      pending
        .then((unlisten) => (disposed ? unlisten() : unlisteners.push(unlisten)))
        .catch(() => {});
    };

    track(listen<BrowserStatePayload>(BROWSER_STATE_EVENT, (e) => handleBrowserState(e.payload)));
    track(
      listen<BrowserOpenTabPayload>(BROWSER_OPEN_TAB_EVENT, (e) => {
        if (isWebUrl(e.payload.url)) openWebTab(e.payload.url);
      }),
    );

    const browserTabIds = () =>
      useTabsStore
        .getState()
        .tabs.filter(isBrowserTab)
        .map((t) => t.id);

    // Pages left over from before a frontend reload.
    void retainBrowserViews(browserTabIds()).catch(() => {});

    const unsubscribe = useTabsStore.subscribe((state, previous) => {
      if (state.tabs === previous.tabs) return;
      const keep = new Set(browserTabIds());
      for (const id of Object.keys(useBrowserStore.getState().pages)) {
        if (keep.has(id)) continue;
        useBrowserStore.getState().remove(id);
        void closeBrowserView(id).catch(() => {});
      }
    });

    return () => {
      disposed = true;
      unsubscribe();
      for (const unlisten of unlisteners) unlisten();
    };
  }, []);
}
