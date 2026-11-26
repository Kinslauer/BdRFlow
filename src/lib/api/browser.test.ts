import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const pending = new Map<string, () => void>();

vi.mock("./errors", () => ({
  invokeBackend: vi.fn(
    (command: string) =>
      new Promise<void>((resolve) => {
        calls.push(`start ${command}`);
        pending.set(command, () => {
          calls.push(`end ${command}`);
          resolve();
        });
      }),
  ),
}));

import { hideBrowserView, inOrder, showBrowserView } from "./browser";

describe("browser view calls", () => {
  it("run one at a time, so a slow show can't land after a later hide", async () => {
    const shown = showBrowserView("tab-1", { x: 0, y: 0, width: 10, height: 10 }, "https://a.example/");
    const hidden = hideBrowserView("tab-1");
    await Promise.resolve();
    await Promise.resolve();
    // The hide waits for the show, however long opening the page takes.
    expect(calls).toEqual(["start browser_show"]);

    pending.get("browser_show")!();
    await shown;
    await vi.waitFor(() => expect(pending.has("browser_hide")).toBe(true));
    pending.get("browser_hide")!();
    await hidden;
    expect(calls).toEqual(["start browser_show", "end browser_show", "start browser_hide", "end browser_hide"]);
  });

  it("keep going after a call fails", async () => {
    await expect(inOrder(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(inOrder(() => Promise.resolve(42))).resolves.toBe(42);
  });
});
