import { beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationType } from "react-router-dom";

const resolveChannelId = vi.fn(async () => "UCresolved");
vi.mock("./api/youtube", () => ({ resolveChannelId }));
vi.mock("./streamResolution", () => ({ prefetchStreamInfo: vi.fn(), readStreamInfoEntry: () => null }));

const { openUrlInBackgroundTab, openRichTargetInBackground } = await import("./openLinkInTab");
const { useTabsStore } = await import("../store/useTabsStore");
const { createEntry, currentEntry } = await import("./tabs/tabHistory");
const { useAppSettingsStore } = await import("../store/useAppSettingsStore");

const setTabsOn = (on: boolean) =>
  useAppSettingsStore.setState((state) => ({ values: { ...state.values, tabs_enabled: String(on) } }));

const paths = () => useTabsStore.getState().tabs.map((tab) => currentEntry(tab).pathname + currentEntry(tab).search);

beforeEach(() => {
  useTabsStore.setState({
    tabs: [{ id: "a", entries: [createEntry("/watch/p")], index: 0 }],
    activeId: "a",
    action: NavigationType.Pop,
    cause: "history",
    playerTabId: null,
    parked: {},
    titles: {},
  });
  setTabsOn(true);
});

describe("openUrlInBackgroundTab", () => {
  it("opens a web page in a web tab behind the current one", () => {
    expect(openUrlInBackgroundTab("https://example.com/page")).toBe(true);
    expect(paths()).toEqual(["/watch/p", `/browse?url=${encodeURIComponent("https://example.com/page")}`]);
    expect(useTabsStore.getState().activeId).toBe("a");
  });

  it("opens a YouTube video in a Flow tab", () => {
    expect(openUrlInBackgroundTab("https://www.youtube.com/watch?v=abcdefghijk")).toBe(true);
    expect(paths()).toEqual(["/watch/p", "/watch/abcdefghijk"]);
    expect(useTabsStore.getState().activeId).toBe("a");
  });

  it("resolves a channel handle before opening its tab", async () => {
    expect(openUrlInBackgroundTab("https://www.youtube.com/@flow")).toBe(true);
    await vi.waitFor(() => expect(paths()).toEqual(["/watch/p", "/channel/UCresolved"]));
  });

  it("does nothing while tabs are off, or for a link that isn't a web page", () => {
    expect(openUrlInBackgroundTab("mailto:a@b.c")).toBe(false);
    setTabsOn(false);
    expect(openUrlInBackgroundTab("https://example.com")).toBe(false);
    expect(paths()).toEqual(["/watch/p"]);
  });
});

describe("openRichTargetInBackground", () => {
  it("opens in-app targets in a background tab and leaves timestamps alone", () => {
    expect(openRichTargetInBackground({ kind: "channel", channelId: "UC1" })).toBe(true);
    expect(openRichTargetInBackground({ kind: "timestamp", seconds: 30 })).toBe(false);
    expect(paths()).toEqual(["/watch/p", "/channel/UC1"]);
    expect(useTabsStore.getState().activeId).toBe("a");
  });
});
