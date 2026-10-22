import { beforeEach, describe, expect, it } from "vitest";

import { HOME_PATH, selectActiveTab, useTabsStore, watchIdFromTabPath } from "./useTabsStore";

function reset() {
  const home = { id: "t0", path: HOME_PATH, title: "", back: [], forward: [] };
  useTabsStore.setState({ tabs: [home], activeId: home.id, closed: [] });
}

const state = () => useTabsStore.getState();
const active = () => selectActiveTab(state());
const paths = () => state().tabs.map((t) => t.path);

describe("useTabsStore", () => {
  beforeEach(reset);

  it("opens background tabs right after the active one", () => {
    state().openTab("/watch/a");
    state().openTab("/watch/b");
    expect(paths()).toEqual([HOME_PATH, "/watch/b", "/watch/a"]);
    expect(active().path).toBe(HOME_PATH);
  });

  it("activates a new tab when asked", () => {
    const id = state().openTab("/search?q=x", { activate: true, title: "x" });
    expect(state().activeId).toBe(id);
    expect(active().title).toBe("x");
  });

  it("records pushes onto the active tab's own history", () => {
    state().recordNavigation("/subscriptions", "push");
    state().recordNavigation("/watch/a", "push");
    expect(active().back).toEqual([HOME_PATH, "/subscriptions"]);

    state().goBack();
    expect(active().path).toBe("/subscriptions");
    expect(active().forward).toEqual(["/watch/a"]);

    state().goForward();
    expect(active().path).toBe("/watch/a");
    expect(active().forward).toEqual([]);
  });

  it("replaces without adding history, and a push clears forward", () => {
    state().recordNavigation("/watch/a", "push");
    state().recordNavigation("/watch/b", "replace");
    expect(active().back).toEqual([HOME_PATH]);
    expect(active().path).toBe("/watch/b");

    state().goBack();
    state().recordNavigation("/history", "push");
    expect(active().forward).toEqual([]);
  });

  it("keeps each tab's history separate", () => {
    state().recordNavigation("/history", "push");
    const second = state().openTab("/watch/a", { activate: true });
    expect(active().back).toEqual([]);
    state().goBack();
    expect(active().path).toBe("/watch/a");
    state().activateTab("t0");
    expect(active().back).toEqual([HOME_PATH]);
    expect(state().tabs.find((t) => t.id === second)?.path).toBe("/watch/a");
  });

  it("does nothing on back or forward with an empty stack", () => {
    state().goBack();
    state().goForward();
    expect(active().path).toBe(HOME_PATH);
  });

  it("hands focus to the right neighbour, or the left at the end", () => {
    const a = state().openTab("/a", { activate: true });
    const b = state().openTab("/b");
    state().activateTab(a);
    state().closeTab(a);
    expect(state().activeId).toBe(b);
    state().closeTab(b);
    expect(state().activeId).toBe("t0");
  });

  it("closing a background tab keeps the active one", () => {
    const a = state().openTab("/a");
    state().closeTab(a);
    expect(state().activeId).toBe("t0");
    expect(paths()).toEqual([HOME_PATH]);
  });

  it("closing the last tab leaves a fresh home tab", () => {
    state().recordNavigation("/history", "push");
    state().closeTab("t0");
    expect(state().tabs).toHaveLength(1);
    expect(active().path).toBe(HOME_PATH);
    expect(active().id).not.toBe("t0");
  });

  it("reopens the most recently closed tab with its history", () => {
    const a = state().openTab("/a", { activate: true });
    state().recordNavigation("/b", "push");
    state().closeTab(a);
    state().reopenClosedTab();
    expect(active().path).toBe("/b");
    expect(active().back).toEqual(["/a"]);
    expect(state().closed).toEqual([]);
  });

  it("closes other tabs", () => {
    const a = state().openTab("/a");
    state().openTab("/b");
    state().closeOtherTabs(a);
    expect(paths()).toEqual(["/a"]);
    expect(state().activeId).toBe(a);
    expect(state().closed).toHaveLength(2);
  });

  it("cycles and jumps by index", () => {
    state().openTab("/a");
    state().openTab("/b");
    // order: home, /b, /a
    state().cycleTab(1);
    expect(active().path).toBe("/b");
    state().cycleTab(-2);
    expect(active().path).toBe("/a");
    state().activateIndex(0);
    expect(active().path).toBe(HOME_PATH);
    state().activateIndex(9);
    expect(active().path).toBe(HOME_PATH);
  });

  it("moves tabs", () => {
    state().openTab("/a");
    state().openTab("/b");
    state().moveTab(0, 2);
    expect(paths()).toEqual(["/b", "/a", HOME_PATH]);
  });

  it("sets titles and clears them on navigation", () => {
    state().setTitle("t0", "Home");
    expect(active().title).toBe("Home");
    state().recordNavigation("/history", "push");
    expect(active().title).toBe("");
  });

  it("reads the video id from a watch path", () => {
    expect(watchIdFromTabPath("/watch/abc")).toBe("abc");
    expect(watchIdFromTabPath("/watch/a%20b?t=1")).toBe("a b");
    expect(watchIdFromTabPath("/history")).toBeNull();
  });
});
