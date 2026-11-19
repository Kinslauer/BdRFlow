import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard, Compass, Globe, Music, Plus, Search, Volume2, X } from "lucide-react";
import { useTabsStore } from "../../store/useTabsStore";
import { currentEntry, type TabHistory } from "../../lib/tabs/tabHistory";
import { closeOtherTabs, closeTabWithPlayback, switchToTab } from "../../lib/tabs/tabPlayback";
import { moveTabToNewWindow } from "../../lib/openTarget";
import { openWebTab, isBrowserTab } from "../../lib/browserTabs";
import { watchVideoIdFromPath } from "../../lib/watchRouteSync";
import { IS_MAIN_WINDOW } from "../../lib/appWindow";
import { getString } from "../../lib/i18n/index";
import { useTabLabel } from "../layout/SidebarTabs";
import { AnchoredPortalMenu, type MenuAnchor } from "../ui/AnchoredPortalMenu";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function TabIcon({ pathname, playing }: { pathname: string; playing: boolean }) {
  const common = { size: 14, strokeWidth: 2, className: "shrink-0" } as const;
  if (playing) return <Volume2 {...common} className="shrink-0 text-primary" />;
  if (pathname === "/") return <Compass {...common} />;
  if (watchVideoIdFromPath(pathname) || pathname.startsWith("/shorts")) return <Clapperboard {...common} />;
  if (pathname.startsWith("/music")) return <Music {...common} />;
  if (pathname === "/search") return <Search {...common} />;
  return <Globe {...common} />;
}

interface TabItemProps {
  tab: TabHistory;
  index: number;
  onMenu: (id: string, anchor: MenuAnchor) => void;
  onDropAt: (fromIndex: number, toIndex: number) => void;
}

const TabItem = memo(function TabItem({ tab, index, onMenu, onDropAt }: TabItemProps) {
  const active = useTabsStore((s) => s.activeId === tab.id);
  const playing = useTabsStore((s) => s.playerTabId === tab.id);
  const title = useTabsStore((s) => s.titles[tab.id]);
  const parked = useTabsStore((s) => s.parked[tab.id]);
  const label = useTabLabel(tab, title, parked);
  const pathname = currentEntry(tab).pathname;
  const [dropTarget, setDropTarget] = useState(false);

  return (
    <div
      role="tab"
      aria-selected={active}
      title={label}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-flow-tab", String(index));
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("application/x-flow-tab")) return;
        e.preventDefault();
        setDropTarget(true);
      }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={(e) => {
        setDropTarget(false);
        const from = Number(e.dataTransfer.getData("application/x-flow-tab"));
        if (Number.isInteger(from)) onDropAt(from, index);
      }}
      // Middle-button down would start the webview's autoscroll; middle-click closes.
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault();
        else if (e.button === 0) switchToTab(tab.id);
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        closeTabWithPlayback(tab.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(tab.id, { top: e.clientY, left: e.clientX });
      }}
      className={cx(
        "group pointer-events-auto relative flex h-[26px] min-w-[72px] max-w-[220px] flex-1 basis-[220px] cursor-default items-center gap-2 rounded-t-md border border-b-0 px-2.5 text-xs transition-colors",
        active
          ? "border-outline-variant/60 bg-surface-container-high text-on-surface"
          : "border-transparent text-on-surface-variant hover:bg-on-surface/5 hover:text-on-surface",
        dropTarget && "border-s-primary",
      )}
    >
      <TabIcon pathname={pathname} playing={playing} />
      <span dir="auto" className="min-w-0 flex-1 truncate">{label}</span>
      <button
        type="button"
        aria-label={getString("tabs_close")}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          closeTabWithPlayback(tab.id);
        }}
        className={cx(
          "grid h-4 w-4 shrink-0 place-items-center rounded-md transition-colors hover:bg-on-surface/15",
          active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        <X size={12} strokeWidth={2.25} />
      </button>
    </div>
  );
});

/** Browser-style tab strip, rendered inside the custom title bar. */
export function TabStrip() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeId = useTabsStore((s) => s.activeId);
  const hasClosed = useTabsStore((s) => s.closed.length > 0);
  const openTab = useTabsStore((s) => s.openTab);
  const duplicateTab = useTabsStore((s) => s.duplicateTab);
  const moveTab = useTabsStore((s) => s.moveTab);
  const reopenClosedTab = useTabsStore((s) => s.reopenClosedTab);

  const [menu, setMenu] = useState<{ id: string; anchor: MenuAnchor } | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const handleMenu = useCallback((id: string, anchor: MenuAnchor) => setMenu({ id, anchor }), []);

  // Keep the active tab in view when there are more tabs than fit.
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>("[aria-selected='true']");
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, tabs.length]);

  const menuTab = menu ? tabs.find((t) => t.id === menu.id) : undefined;
  const menuItem =
    "flex w-full items-center px-3.5 py-2 text-start text-sm text-chrome-zinc-300 transition-colors hover:bg-chrome-zinc-800 hover:text-chrome-zinc-100 disabled:pointer-events-none disabled:opacity-40";
  const runAndClose = (action: () => void) => () => {
    setMenu(null);
    action();
  };

  return (
    <div
      ref={stripRef}
      role="tablist"
      // pointer-events-none keeps the gaps draggable: the window drag region sits
      // behind this strip, and only the tabs themselves take clicks.
      className="scrollbar-none pointer-events-none relative z-10 flex h-full min-w-0 flex-1 items-end gap-1 overflow-x-auto ps-2 pe-1"
      onWheel={(e) => {
        if (stripRef.current && e.deltaY !== 0) stripRef.current.scrollLeft += e.deltaY;
      }}
    >
      {tabs.map((tab, index) => (
        <TabItem key={tab.id} tab={tab} index={index} onMenu={handleMenu} onDropAt={moveTab} />
      ))}
      <button
        type="button"
        aria-label={getString("tabs_new")}
        title={`${getString("tabs_new")} (Ctrl+T)`}
        onClick={() => {
          const id = openTab("/", { activate: false });
          switchToTab(id);
        }}
        className="pointer-events-auto mb-[3px] grid h-[22px] w-[22px] shrink-0 place-items-center self-end rounded-md text-on-surface-variant transition-colors hover:bg-on-surface/10 hover:text-on-surface"
      >
        <Plus size={14} strokeWidth={2.25} />
      </button>
      {IS_MAIN_WINDOW && (
        <button
          type="button"
          aria-label={getString("tabs_new_browser_tab")}
          title={`${getString("tabs_new_browser_tab")} (Ctrl+L)`}
          onClick={() => openWebTab()}
          className="pointer-events-auto mb-[3px] grid h-[22px] w-[22px] shrink-0 place-items-center self-end rounded-md text-on-surface-variant transition-colors hover:bg-on-surface/10 hover:text-on-surface"
        >
          <Globe size={14} strokeWidth={2.25} />
        </button>
      )}

      {menu && menuTab ? (
        <AnchoredPortalMenu
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          className="z-[110] w-56 rounded-xl border border-chrome-neutral-800 bg-surface-container-high py-1.5"
        >
          <button type="button" className={menuItem} onClick={runAndClose(() => duplicateTab(menuTab.id))}>
            {getString("tabs_duplicate")}
          </button>
          {/* A web page lives in the main window, so its tab can't move out. */}
          {!isBrowserTab(menuTab) && (
            <button type="button" className={menuItem} onClick={runAndClose(() => void moveTabToNewWindow(menuTab.id))}>
              {getString("move_to_new_window")}
            </button>
          )}
          <button type="button" className={menuItem} onClick={runAndClose(() => closeTabWithPlayback(menuTab.id))}>
            {getString("tabs_close")}
          </button>
          <button
            type="button"
            className={menuItem}
            disabled={tabs.length < 2}
            onClick={runAndClose(() => closeOtherTabs(menuTab.id))}
          >
            {getString("tabs_close_others")}
          </button>
          <button type="button" className={menuItem} disabled={!hasClosed} onClick={runAndClose(reopenClosedTab)}>
            {getString("tabs_reopen_closed")}
          </button>
        </AnchoredPortalMenu>
      ) : null}
    </div>
  );
}
