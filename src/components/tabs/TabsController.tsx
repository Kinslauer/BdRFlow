import { useTabsController } from "../../lib/useTabsController";
import { useBrowserTabsController } from "../../lib/browserTabs";

/** Keeps the router, the browser-style tabs and web pages in step. Renders nothing. */
export function TabsController() {
  useTabsController();
  useBrowserTabsController();
  return null;
}
