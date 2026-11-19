import { useEffect, useState } from "react";

/*
  A browser tab's page is a native webview drawn above the whole app UI, so
  nothing in the DOM can paint over it. While an in-app menu, dialog or search
  dropdown is open, the page is hidden instead, and comes back when it closes.
*/

/** In-app UI that floats over the page area. */
const OVERLAY_SELECTOR = [
  '[role="dialog"]',
  '[role="menu"]',
  '[aria-modal="true"]',
  "#search-suggestions",
  // Modals and full-window layers in this app are `fixed inset-0`.
  ".fixed.inset-0",
].join(", ");

/** True when something in `doc` would be drawn over a native page. */
export function hasOverlay(doc: Document): boolean {
  if (doc.querySelector(OVERLAY_SELECTOR)) return true;
  // Context menus are portalled straight into <body>, next to the app root.
  for (const el of Array.from(doc.body.children)) {
    if (el.id === "root" || el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "TEMPLATE") continue;
    if (el.hasAttribute("data-native-view-ignore")) continue;
    return true;
  }
  return false;
}

/** Re-checks whenever the DOM gains or loses elements. */
export function useNativeViewOcclusion(enabled = true): boolean {
  const [occluded, setOccluded] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setOccluded(false);
      return;
    }
    let frame: number | null = null;
    const check = () => {
      frame = null;
      setOccluded(hasOverlay(document));
    };
    check();
    const observer = new MutationObserver(() => {
      if (frame === null) frame = window.requestAnimationFrame(check);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["role", "aria-modal"],
    });
    return () => {
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [enabled]);

  return occluded;
}
