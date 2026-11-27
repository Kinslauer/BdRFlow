import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAppSettingsStore } from "../store/useAppSettingsStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { openPopoutPlayer, requestPopoutReturn } from "./pipHandoff";
import { watchVideoIdFromPath } from "./watchRouteSync";
import { SETTINGS } from "./settings/schema";

/** One handoff at a time: a second call while the pop-out warms up would open it twice. */
let opening = false;
/**
 * The video a web tab sent to the pop-out. Coming back to its watch page brings
 * it home again; a pop-out the user opened themselves stays where they put it.
 */
let autoPoppedVideoId: string | null = null;

/** Whether a web tab coming up should move the current video to the pop-out player. */
export function shouldPopOutForWebTab(): boolean {
  const player = usePlayerStore.getState();
  if (!player.currentVideo || player.videoPlayerMode === "window") return false;
  const values = useAppSettingsStore.getState().values;
  // The same setting that makes the player's mini-player button open the pop-out.
  return values[SETTINGS.PIP_SEPARATE_WINDOW] !== "false";
}

/**
 * When a web tab comes on screen with a video loaded, the video moves to the
 * pop-out player window (falling back to the in-app mini player if that window
 * can't open). The in-app mini player would otherwise sit over the page's
 * bottom corner, and the page is shortened to stay clear of it.
 */
export function usePopoutForWebTab(tabId: string, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    // After the route change has settled: leaving the watch page puts the
    // video in the mini player (or ends it) in an effect of its own, and the
    // decision here reads the store as that leaves it.
    const timer = window.setTimeout(() => {
      if (opening || !shouldPopOutForWebTab()) return;
      opening = true;
      const videoId = usePlayerStore.getState().currentVideo?.id ?? null;
      void openPopoutPlayer()
        .then((opened) => {
          const player = usePlayerStore.getState();
          if (opened && player.videoPlayerMode === "window" && player.currentVideo?.id === videoId) {
            autoPoppedVideoId = videoId;
          }
          if (!opened && player.currentVideo && player.videoPlayerMode === "watch") {
            player.enterVideoPip("auto");
          }
        })
        .finally(() => {
          opening = false;
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [tabId, enabled]);
}

/**
 * Brings a video a web tab sent to the pop-out back into the watch page when
 * the user returns to that video's watch page.
 */
export function useReturnWebTabPopout(): void {
  const { pathname } = useLocation();

  useEffect(
    () =>
      usePlayerStore.subscribe((state, previous) => {
        // Once the pop-out is gone, or plays something else, it isn't ours to call back.
        if (state.videoPlayerMode !== "window" || state.currentVideo?.id !== autoPoppedVideoId) {
          if (previous.videoPlayerMode === "window") autoPoppedVideoId = null;
        }
      }),
    [],
  );

  useEffect(() => {
    if (!autoPoppedVideoId) return;
    const player = usePlayerStore.getState();
    if (player.videoPlayerMode !== "window" || player.currentVideo?.id !== autoPoppedVideoId) return;
    if (watchVideoIdFromPath(pathname) !== autoPoppedVideoId) return;
    autoPoppedVideoId = null;
    void requestPopoutReturn();
  }, [pathname]);
}
