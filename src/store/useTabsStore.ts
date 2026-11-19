import { create } from "zustand";
import { NavigationType, type To } from "react-router-dom";
import {
  createEntry,
  createEntryKey,
  goInTab,
  pushEntry,
  replaceEntry,
  type TabHistory,
} from "../lib/tabs/tabHistory";
import { createTabId, insertTabAfter, neighborTab } from "../lib/tabs/tabList";
import type { PlaylistContext } from "./usePlayerStore";
import type { VideoSummary } from "../types/video";

/** A video a tab was showing when another tab took the player, kept so it can resume there. */
export interface ParkedVideo {
  videoId: string;
  positionSeconds: number;
  queue: VideoSummary[];
  currentIndex: number;
  playlistContext: PlaylistContext | null;
}

/** A tab's title, tied to the page it was read from so a stale one is never shown. */
export interface TabTitle {
  key: string;
  text: string;
}

interface TabsState {
  tabs: TabHistory[];
  activeId: string;
  /** How the active tab's current page was reached, for the router's navigation type. */
  action: NavigationType;
  /** Whether the last route change came from switching tabs rather than navigating in one. */
  cause: "history" | "tab";
  /** The tab whose video is in the window's player. */
  playerTabId: string | null;
  parked: Record<string, ParkedVideo>;
  titles: Record<string, TabTitle>;
  push: (to: To, state?: unknown) => void;
  replace: (to: To, state?: unknown) => void;
  go: (delta: number) => void;
  /** Replaces the current page of any tab, active or not. */
  replaceInTab: (id: string, to: To) => void;
  openTab: (to: To, options?: { activate?: boolean }) => string;
  /** A copy of the tab's back/forward list, opened in the background after it. */
  duplicateTab: (id: string) => void;
  activateTab: (id: string) => void;
  closeTab: (id: string) => void;
  /** Drops every other tab; a video still in the player then belongs to this one. */
  keepOnlyTab: (id: string) => void;
  setPlayerTab: (id: string | null) => void;
  park: (id: string, video: ParkedVideo) => void;
  unpark: (id: string) => void;
  setTabTitle: (id: string, key: string, text: string) => void;
  restoreTabs: (restored: Pick<TabsState, "tabs" | "activeId" | "parked" | "titles">) => void;
  /** Recently closed tabs, newest last, for Reopen closed tab (Ctrl+Shift+T). */
  closed: TabHistory[];
  reopenClosedTab: () => void;
  /** Drag-and-drop reordering in the top tab strip. */
  moveTab: (fromIndex: number, toIndex: number) => void;
  /**
   * Records a navigation on any tab, active or not. Web tabs use this for
   * navigations made inside the page; on the active tab the router follows.
   */
  navigateTab: (id: string, to: To, kind: "push" | "replace") => void;
}

/** How many closed tabs Reopen closed tab can bring back. */
const MAX_CLOSED_TABS = 10;

function initialTab(): TabHistory {
  const { pathname, search, hash } = typeof window === "undefined"
    ? { pathname: "/", search: "", hash: "" }
    : window.location;
  return { id: createTabId(), entries: [createEntry({ pathname, search, hash })], index: 0 };
}

export function activeTab(state: Pick<TabsState, "tabs" | "activeId">): TabHistory {
  const tab = state.tabs.find((candidate) => candidate.id === state.activeId) ?? state.tabs[0];
  if (!tab) throw new Error("A window always has at least one tab");
  return tab;
}

function updateTab(state: TabsState, next: TabHistory): Pick<TabsState, "tabs"> {
  return { tabs: state.tabs.map((tab) => (tab.id === next.id ? next : tab)) };
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const { [key]: _removed, ...rest } = record;
  return rest;
}

const firstTab = initialTab();

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [firstTab],
  activeId: firstTab.id,
  action: NavigationType.Pop,
  cause: "history",
  playerTabId: null,
  parked: {},
  titles: {},
  closed: [],

  push: (to, state) => {
    const current = get();
    set({
      ...updateTab(current, pushEntry(activeTab(current), createEntry(to, state))),
      action: NavigationType.Push,
      cause: "history",
    });
  },

  replace: (to, state) => {
    const current = get();
    set({
      ...updateTab(current, replaceEntry(activeTab(current), createEntry(to, state))),
      action: NavigationType.Replace,
      cause: "history",
    });
  },

  go: (delta) => {
    const current = get();
    const next = goInTab(activeTab(current), delta);
    if (next) set({ ...updateTab(current, next), action: NavigationType.Pop, cause: "history" });
  },

  replaceInTab: (id, to) => {
    const current = get();
    const tab = current.tabs.find((candidate) => candidate.id === id);
    if (!tab) return;
    if (id === current.activeId) {
      current.replace(to);
      return;
    }
    set(updateTab(current, replaceEntry(tab, createEntry(to))));
  },

  openTab: (to, options) => {
    const current = get();
    const tab: TabHistory = { id: createTabId(), entries: [createEntry(to)], index: 0 };
    set({
      tabs: insertTabAfter(current.tabs, current.activeId, tab),
      ...(options?.activate ? { activeId: tab.id, action: NavigationType.Push, cause: "tab" as const } : {}),
    });
    return tab.id;
  },

  duplicateTab: (id) => {
    const current = get();
    const source = current.tabs.find((tab) => tab.id === id);
    if (!source) return;
    const copy: TabHistory = {
      id: createTabId(),
      entries: source.entries.map((entry) => ({ ...entry, key: createEntryKey() })),
      index: source.index,
    };
    const title = current.titles[id];
    const copiedKey = copy.entries[copy.index]?.key;
    set({
      tabs: insertTabAfter(current.tabs, id, copy),
      ...(title && copiedKey ? { titles: { ...current.titles, [copy.id]: { key: copiedKey, text: title.text } } } : {}),
    });
  },

  activateTab: (id) => {
    const current = get();
    if (id === current.activeId || !current.tabs.some((tab) => tab.id === id)) return;
    set({ activeId: id, action: NavigationType.Pop, cause: "tab" });
  },

  closeTab: (id) => {
    const current = get();
    const neighbor = neighborTab(current.tabs, id);
    if (!neighbor) return;
    const closing = current.tabs.find((tab) => tab.id === id);
    set({
      tabs: current.tabs.filter((tab) => tab.id !== id),
      closed: closing ? [...current.closed, closing].slice(-MAX_CLOSED_TABS) : current.closed,
      parked: withoutKey(current.parked, id),
      titles: withoutKey(current.titles, id),
      playerTabId: current.playerTabId === id ? null : current.playerTabId,
      ...(current.activeId === id ? { activeId: neighbor.id, action: NavigationType.Pop, cause: "tab" as const } : {}),
    });
  },

  keepOnlyTab: (id) => {
    const current = get();
    const tab = current.tabs.find((candidate) => candidate.id === id);
    if (!tab) return;
    const title = current.titles[id];
    set({
      tabs: [tab],
      activeId: id,
      closed: [],
      parked: {},
      titles: title ? { [id]: title } : {},
      playerTabId: current.playerTabId ? id : null,
    });
  },

  setPlayerTab: (id) => set({ playerTabId: id }),
  park: (id, video) => set((current) => ({ parked: { ...current.parked, [id]: video } })),
  unpark: (id) => set((current) => ({ parked: withoutKey(current.parked, id) })),

  setTabTitle: (id, key, text) => {
    const title = get().titles[id];
    if (title?.key === key && title.text === text) return;
    set((current) => ({ titles: { ...current.titles, [id]: { key, text } } }));
  },

  reopenClosedTab: () => {
    const current = get();
    const tab = current.closed[current.closed.length - 1];
    if (!tab) return;
    // A fresh id: the old one may still name a closed web page being torn down.
    const reopened: TabHistory = { ...tab, id: createTabId() };
    set({
      tabs: insertTabAfter(current.tabs, current.activeId, reopened),
      closed: current.closed.slice(0, -1),
      activeId: reopened.id,
      action: NavigationType.Pop,
      cause: "tab",
    });
  },

  moveTab: (fromIndex, toIndex) => {
    const current = get();
    const count = current.tabs.length;
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= count || toIndex >= count) return;
    const tabs = [...current.tabs];
    const [moved] = tabs.splice(fromIndex, 1);
    if (!moved) return;
    tabs.splice(toIndex, 0, moved);
    set({ tabs });
  },

  navigateTab: (id, to, kind) => {
    const current = get();
    if (id === current.activeId) {
      if (kind === "push") current.push(to);
      else current.replace(to);
      return;
    }
    const tab = current.tabs.find((candidate) => candidate.id === id);
    if (!tab) return;
    const entry = createEntry(to);
    set(updateTab(current, kind === "push" ? pushEntry(tab, entry) : replaceEntry(tab, entry)));
  },

  restoreTabs: (restored) =>
    set({ ...restored, playerTabId: null, action: NavigationType.Pop, cause: "tab" }),
}));
