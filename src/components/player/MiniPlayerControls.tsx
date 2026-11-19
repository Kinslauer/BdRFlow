import { getString } from "../../lib/i18n/index";
import React, { useEffect, useRef } from "react";
import {
  FastForward,
  Pause,
  Play,
  Rewind,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { usePlayerStore } from "../../store/usePlayerStore";
import { Slider } from "../ui/Slider";
import { useWheelVolume } from "../../lib/useWheelVolume";
import { useVolumeLevel } from "../../lib/audio/volumeBoost";
import {
  PROGRESS_EVENTS,
  cssPercent,
  setStyleIfChanged,
  shouldAnimateProgress,
  snapToBarPixel,
  watchBarSteps,
} from "../../lib/playerProgress";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export interface MiniPlayerControlsProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  isPlaying: boolean;
  duration: number;
  seekIntervalSeconds: number;
  shouldShowControls: boolean;
  togglePlay: () => void;
  seekTo: (time: number) => void;
  showSkipControls: boolean;
  showNextPrevControls: boolean;
  muted: boolean;
  setMuted: React.Dispatch<React.SetStateAction<boolean>>;
}

export const MiniPlayerControls: React.FC<MiniPlayerControlsProps> = ({
  containerRef,
  isPlaying,
  duration,
  seekIntervalSeconds,
  shouldShowControls,
  togglePlay,
  seekTo,
  showSkipControls,
  showNextPrevControls,
  muted,
  setMuted,
}) => {
  const playNext = usePlayerStore((s) => s.playNext);
  const playPrevious = usePlayerStore((s) => s.playPrevious);
  const volume = usePlayerStore((s) => s.volume);

  // Same volume model as the full player's control, so both stay in step.
  const { level: volumeLevel, maxLevel, setLevel: setVolumeLevel } = useVolumeLevel();
  const changeVolume = (value: number) => {
    setVolumeLevel(value);
    setMuted(value === 0);
  };
  const volumeWheelRef = useWheelVolume({
    volume: volumeLevel,
    max: maxLevel,
    muted,
    onVolumeChange: changeVolume,
    onUnmute: () => setMuted(false),
  });

  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const scrubbingRef = useRef(false);

  // The bar fades out with the rest of the controls, so it is only drawn every frame while
  // they show. Hidden, it follows the media events and is current when it fades back in.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let video = container.querySelector("video");
    let steps = 0;
    const stopWatchingWidth = watchBarSteps(trackRef.current, (next) => (steps = next));
    const update = () => {
      if (!video?.isConnected) video = container.querySelector("video");
      if (!video) return;
      const dur = video.duration || duration || 0;
      const shown = snapToBarPixel(video.currentTime, dur, steps);
      setStyleIfChanged(fillRef.current, "width", cssPercent(dur > 0 ? clamp((shown / dur) * 100, 0, 100) : 0));
    };

    update();
    const source = video;
    for (const event of PROGRESS_EVENTS) source?.addEventListener(event, update);
    let raf: number | null = null;
    if (shouldAnimateProgress(isPlaying, shouldShowControls, false)) {
      const tick = () => {
        update();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      stopWatchingWidth();
      for (const event of PROGRESS_EVENTS) source?.removeEventListener(event, update);
    };
  }, [containerRef, duration, isPlaying, shouldShowControls]);

  const seekFromClientX = (clientX: number) => {
    const track = trackRef.current;
    if (!track || duration <= 0) return;
    const rect = track.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    seekTo(ratio * duration);
  };

  const skip = (delta: number) => {
    const video = containerRef.current?.querySelector("video");
    const base = video ? video.currentTime : 0;
    seekTo(base + delta);
  };

  const sideBtn =
    "grid h-8 w-8 shrink-0 place-items-center rounded-full text-chrome-white/90 transition-colors hover:bg-chrome-white/15";

  return (
    <div
      className={cx(
        "pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col gap-1 bg-gradient-to-t from-chrome-black/80 via-chrome-black/30 to-transparent px-3 pb-2.5 pt-10 transition-opacity duration-200",
        shouldShowControls ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="pointer-events-auto" data-drag-ignore="true" onClick={(event) => event.stopPropagation()}>
        {/* Progress bar */}
        <div
          ref={trackRef}
          className="group/mpbar relative flex h-4 cursor-pointer items-center"
          onPointerDown={(event) => {
            scrubbingRef.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            seekFromClientX(event.clientX);
          }}
          onPointerMove={(event) => {
            if (scrubbingRef.current) seekFromClientX(event.clientX);
          }}
          onPointerUp={(event) => {
            scrubbingRef.current = false;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
        >
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-chrome-white/25 transition-[height] duration-150 group-hover/mpbar:h-1.5">
            <div
              ref={fillRef}
              className="absolute inset-y-0 left-0 rounded-full bg-primary"
              style={{ width: "0%" }}
            />
          </div>
        </div>

        {/* Transport row */}
        <div className="mt-0.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          {/* Volume takes the left column so the transport stays centred and never overlaps it. */}
          <div
            ref={volumeWheelRef}
            className="group/mpvol flex min-w-0 items-center justify-self-start rounded-full hover:bg-chrome-black/30 hover:pr-2"
          >
            <button
              type="button"
              title={getString('music_mute')}
              aria-label={getString('music_mute')}
              onClick={() => setMuted((value) => !value)}
              className={sideBtn}
            >
              {muted || volume === 0 ? (
                <VolumeX size={16} />
              ) : volume < 0.55 ? (
                <Volume1 size={16} />
              ) : (
                <Volume2 size={16} />
              )}
            </button>
            <div className="w-0 min-w-0 overflow-hidden opacity-0 transition-all group-focus-within/mpvol:w-16 group-focus-within/mpvol:opacity-100 group-hover/mpvol:w-16 group-hover/mpvol:opacity-100">
              <Slider
                aria-label={getString('music_volume')}
                min={0}
                max={maxLevel}
                step={0.01}
                value={muted ? 0 : volumeLevel}
                onChange={changeVolume}
              />
            </div>
          </div>
          <div className="flex items-center justify-center gap-2">
            {showNextPrevControls && (
              <button type="button" title={getString('previous')} onClick={playPrevious} className={sideBtn}>
                <SkipBack size={16} fill="currentColor" />
              </button>
            )}
            {showSkipControls && (
              <button
                type="button"
                title={getString('player_mini_back_seconds', seekIntervalSeconds)}
                onClick={() => skip(-seekIntervalSeconds)}
                className={sideBtn}
              >
                <Rewind size={17} />
              </button>
            )}
            <button
              type="button"
              title={getString(isPlaying ? 'pause' : 'play')}
              onClick={togglePlay}
              className="grid h-11 w-11 place-items-center rounded-full bg-chrome-white/10 text-chrome-white transition-transform hover:bg-chrome-white/20 active:scale-95"
            >
              {isPlaying ? (
                <Pause size={22} fill="currentColor" />
              ) : (
                <Play size={22} fill="currentColor" className="ml-0.5" />
              )}
            </button>
            {showSkipControls && (
              <button
                type="button"
                title={getString('player_mini_forward_seconds', seekIntervalSeconds)}
                onClick={() => skip(seekIntervalSeconds)}
                className={sideBtn}
              >
                <FastForward size={17} />
              </button>
            )}
            {showNextPrevControls && (
              <button type="button" title={getString('next')} onClick={() => playNext()} className={sideBtn}>
                <SkipForward size={16} fill="currentColor" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MiniPlayerControls;
