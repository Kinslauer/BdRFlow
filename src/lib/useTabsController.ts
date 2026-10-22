import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { HOME_PATH, selectActiveTab, useTabsStore } from "../store/useTabsStore";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { useResolvedWindowTitle } from "./useResolvedWindowTitle";
import { closeActiveBrowserTab, settlePendingDismiss } from "./tabs";

const isOnboardingPath = (pathname: string) => pathname.startsWith("/onboarding");

/**
 * Keeps the router and the active tab in step (see `useTabsStore`), keeps tab
 * titles current, and handles the browser shortcuts: Ctrl+T, Ctrl+W,
 * Ctrl+Shift+T, Ctrl+Tab, Ctrl+1…9, Alt+←/→ and the mouse back/forward buttons.
 */
export function useTabsController() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();

  const activeId = useTabsStore((s) => s.activeId);
  const activePath = useTabsStore((s) => selectActiveTab(s).path);

  const currentPath = location.pathname + location.search;
  const onboarding = isOnboardingPath(location.pathname);

  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;
  const onboardingRef = useRef(onboarding);
  onboardingRef.current = onboarding;
  const navigationTypeRef = useRef(navigationType);
  navigationTypeRef.current = navigationType;
  const restoredRef = useRef(false);
  const restoreTargetRef = useRef<string | null>(null);

  // Store → router. Declared before the router → store effect so that, on the
  // first render, the restore below runs before this would navigate.
  // Depends on the store only: reading the location through a ref keeps a page
  // navigation from being mistaken for a tab switch.
  useEffect(() => {
    if (!restoredRef.current || onboardingRef.current) return;
    if (activePath !== currentPathRef.current) navigate(activePath, { replace: true });
  }, [activeId, activePath, navigate]);

  // Router → store. Depends on the location only, reading the store fresh, so a
  // tab switch (which changes the store first) is never recorded onto the new tab.
  useEffect(() => {
    settlePendingDismiss(location.pathname);
    if (onboardingRef.current) return;

    const tabs = useTabsStore.getState();
    const storedPath = selectActiveTab(tabs).path;

    // While a restore is in flight the router is still at "/"; recording that
    // would overwrite the tab being restored (StrictMode runs this effect twice).
    if (restoreTargetRef.current !== null) {
      if (currentPath === restoreTargetRef.current) {
        restoreTargetRef.current = null;
        return;
      }
      if (currentPath === HOME_PATH) return;
      restoreTargetRef.current = null;
    }

    if (!restoredRef.current) {
      restoredRef.current = true;
      // The app always starts at "/". If tabs were restored, show the active
      // one instead of overwriting it with the home page.
      if (currentPath === HOME_PATH && storedPath !== HOME_PATH) {
        restoreTargetRef.current = storedPath;
        navigate(storedPath, { replace: true });
        return;
      }
    }

    if (currentPath === storedPath) return;
    tabs.recordNavigation(currentPath, navigationTypeRef.current === "PUSH" ? "push" : "replace");
  }, [currentPath, location.pathname, navigate]);

  // Title of the active tab, once the router is actually showing it.
  const { text } = useResolvedWindowTitle();
  const musicOverlayOpen = useMusicPlayerStore((s) => s.currentTrack !== null && s.viewState !== "dock");
  useEffect(() => {
    if (!text || musicOverlayOpen || onboarding) return;
    if (currentPath !== activePath) return;
    useTabsStore.getState().setTitle(activeId, text);
  }, [text, musicOverlayOpen, onboarding, currentPath, activePath, activeId]);

  // Keyboard and mouse shortcuts.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (onboardingRef.current) return;
      const tabs = useTabsStore.getState();
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key;

      if (event.altKey && !mod && !event.shiftKey && (key === "ArrowLeft" || key === "ArrowRight")) {
        event.preventDefault();
        if (key === "ArrowLeft") tabs.goBack();
        else tabs.goForward();
        return;
      }
      if (!mod || event.altKey) return;

      const lower = key.toLowerCase();
      let handled = true;
      if (lower === "t" && event.shiftKey) tabs.reopenClosedTab();
      else if (lower === "t") tabs.openTab(HOME_PATH, { activate: true });
      else if (lower === "w" && !event.shiftKey) closeActiveBrowserTab();
      else if (key === "Tab") tabs.cycleTab(event.shiftKey ? -1 : 1);
      else if (key === "PageDown" && !event.shiftKey) tabs.cycleTab(1);
      else if (key === "PageUp" && !event.shiftKey) tabs.cycleTab(-1);
      else if (/^[1-8]$/.test(key) && !event.shiftKey) tabs.activateIndex(Number(key) - 1);
      else if (key === "9" && !event.shiftKey) tabs.activateIndex(tabs.tabs.length - 1);
      else handled = false;

      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    // Mouse buttons 3 and 4 are back and forward. The webview would otherwise
    // walk the window's single history, which crosses tab boundaries.
    const onMouseButton = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      if (event.type !== "mouseup" || onboardingRef.current) return;
      const tabs = useTabsStore.getState();
      if (event.button === 3) tabs.goBack();
      else tabs.goForward();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("mousedown", onMouseButton, true);
    window.addEventListener("mouseup", onMouseButton, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("mousedown", onMouseButton, true);
      window.removeEventListener("mouseup", onMouseButton, true);
    };
  }, []);
}
