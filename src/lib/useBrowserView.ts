import { useEffect, useState, type RefObject } from "react";
import {
  hideAllBrowserViews,
  hideBrowserView,
  setBrowserViewBounds,
  showBrowserView,
  type BrowserBounds,
} from "./api/browser";
import { getBackendErrorMessage } from "./api/errors";
import { useNativeViewOcclusion } from "./useNativeViewOcclusion";
import { useBrowserStore, selectBrowserPage } from "../store/useBrowserStore";

function measure(el: HTMLElement): BrowserBounds {
  const rect = el.getBoundingClientRect();
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

function sameBounds(a: BrowserBounds | null, b: BrowserBounds) {
  return !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Keeps a tab's native web page over `containerRef`: shown and sized to it
 * while the tab is on screen, navigated when the tab's address changes, and
 * hidden when the tab is left or an in-app overlay opens.
 */
export function useBrowserView(
  tabId: string,
  url: string | null,
  containerRef: RefObject<HTMLElement | null>,
  /** False while the router hasn't caught up with the tab store; nothing changes then. */
  enabled = true,
) {
  const occluded = useNativeViewOcclusion(url !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el || !url || occluded) {
      void hideBrowserView(tabId).catch(() => {});
      return;
    }

    setError(null);
    const page = selectBrowserPage(tabId)(useBrowserStore.getState());
    // Only navigate when the address differs from what the page already shows:
    // the tab path follows the page as the user clicks around in it, and
    // re-opening that address would reload the page on every click.
    const navigateTo = page.url === url ? null : url;
    if (navigateTo) useBrowserStore.getState().update(tabId, { url, pending: true, loading: true });

    let last: BrowserBounds | null = measure(el);
    showBrowserView(tabId, last, navigateTo).catch((err) => {
      setError(getBackendErrorMessage(err));
      useBrowserStore.getState().update(tabId, { loading: false, pending: false });
    });

    let frame: number | null = null;
    const sync = () => {
      frame = null;
      const next = measure(el);
      if (sameBounds(last, next)) return;
      last = next;
      void setBrowserViewBounds(tabId, next).catch(() => {});
    };
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(sync);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    // The sidebar or window can move the area without resizing it.
    window.addEventListener("resize", schedule);
    const interval = window.setInterval(schedule, 500);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.clearInterval(interval);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [tabId, url, occluded, containerRef, enabled]);

  // Leaving the tab (or the browser page) hides its page; it stays loaded, like
  // a background tab, until the tab is closed.
  useEffect(() => () => void hideBrowserView(tabId).catch(() => {}), [tabId]);
  // Leaving the browser page altogether hides every page, not just this tab's:
  // nothing a web page draws belongs over the rest of the app.
  useEffect(() => () => void hideAllBrowserViews().catch(() => {}), []);

  return { error };
}
