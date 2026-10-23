import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./useResolvedWindowTitle", () => ({
  useResolvedWindowTitle: () => ({ text: "", section: false }),
}));
vi.mock("../store/useMusicPlayerStore", () => ({
  useMusicPlayerStore: (select: (s: { currentTrack: null; viewState: string }) => unknown) =>
    select({ currentTrack: null, viewState: "dock" }),
}));
vi.mock("./tabs", () => ({
  closeActiveBrowserTab: () => {},
  settlePendingDismiss: () => {},
}));

const { useTabsController } = await import("./useTabsController");
const { HOME_PATH, selectActiveTab, useTabsStore } = await import("../store/useTabsStore");

let navigate: NavigateFunction = () => {};
let locations: string[] = [];

function Harness() {
  useTabsController();
  const location = useLocation();
  navigate = useNavigate();
  const path = location.pathname + location.search;
  useEffect(() => {
    locations.push(path);
    // A loop shows up as an unbounded run of location changes; fail fast.
    if (locations.length > 40) throw new Error(`navigation loop: ${locations.slice(-6).join(" -> ")}`);
  }, [path]);
  return null;
}

/** Rewrites the watch URL with a replace right after a push, as the global player does. */
function PlayerRedirect() {
  const location = useLocation();
  const nav = useNavigate();
  useEffect(() => {
    if (location.pathname === "/watch/a") nav("/watch/b", { replace: true });
  }, [location.pathname, nav]);
  return null;
}

const activeTab = () => selectActiveTab(useTabsStore.getState());
const current = () => locations[locations.length - 1];

async function mount() {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(
          MemoryRouter,
          { initialEntries: [HOME_PATH] },
          createElement(Harness),
          createElement(PlayerRedirect),
        ),
      ),
    );
  });
  return root;
}

describe("useTabsController", () => {
  beforeEach(() => {
    locations = [];
    useTabsStore.setState({
      tabs: [{ id: "t0", path: HOME_PATH, title: "", back: [], forward: [] }],
      activeId: "t0",
      closed: [],
    });
  });

  it("records a page change once, without bouncing back (regression: flicker loop)", async () => {
    const root = await mount();
    locations = [];
    await act(async () => navigate("/watch/x"));
    expect(locations).toEqual(["/watch/x"]);
    expect(activeTab().path).toBe("/watch/x");
    expect(activeTab().back).toEqual([HOME_PATH]);
    root.unmount();
  });

  it("follows tab switches and per-tab back", async () => {
    const root = await mount();
    await act(async () => navigate("/watch/x"));

    await act(async () => {
      useTabsStore.getState().openTab("/history", { activate: true });
    });
    expect(current()).toBe("/history");

    await act(async () => useTabsStore.getState().activateIndex(0));
    expect(current()).toBe("/watch/x");

    await act(async () => useTabsStore.getState().goBack());
    expect(current()).toBe(HOME_PATH);
    expect(activeTab().forward).toEqual(["/watch/x"]);
    root.unmount();
  });

  it("keeps a replace that lands right after a push", async () => {
    const root = await mount();
    await act(async () => navigate("/watch/a"));
    expect(current()).toBe("/watch/b");
    expect(activeTab().path).toBe("/watch/b");
    root.unmount();
  });
});
