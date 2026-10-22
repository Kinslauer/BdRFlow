import { create } from "zustand";

/*
  Browser-style tabs.

  A tab is nothing more than a location (pathname + search) with its own back and
  forward stacks. Only the active tab is ever rendered: switching tabs navigates
  the router to that tab's location, and the pages load as they would on any
  other navigation. Watch pages resume from saved progress, so a video tab picks
  up where it was left when it is switched back to.

  The router and this store are kept in step by `useTabsController`:
  - an in-app navigation (a link, a card click) changes the router location, and
    the controller records it on the active tab with `recordNavigation`;
  - a tab action (switch, close, back, forward) changes the active tab's `path`
    here, and the controller navigates the router to it.
*/

export interface BrowserTab {
  id: string;
  /** pathname + search, e.g. "/watch/abc" or "/search?q=cats". */
  path: string;
  /** Last resolved title; empty until the page has told us one. */
  title: string;
  back: string[];
  forward: string[];
}

export interface OpenTabOptions {
  /** Switch to the new tab. Default false, like a middle-click in a browser. */
  activate?: boolean;
  /** A title to show before the page has loaded (e.g. the video's title). */
  title?: string;
}

interface TabsState {
  tabs: BrowserTab[];
  activeId: string;
  /** Recently closed tabs, newest last, for Ctrl+Shift+T. */
  closed: BrowserTab[];

  openTab: (path?: string, options?: OpenTabOptions) => string;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  reopenClosedTab: () => void;
  activateTab: (id: string) => void;
  activateIndex: (index: number) => void;
  cycleTab: (delta: number) => void;
  moveTab: (fromIndex: number, toIndex: number) => void;
  /** Record a navigation that already happened in the router, on the active tab. */
  recordNavigation: (path: string, kind: "push" | "replace") => void;
  setTitle: (id: string, title: string) => void;
  goBack: () => void;
  goForward: () => void;
}

export const HOME_PATH = "/";
const MAX_HISTORY = 50;
const MAX_CLOSED = 10;
const STORAGE_KEY = "flow.tabs.v1";

let idCounter = 0;
function newId() {
  idCounter += 1;
  return `tab-${Date.now().toString(36)}-${idCounter}`;
}

function makeTab(path: string, title = ""): BrowserTab {
  return { id: newId(), path, title, back: [], forward: [] };
}

function capped(stack: string[]) {
  return stack.length > MAX_HISTORY ? stack.slice(stack.length - MAX_HISTORY) : stack;
}

function updateTab(tabs: BrowserTab[], id: string, patch: (tab: BrowserTab) => BrowserTab) {
  return tabs.map((tab) => (tab.id === id ? patch(tab) : tab));
}

function isValidTab(value: unknown): value is BrowserTab {
  if (!value || typeof value !== "object") return false;
  const tab = value as Record<string, unknown>;
  return (
    typeof tab.id === "string" &&
    typeof tab.path === "string" &&
    tab.path.startsWith("/") &&
    typeof tab.title === "string" &&
    Array.isArray(tab.back) &&
    Array.isArray(tab.forward)
  );
}

type PersistedTabs = Pick<TabsState, "tabs" | "activeId">;

function loadPersisted(): PersistedTabs | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedTabs>;
    const tabs = Array.isArray(parsed.tabs) ? parsed.tabs.filter(isValidTab) : [];
    const first = tabs[0];
    if (!first) return null;
    const activeId = tabs.some((tab) => tab.id === parsed.activeId) ? (parsed.activeId as string) : first.id;
    return { tabs, activeId };
  } catch {
    return null;
  }
}

function initialState(): PersistedTabs {
  const persisted = loadPersisted();
  if (persisted) return persisted;
  const first = makeTab(HOME_PATH);
  return { tabs: [first], activeId: first.id };
}

export const useTabsStore = create<TabsState>()((set, get) => ({
  ...initialState(),
  closed: [],

  openTab: (path = HOME_PATH, options = {}) => {
    const tab = makeTab(path, options.title ?? "");
    set((state) => {
      // New tabs open just after the active one, like a browser.
      const activeIndex = state.tabs.findIndex((t) => t.id === state.activeId);
      const tabs = [...state.tabs];
      tabs.splice(activeIndex + 1, 0, tab);
      return { tabs, activeId: options.activate ? tab.id : state.activeId };
    });
    return tab.id;
  },

  closeTab: (id) => {
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === id);
      const closing = state.tabs[index];
      if (!closing) return state;
      const closed = [...state.closed, closing].slice(-MAX_CLOSED);
      const remaining = state.tabs.filter((t) => t.id !== id);

      // Closing the last tab leaves a fresh home tab rather than an empty window.
      if (remaining.length === 0) {
        const home = makeTab(HOME_PATH);
        return { tabs: [home], activeId: home.id, closed };
      }

      if (state.activeId !== id) return { tabs: remaining, closed };
      // The neighbour to the right takes over, or the left one at the end.
      const next = remaining[Math.min(index, remaining.length - 1)] ?? remaining[0];
      return { tabs: remaining, activeId: next?.id ?? state.activeId, closed };
    });
  },

  closeOtherTabs: (id) => {
    set((state) => {
      const keep = state.tabs.find((t) => t.id === id);
      if (!keep) return state;
      const others = state.tabs.filter((t) => t.id !== id);
      return { tabs: [keep], activeId: keep.id, closed: [...state.closed, ...others].slice(-MAX_CLOSED) };
    });
  },

  reopenClosedTab: () => {
    const { closed } = get();
    const last = closed[closed.length - 1];
    if (!last) return;
    // A fresh id: the old one may have been reused by nothing, but there is no
    // reason to rely on that.
    const tab: BrowserTab = { ...last, id: newId() };
    set((state) => {
      const activeIndex = state.tabs.findIndex((t) => t.id === state.activeId);
      const tabs = [...state.tabs];
      tabs.splice(activeIndex + 1, 0, tab);
      return { tabs, activeId: tab.id, closed: state.closed.slice(0, -1) };
    });
  },

  activateTab: (id) => {
    if (get().tabs.some((t) => t.id === id)) set({ activeId: id });
  },

  activateIndex: (index) => {
    const { tabs } = get();
    const tab = tabs[index];
    if (tab) set({ activeId: tab.id });
  },

  cycleTab: (delta) => {
    const { tabs, activeId } = get();
    if (tabs.length < 2) return;
    const index = tabs.findIndex((t) => t.id === activeId);
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next) set({ activeId: next.id });
  },

  moveTab: (fromIndex, toIndex) => {
    set((state) => {
      if (fromIndex === toIndex) return state;
      if (fromIndex < 0 || fromIndex >= state.tabs.length) return state;
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(fromIndex, 1);
      if (!moved) return state;
      tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, moved);
      return { tabs };
    });
  },

  recordNavigation: (path, kind) => {
    set((state) => ({
      tabs: updateTab(state.tabs, state.activeId, (tab) => {
        if (tab.path === path) return tab;
        if (kind === "replace") return { ...tab, path, title: "" };
        return {
          ...tab,
          path,
          title: "",
          back: capped([...tab.back, tab.path]),
          forward: [],
        };
      }),
    }));
  },

  setTitle: (id, title) => {
    set((state) => {
      const tab = state.tabs.find((t) => t.id === id);
      if (!tab || tab.title === title) return state;
      return { tabs: updateTab(state.tabs, id, (t) => ({ ...t, title })) };
    });
  },

  goBack: () => {
    set((state) => ({
      tabs: updateTab(state.tabs, state.activeId, (tab) => {
        const previous = tab.back[tab.back.length - 1];
        if (previous === undefined) return tab;
        return {
          ...tab,
          path: previous,
          title: "",
          back: tab.back.slice(0, -1),
          forward: capped([...tab.forward, tab.path]),
        };
      }),
    }));
  },

  goForward: () => {
    set((state) => ({
      tabs: updateTab(state.tabs, state.activeId, (tab) => {
        const next = tab.forward[tab.forward.length - 1];
        if (next === undefined) return tab;
        return {
          ...tab,
          path: next,
          title: "",
          back: capped([...tab.back, tab.path]),
          forward: tab.forward.slice(0, -1),
        };
      }),
    }));
  },
}));

/** The active tab. The store always holds at least one tab. */
export function selectActiveTab(state: Pick<TabsState, "tabs" | "activeId">): BrowserTab {
  return (state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0]) as BrowserTab;
}

/** The video id a tab is showing, or null when it isn't a watch page. */
export function watchIdFromTabPath(path: string): string | null {
  const match = path.match(/^\/watch\/([^/?#]+)/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

// Tabs survive a restart. Saved on change, outside React, so a write never
// re-renders anything; a failed write (quota, private storage) is ignored.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
useTabsStore.subscribe((state, previous) => {
  if (state.tabs === previous.tabs && state.activeId === previous.activeId) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const { tabs, activeId } = useTabsStore.getState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeId }));
    } catch {
      // Storage unavailable: tabs simply won't be restored next launch.
    }
  }, 300);
});
