import { useEffect } from "react";
import { useTabsStore } from "../../store/useTabsStore";
import { IS_MACOS_RUNTIME } from "../platform";
import { closeTabWithPlayback, switchToTab } from "./tabPlayback";
import { tabShortcutForKey } from "./tabShortcuts";
import { tabsEnabled } from "./tabsEnabled";
import { openInNewWindow } from "../openTarget";
import { FOCUS_ADDRESS_BAR_EVENT, isBrowserTab, openWebTab } from "../browserTabs";
import { IS_MAIN_WINDOW } from "../appWindow";

export function useTabShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const shortcut = tabShortcutForKey(event, IS_MACOS_RUNTIME, tabsEnabled());
      if (!shortcut) return;
      const { tabs, activeId, openTab } = useTabsStore.getState();
      const at = tabs.findIndex((tab) => tab.id === activeId);

      if (shortcut.kind === "new") {
        switchToTab(openTab("/", { activate: false }));
      } else if (shortcut.kind === "reopen") {
        useTabsStore.getState().reopenClosedTab();
      } else if (shortcut.kind === "web") {
        // Web pages live in the main window only; elsewhere Ctrl+L does nothing.
        if (!IS_MAIN_WINDOW) return;
        const active = tabs.find((tab) => tab.id === activeId);
        if (active && isBrowserTab(active)) window.dispatchEvent(new Event(FOCUS_ADDRESS_BAR_EVENT));
        else openWebTab();
      } else if (shortcut.kind === "new-window") {
        void openInNewWindow("/");
      } else if (shortcut.kind === "close") {
        // The last tab stays; the key still must not reach the window's own close.
        closeTabWithPlayback(activeId);
      } else if (shortcut.kind === "cycle") {
        const next = tabs[(at + shortcut.step + tabs.length) % tabs.length];
        if (next) switchToTab(next.id);
      } else {
        const target = shortcut.kind === "select-last" ? tabs[tabs.length - 1] : tabs[shortcut.position];
        if (!target) return;
        switchToTab(target.id);
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
