import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard, Compass, Globe, Music, Plus, Search, Volume2, X } from "lucide-react";
import { HOME_PATH, useTabsStore, watchIdFromTabPath, type BrowserTab } from "../../store/useTabsStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { closeBrowserTab, closeOtherBrowserTabs } from "../../lib/tabs";
import { getString } from "../../lib/i18n/index";
import { AnchoredPortalMenu, type MenuAnchor } from "../ui/AnchoredPortalMenu";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function fallbackTitle(path: string) {
  if (path === HOME_PATH) return getString("tabs_home");
  if (watchIdFromTabPath(path)) return getString("tabs_video");
  if (path.startsWith("/search")) return getString("tabs_search");
  return getString("tabs_new_tab");
}

function TabIcon({ path, playing }: { path: string; playing: boolean }) {
  const common = { size: 14, strokeWidth: 2, className: "shrink-0" } as const;
  if (playing) return <Volume2 {...common} className="shrink-0 text-primary" />;
  if (path === HOME_PATH) return <Compass {...common} />;
  if (watchIdFromTabPath(path) || path.startsWith("/shorts")) return <Clapperboard {...common} />;
  if (path.startsWith("/music")) return <Music {...common} />;
  if (path.startsWith("/search")) return <Search {...common} />;
  return <Globe {...common} />;
}

interface TabItemProps {
  tab: BrowserTab;
  index: number;
  active: boolean;
  playing: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onMenu: (id: string, anchor: MenuAnchor) => void;
  onDropAt: (fromIndex: number, toIndex: number) => void;
}

const TabItem = memo(function TabItem({
  tab,
  index,
  active,
  playing,
  onActivate,
  onClose,
  onMenu,
  onDropAt,
}: TabItemProps) {
  const label = tab.title || fallbackTitle(tab.path);
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
        else if (e.button === 0) onActivate(tab.id);
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        onClose(tab.id);
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
        dropTarget && "border-l-primary",
      )}
    >
      <TabIcon path={tab.path} playing={playing} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <button
        type="button"
        aria-label={getString("tabs_close")}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClose(tab.id);
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
  const activateTab = useTabsStore((s) => s.activateTab);
  const moveTab = useTabsStore((s) => s.moveTab);
  const reopenClosedTab = useTabsStore((s) => s.reopenClosedTab);

  const playingVideoId = usePlayerStore((s) => (s.isPlaying ? s.currentVideo?.id ?? null : null));

  const [menu, setMenu] = useState<{ id: string; anchor: MenuAnchor } | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const handleMenu = useCallback((id: string, anchor: MenuAnchor) => setMenu({ id, anchor }), []);
  const handleClose = useCallback((id: string) => closeBrowserTab(id), []);

  // Keep the active tab in view when there are more tabs than fit.
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>("[aria-selected='true']");
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, tabs.length]);

  // A tab only shows the speaker while it is the one actually playing; another
  // tab with the same video open does not.
  const playingTabId = (() => {
    if (!playingVideoId) return null;
    const active = tabs.find((t) => t.id === activeId);
    if (active && watchIdFromTabPath(active.path) === playingVideoId) return active.id;
    return tabs.find((t) => watchIdFromTabPath(t.path) === playingVideoId)?.id ?? null;
  })();

  const menuTab = menu ? tabs.find((t) => t.id === menu.id) : undefined;
  const menuItem =
    "flex w-full items-center px-3.5 py-2 text-left text-sm text-chrome-zinc-300 transition-colors hover:bg-chrome-zinc-800 hover:text-chrome-zinc-100 disabled:pointer-events-none disabled:opacity-40";

  return (
    <div
      ref={stripRef}
      role="tablist"
      // pointer-events-none keeps the gaps draggable: the window drag region sits
      // behind this strip, and only the tabs themselves take clicks.
      className="scrollbar-none pointer-events-none relative z-10 flex h-full min-w-0 flex-1 items-end gap-1 overflow-x-auto pl-2 pr-1"
      onWheel={(e) => {
        if (stripRef.current && e.deltaY !== 0) stripRef.current.scrollLeft += e.deltaY;
      }}
    >
      {tabs.map((tab, index) => (
        <TabItem
          key={tab.id}
          tab={tab}
          index={index}
          active={tab.id === activeId}
          playing={tab.id === playingTabId}
          onActivate={activateTab}
          onClose={handleClose}
          onMenu={handleMenu}
          onDropAt={moveTab}
        />
      ))}
      <button
        type="button"
        aria-label={getString("tabs_new_tab")}
        title={`${getString("tabs_new_tab")} (Ctrl+T)`}
        onClick={() => openTab(HOME_PATH, { activate: true })}
        className="pointer-events-auto mb-[3px] grid h-[22px] w-[22px] shrink-0 place-items-center self-end rounded-md text-on-surface-variant transition-colors hover:bg-on-surface/10 hover:text-on-surface"
      >
        <Plus size={14} strokeWidth={2.25} />
      </button>

      {menu && menuTab ? (
        <AnchoredPortalMenu
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          className="z-[110] w-56 rounded-xl border border-chrome-neutral-800 bg-surface-container-high py-1.5"
        >
          <button
            type="button"
            className={menuItem}
            onClick={() => {
              openTab(menuTab.path, { activate: true, title: menuTab.title });
              setMenu(null);
            }}
          >
            {getString("tabs_duplicate")}
          </button>
          <button
            type="button"
            className={menuItem}
            onClick={() => {
              handleClose(menuTab.id);
              setMenu(null);
            }}
          >
            {getString("tabs_close")}
          </button>
          <button
            type="button"
            className={menuItem}
            disabled={tabs.length < 2}
            onClick={() => {
              closeOtherBrowserTabs(menuTab.id);
              setMenu(null);
            }}
          >
            {getString("tabs_close_others")}
          </button>
          <button
            type="button"
            className={menuItem}
            disabled={!hasClosed}
            onClick={() => {
              reopenClosedTab();
              setMenu(null);
            }}
          >
            {getString("tabs_reopen_closed")}
          </button>
        </AnchoredPortalMenu>
      ) : null}
    </div>
  );
}
