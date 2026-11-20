import type { MouseEvent as ReactMouseEvent } from "react";
import { resolveChannelId } from "./api/youtube";
import { isWebUrl } from "./browserUrl";
import { openWebTab } from "./browserTabs";
import { wantsBackgroundTab } from "./clickIntent";
import { prefetchStreamInfo } from "./streamResolution";
import { tabsEnabled } from "./tabs/tabsEnabled";
import { channelRoute, parseYoutubeUrl, routeForYoutubeUrl } from "./youtubeUrl";
import { useTabsStore } from "../store/useTabsStore";
import type { RichTarget } from "../types/video";

/**
 * Opens a link in a background tab, as a browser does on middle-click: YouTube
 * videos, playlists and channels in a Flow tab, and any other web page in a web
 * tab. False, and nothing opened, while tabs are off or the link isn't a web page.
 */
export function openUrlInBackgroundTab(url: string): boolean {
  if (!tabsEnabled() || !isWebUrl(url)) return false;
  const tabs = useTabsStore.getState();
  const parsed = parseYoutubeUrl(url);
  if (parsed) {
    const route = routeForYoutubeUrl(parsed);
    if (route) {
      if (parsed.kind === "video" || parsed.kind === "short") prefetchStreamInfo(parsed.videoId);
      tabs.openTab(route);
      return true;
    }
    if (parsed.kind === "resolveChannel") {
      resolveChannelId(parsed.url)
        .then((channelId) => useTabsStore.getState().openTab(channelRoute(channelId, parsed.music)))
        .catch(() => openWebTab(url, false));
      return true;
    }
  }
  openWebTab(url, false);
  return true;
}

/**
 * Middle-click (or Ctrl-click) on a link button opens it in a background tab.
 * Spread onto the button; its own onClick still handles a plain click.
 */
export function linkBackgroundTabProps(url: string) {
  return {
    onMouseDown: (event: ReactMouseEvent) => {
      // The middle button would otherwise start the webview's autoscroll.
      if (event.button === 1 && tabsEnabled()) event.preventDefault();
    },
    onAuxClick: (event: ReactMouseEvent) => {
      if (event.button !== 1 || !openUrlInBackgroundTab(url)) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

/** For a link button's click handler: true when a Ctrl-click opened it in a background tab. */
export function openedLinkInBackgroundTab(event: ReactMouseEvent, url: string): boolean {
  if (!wantsBackgroundTab(event) || !openUrlInBackgroundTab(url)) return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

/**
 * Opens a description or comment link in a background tab. Timestamps have no
 * page of their own, so they answer false and a middle-click on one does nothing.
 */
export function openRichTargetInBackground(target: RichTarget): boolean {
  if (!tabsEnabled()) return false;
  const open = (route: string) => {
    useTabsStore.getState().openTab(route);
    return true;
  };
  switch (target.kind) {
    case "timestamp":
      return false;
    case "video":
      prefetchStreamInfo(target.videoId);
      return open(`/watch/${target.videoId}`);
    case "playlist":
      return open(`/playlist/${target.playlistId}`);
    case "channel":
      return open(`/channel/${target.channelId}`);
    case "hashtag":
      return open(`/search?q=${encodeURIComponent(target.tag)}`);
    case "url":
      return openUrlInBackgroundTab(target.url);
  }
}
