import { wantsBackgroundTab } from "../../lib/clickIntent";
import { richSegments } from "../../lib/richText";
import type { RichTarget, RichText as RichTextValue } from "../../types/video";

export interface RichTextProps {
  value: RichTextValue;
  /** Called with the target of the link the user clicked. */
  onActivate: (target: RichTarget) => void;
  /**
   * Called on a middle-click or Ctrl-click: open the target in a background
   * tab, and answer whether it did. Without it those clicks act as plain ones.
   */
  onActivateInBackground?: (target: RichTarget) => boolean;
  /** The source to load a custom emoji's picture from. */
  imageSrc: (url: string) => string;
  className?: string;
}

/** Text with its links and custom emoji. Line breaks in the text are kept. */
export function RichText({ value, onActivate, onActivateInBackground, imageSrc, className }: RichTextProps) {
  return (
    <span dir="auto" className={`whitespace-pre-wrap break-words ${className ?? ""}`}>
      {richSegments(value).map((segment, index) => {
        if (segment.emoji) {
          return (
            <img
              key={index}
              src={imageSrc(segment.emoji.imageUrl)}
              alt={segment.emoji.label}
              title={segment.emoji.label}
              className="inline-block h-[1.2em] w-[1.2em] align-text-bottom"
            />
          );
        }
        if (segment.target) {
          const target = segment.target;
          return (
            <button
              key={index}
              type="button"
              onMouseDown={(event) => {
                // The middle button would otherwise start the webview's autoscroll.
                if (event.button === 1 && onActivateInBackground) event.preventDefault();
              }}
              onAuxClick={(event) => {
                if (event.button !== 1 || !onActivateInBackground?.(target)) return;
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                if (wantsBackgroundTab(event) && onActivateInBackground?.(target)) {
                  event.preventDefault();
                  return;
                }
                onActivate(target);
              }}
              className="inline cursor-pointer break-all text-start font-medium text-primary hover:underline"
            >
              {segment.text}
            </button>
          );
        }
        return <span key={index}>{segment.text}</span>;
      })}
    </span>
  );
}
