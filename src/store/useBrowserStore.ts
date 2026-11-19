import { create } from "zustand";

/*
  Live state of the web pages behind browser tabs, keyed by tab id. Not
  persisted: the tab's address lives in its tab path (`/browse?url=…`), and the
  page is loaded again from there after a restart.
*/

export interface BrowserPageState {
  /** The address the tab's webview is at, or was last told to open. */
  url: string | null;
  loading: boolean;
  /**
   * True from the moment the app tells the webview to open an address until
   * that load finishes. Load events in that window belong to the app's own
   * navigation (and its redirects); outside it they are the user clicking
   * around in the page.
   */
  pending: boolean;
}

interface BrowserState {
  pages: Record<string, BrowserPageState>;
  update: (id: string, patch: Partial<BrowserPageState>) => void;
  remove: (id: string) => void;
}

const EMPTY: BrowserPageState = { url: null, loading: false, pending: false };

export const useBrowserStore = create<BrowserState>()((set) => ({
  pages: {},
  update: (id, patch) =>
    set((state) => ({ pages: { ...state.pages, [id]: { ...(state.pages[id] ?? EMPTY), ...patch } } })),
  remove: (id) =>
    set((state) => {
      if (!(id in state.pages)) return state;
      const pages = { ...state.pages };
      delete pages[id];
      return { pages };
    }),
}));

export function selectBrowserPage(id: string) {
  return (state: BrowserState): BrowserPageState => state.pages[id] ?? EMPTY;
}
