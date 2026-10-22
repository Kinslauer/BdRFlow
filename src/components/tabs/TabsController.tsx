import { useTabsController } from "../../lib/useTabsController";

/** Keeps the router and the browser-style tabs in step. Renders nothing. */
export function TabsController() {
  useTabsController();
  return null;
}
