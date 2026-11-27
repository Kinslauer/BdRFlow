import { usePipController } from "../../lib/usePipController";
import { useReturnWebTabPopout } from "../../lib/usePopoutForWebTab";

/** Headless: keeps the main window in step with the pop-out player window. */
export function PipWindowController() {
  usePipController();
  useReturnWebTabPopout();
  return null;
}
