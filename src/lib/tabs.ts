import { usePlayerStore } from "../store/usePlayerStore";
import { useTabsStore, watchIdFromTabPath } from "../store/useTabsStore";
import type { VideoSummary } from "../types/video";

/*
  Tab actions that also touch playback. The tab store itself knows nothing about
  the player; these helpers decide what closing or opening a tab means for the
  video that is playing.
*/

/** A video whose player should be dismissed once the router has left its watch page. */
let dismissWhenLeaving: string | null = null;

/** Called by the tabs controller on every location change. */
export function settlePendingDismiss(pathname: string) {
  if (!dismissWhenLeaving) return;
  if (watchIdFromTabPath(pathname) === dismissWhenLeaving) return;
  const videoId = dismissWhenLeaving;
  dismissWhenLeaving = null;
  const player = usePlayerStore.getState();
  if (player.currentVideo?.id === videoId) player.dismissVideoPlayer();
}

/**
 * Close a tab. Like a browser, closing the tab a video is playing in stops it —
 * unless another open tab is showing the same video.
 */
export function closeBrowserTab(id: string) {
  const tabsState = useTabsStore.getState();
  const tab = tabsState.tabs.find((t) => t.id === id);
  if (!tab) return;

  const videoId = watchIdFromTabPath(tab.path);
  const playingId = usePlayerStore.getState().currentVideo?.id ?? null;
  const openElsewhere =
    videoId !== null &&
    tabsState.tabs.some((t) => t.id !== id && watchIdFromTabPath(t.path) === videoId);
  const stopsPlayback = videoId !== null && videoId === playingId && !openElsewhere;
  const wasActive = tabsState.activeId === id;

  tabsState.closeTab(id);

  if (!stopsPlayback) return;
  if (wasActive) {
    // The watch page is still mounted until the router moves to the next tab.
    // Clearing the player now would make it reload the video it is showing, so
    // the dismiss waits for the route to change.
    dismissWhenLeaving = videoId;
  } else {
    usePlayerStore.getState().dismissVideoPlayer();
  }
}

/** Close every tab but one, stopping a video whose tab was closed. */
export function closeOtherBrowserTabs(keepId: string) {
  const tabsState = useTabsStore.getState();
  const keep = tabsState.tabs.find((t) => t.id === keepId);
  if (!keep) return;

  const playingId = usePlayerStore.getState().currentVideo?.id ?? null;
  const keptVideo = watchIdFromTabPath(keep.path);
  const wasActive = tabsState.activeId === keepId;

  tabsState.closeOtherTabs(keepId);

  if (!playingId || keptVideo === playingId) return;
  if (wasActive) usePlayerStore.getState().dismissVideoPlayer();
  else dismissWhenLeaving = playingId;
}

export function closeActiveBrowserTab() {
  closeBrowserTab(useTabsStore.getState().activeId);
}

/** Open a video in a new background tab, like a middle-click in a browser. */
export function openVideoInNewTab(video: Pick<VideoSummary, "id" | "title">, activate = false) {
  useTabsStore.getState().openTab(`/watch/${encodeURIComponent(video.id)}`, {
    activate,
    title: video.title || undefined,
  });
}

/** Open any app path in a new tab. */
export function openPathInNewTab(path: string, activate = false) {
  useTabsStore.getState().openTab(path, { activate });
}

/**
 * If a tab is already showing this video, switch to it and return true. Used when
 * the mini player is expanded, so it returns to the tab the video belongs to
 * instead of loading it again in whichever tab is open.
 */
export function focusTabForVideo(videoId: string): boolean {
  const { tabs, activeId, activateTab } = useTabsStore.getState();
  const active = tabs.find((t) => t.id === activeId);
  if (active && watchIdFromTabPath(active.path) === videoId) return false;
  const owner = tabs.find((t) => watchIdFromTabPath(t.path) === videoId);
  if (!owner) return false;
  activateTab(owner.id);
  return true;
}

/** True for a click that should open in a new tab: middle button, or Ctrl/Cmd held. */
export function isNewTabClick(event: { button: number; ctrlKey: boolean; metaKey: boolean }) {
  return event.button === 1 || event.ctrlKey || event.metaKey;
}
