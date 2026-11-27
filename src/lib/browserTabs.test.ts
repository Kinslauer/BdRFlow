import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("./api/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api/browser")>()),
  closeBrowserView: vi.fn(() => Promise.resolve()),
  retainBrowserViews: vi.fn(() => Promise.resolve()),
}));

import { NavigationType } from "react-router-dom";
import { handleBrowserState, openWebTab, tabPath } from "./browserTabs";
import { browsePath } from "./browserUrl";
import { activeTab, useTabsStore } from "../store/useTabsStore";
import { createEntry, currentEntry } from "./tabs/tabHistory";
import { selectBrowserPage, useBrowserStore } from "../store/useBrowserStore";

const A = "https://a.example/";
const B = "https://b.example/page";
const B2 = "https://www.b.example/page";

const tabs = () => useTabsStore.getState();
const active = () => activeTab(tabs());
const path = (id?: string) => {
  const tab = id ? tabs().tabs.find((t) => t.id === id) : active();
  return tab ? tabPath(tab) : null;
};
/** The pages before the current one in the active tab's back list. */
const back = () => {
  const tab = active();
  return tab.entries.slice(0, tab.index).map((entry) => entry.pathname + entry.search);
};
const title = () => {
  const tab = active();
  const t = tabs().titles[tab.id];
  return t?.key === currentEntry(tab).key ? t.text : "";
};
const page = (id: string) => selectBrowserPage(id)(useBrowserStore.getState());

function startOn(url: string) {
  const home = { id: "t0", entries: [createEntry("/")], index: 0 };
  useTabsStore.setState({
    tabs: [home],
    activeId: home.id,
    action: NavigationType.Pop,
    cause: "history",
    playerTabId: null,
    parked: {},
    titles: {},
    closed: [],
  });
  useBrowserStore.setState({ pages: {} });
  const id = openWebTab(url);
  // What the browser page does when it opens the address.
  useBrowserStore.getState().update(id, { url, pending: true, loading: true });
  return id;
}

describe("handleBrowserState", () => {
  beforeEach(() => useBrowserStore.setState({ pages: {} }));

  it("opens a browser tab at its address and activates it", () => {
    const id = startOn(A);
    expect(tabs().activeId).toBe(id);
    expect(path()).toBe(browsePath(A));
  });

  it("keeps the app's own load and its redirect as one history entry", () => {
    const id = startOn(B);
    handleBrowserState({ id, kind: "loadStarted", url: B });
    handleBrowserState({ id, kind: "loadFinished", url: B2 });
    expect(path()).toBe(browsePath(B2));
    expect(back()).toEqual([]);
    expect(page(id)).toMatchObject({ url: B2, pending: false, loading: false });
  });

  it("records a link clicked in the page as a new history entry", () => {
    const id = startOn(A);
    handleBrowserState({ id, kind: "loadFinished", url: A });
    handleBrowserState({ id, kind: "loadStarted", url: B });
    expect(path()).toBe(browsePath(B));
    expect(back()).toEqual([browsePath(A)]);
    expect(page(id).url).toBe(B);
    handleBrowserState({ id, kind: "loadFinished", url: B });
    expect(back()).toEqual([browsePath(A)]);
  });

  it("follows single-page address changes and titles", () => {
    const id = startOn(A);
    handleBrowserState({ id, kind: "loadFinished", url: A });
    handleBrowserState({ id, kind: "title", url: `${A}#/inbox`, title: "Inbox" });
    expect(path()).toBe(browsePath(`${A}#/inbox`));
    expect(title()).toBe("Inbox");
  });

  it("records a single-page move to another page as a new history entry", () => {
    const id = startOn(A);
    handleBrowserState({ id, kind: "loadFinished", url: A });
    handleBrowserState({ id, kind: "title", url: `${A}repo/issues`, title: "Issues" });
    expect(path()).toBe(browsePath(`${A}repo/issues`));
    expect(back()).toEqual([browsePath(A)]);
    handleBrowserState({ id, kind: "title", url: `${A}repo/issues#comment-1`, title: "Issues" });
    expect(back()).toEqual([browsePath(A)]);
  });

  it("updates a background tab without switching to it", () => {
    const id = startOn(A);
    handleBrowserState({ id, kind: "loadFinished", url: A });
    tabs().activateTab("t0");
    handleBrowserState({ id, kind: "loadStarted", url: B });
    expect(tabs().activeId).toBe("t0");
    expect(path(id)).toBe(browsePath(B));
  });

  it("ignores events for tabs that are gone or not on the web", () => {
    startOn(A);
    handleBrowserState({ id: "t0", kind: "loadStarted", url: B });
    handleBrowserState({ id: "missing", kind: "loadStarted", url: B });
    expect(path("t0")).toBe("/");
  });
});
