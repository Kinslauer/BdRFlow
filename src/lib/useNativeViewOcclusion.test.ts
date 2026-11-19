import { afterEach, describe, expect, it } from "vitest";
import { hasOverlay } from "./useNativeViewOcclusion";

function setBody(html: string) {
  document.body.innerHTML = html;
}

afterEach(() => setBody(""));

describe("hasOverlay", () => {
  it("is clear with only the app root", () => {
    setBody('<div id="root"><main><div class="fixed bottom-6">dock</div></main></div>');
    expect(hasOverlay(document)).toBe(false);
  });

  it("sees dialogs, menus and the search dropdown inside the app", () => {
    setBody('<div id="root"><div role="dialog"></div></div>');
    expect(hasOverlay(document)).toBe(true);
    setBody('<div id="root"><div aria-modal="true"></div></div>');
    expect(hasOverlay(document)).toBe(true);
    setBody('<div id="root"><div id="search-suggestions"></div></div>');
    expect(hasOverlay(document)).toBe(true);
    setBody('<div id="root"><div class="z-50 fixed inset-0 bg-black/60"></div></div>');
    expect(hasOverlay(document)).toBe(true);
  });

  it("sees menus portalled into the body", () => {
    setBody('<div id="root"></div><div class="z-[110]">menu</div>');
    expect(hasOverlay(document)).toBe(true);
  });

  it("ignores scripts and opted-out body children", () => {
    setBody('<div id="root"></div><script></script><div data-native-view-ignore></div>');
    expect(hasOverlay(document)).toBe(false);
  });
});
