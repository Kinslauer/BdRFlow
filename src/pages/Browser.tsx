import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ExternalLink, Globe, Loader2, Lock, RotateCw, X } from "lucide-react";
import { IconButton } from "../components/ui/IconButton";
import { getString } from "../lib/i18n/index";
import { addressToUrl, browsePath, urlFromBrowsePath } from "../lib/browserUrl";
import { reloadBrowserView, stopBrowserView } from "../lib/api/browser";
import { FOCUS_ADDRESS_BAR_EVENT, tabPath } from "../lib/browserTabs";
import { openExternal } from "../lib/openExternal";
import { useBrowserView } from "../lib/useBrowserView";
import { useBrowserStore, selectBrowserPage } from "../store/useBrowserStore";
import { activeTab, useTabsStore } from "../store/useTabsStore";
import { useMusicPlayerStore } from "../store/useMusicPlayerStore";
import { usePlayerStore } from "../store/usePlayerStore";
import { IS_MAIN_WINDOW } from "../lib/appWindow";


/*
  The page is a native webview, so it covers anything drawn over its area. The
  floating music dock and video mini player live at the bottom of the window;
  the page stops short of them instead of hiding them.
*/
const MUSIC_DOCK_CLEARANCE = 104; // h-16 + bottom-6 + a gap
const MINI_PLAYER_CLEARANCE = 280; // 420px wide at 16:9, bottom-6, a gap

export default function Browser() {
  const location = useLocation();
  const navigate = useNavigate();
  const tabId = useTabsStore((s) => s.activeId);
  const activePath = useTabsStore((s) => tabPath(activeTab(s)));
  const currentPath = location.pathname + location.search;
  const url = urlFromBrowsePath(currentPath);
  const page = useBrowserStore(selectBrowserPage(tabId));

  const viewRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // A tab switch, or a page navigating, changes the tab store a moment before
  // the router follows. Until both agree, the route still shows the previous
  // tab or address, so the page is left as it is.
  const inSync = activePath === currentPath;
  // Web pages are child views of the main window; another window can't show them.
  const { error } = useBrowserView(tabId, url, viewRef, inSync && IS_MAIN_WINDOW);

  const [address, setAddress] = useState(url ?? "");
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);

  // Follow the page's address unless the user is typing a new one.
  useEffect(() => {
    if (!editing) setAddress(url ?? "");
  }, [url, editing]);

  // Start page and Ctrl+L focus the address bar.
  useEffect(() => {
    if (!url) inputRef.current?.focus();
  }, [tabId, url]);
  useEffect(() => {
    const focus = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener(FOCUS_ADDRESS_BAR_EVENT, focus);
    return () => window.removeEventListener(FOCUS_ADDRESS_BAR_EVENT, focus);
  }, []);

  const musicDock = useMusicPlayerStore((s) => s.currentTrack !== null && s.viewState === "dock");
  const miniPlayer = usePlayerStore((s) => s.currentVideo !== null && s.videoPlayerMode === "pip");
  const bottomClearance = miniPlayer ? MINI_PLAYER_CLEARANCE : musicDock ? MUSIC_DOCK_CLEARANCE : 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = addressToUrl(address);
    if (!next) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setEditing(false);
    inputRef.current?.blur();
    if (next === url) void reloadBrowserView(tabId).catch(() => {});
    else navigate(browsePath(next));
  };

  const secure = url?.startsWith("https://") ?? false;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 px-3 pb-2">
        {url && (
          <IconButton
            size="sm"
            title={getString(page.loading ? "browser_stop" : "browser_reload")}
            aria-label={getString(page.loading ? "browser_stop" : "browser_reload")}
            onClick={() => void (page.loading ? stopBrowserView(tabId) : reloadBrowserView(tabId)).catch(() => {})}
            className="text-chrome-zinc-300 hover:text-chrome-zinc-100"
          >
            {page.loading ? <X /> : <RotateCw />}
          </IconButton>
        )}
        <form
          onSubmit={submit}
          className={`flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border bg-chrome-searchbar px-3.5 transition-colors focus-within:border-chrome-zinc-500 ${
            invalid ? "border-primary" : "border-chrome-zinc-800"
          }`}
        >
          {page.loading ? (
            <Loader2 size={14} className="shrink-0 animate-spin text-chrome-zinc-500" />
          ) : secure && !editing ? (
            <Lock size={14} className="shrink-0 text-chrome-zinc-500" />
          ) : (
            <Globe size={14} className="shrink-0 text-chrome-zinc-500" />
          )}
          <input
            ref={inputRef}
            type="text"
            value={address}
            placeholder={getString("browser_address_placeholder")}
            aria-label={getString("browser_address")}
            autoComplete="off"
            spellCheck={false}
            onFocus={(e) => {
              setEditing(true);
              e.currentTarget.select();
            }}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              setAddress(url ?? "");
              setInvalid(false);
              e.currentTarget.blur();
            }}
            onChange={(e) => {
              setAddress(e.target.value);
              setInvalid(false);
            }}
            className="h-9 min-w-0 flex-1 bg-transparent text-sm text-chrome-zinc-100 outline-none placeholder:text-chrome-zinc-500"
          />
        </form>
        {url && (
          <IconButton
            size="sm"
            title={getString("browser_open_external")}
            aria-label={getString("browser_open_external")}
            onClick={() => void openExternal(url)}
            className="text-chrome-zinc-300 hover:text-chrome-zinc-100"
          >
            <ExternalLink />
          </IconButton>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col" style={{ paddingBottom: bottomClearance }}>
        {/* The native page is laid over this box. It shows through only while
            the page is hidden: before the first load, or under an overlay. */}
        <div
          ref={viewRef}
          className="relative flex min-h-0 flex-1 items-center justify-center border-t border-chrome-zinc-800 bg-background"
        >
          {!IS_MAIN_WINDOW ? (
            <p className="max-w-sm px-6 text-center text-sm text-chrome-zinc-400">{getString("browser_main_window_only")}</p>
          ) : !url ? (
            <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
              <Globe size={32} className="text-chrome-zinc-500" />
              <p className="text-base font-semibold text-chrome-zinc-100">{getString("browser_start_title")}</p>
              <p className="text-sm text-chrome-zinc-400">{getString("browser_start_body")}</p>
            </div>
          ) : error ? (
            <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
              <p className="text-base font-semibold text-chrome-zinc-100">{getString("browser_error_title")}</p>
              <p className="text-sm text-chrome-zinc-400">{error}</p>
            </div>
          ) : (
            <Loader2 size={20} className="animate-spin text-chrome-zinc-600" />
          )}
        </div>
      </div>
    </div>
  );
}
