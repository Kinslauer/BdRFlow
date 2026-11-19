import { describe, expect, it } from "vitest";
import { addressToUrl, browsePath, displayHost, isBrowsePath, urlFromBrowsePath } from "./browserUrl";

describe("addressToUrl", () => {
  it("opens full web addresses as typed", () => {
    expect(addressToUrl("https://example.com/a?b=c")).toBe("https://example.com/a?b=c");
    expect(addressToUrl("  http://example.com ")).toBe("http://example.com/");
  });

  it("adds https to things that look like a host", () => {
    expect(addressToUrl("example.com")).toBe("https://example.com/");
    expect(addressToUrl("www.wikipedia.org/wiki/Cat")).toBe("https://www.wikipedia.org/wiki/Cat");
    expect(addressToUrl("sub.domain.co.uk:8443/x")).toBe("https://sub.domain.co.uk:8443/x");
  });

  it("uses http for local addresses", () => {
    expect(addressToUrl("localhost:3000")).toBe("http://localhost:3000/");
    expect(addressToUrl("127.0.0.1:8080/api")).toBe("http://127.0.0.1:8080/api");
  });

  it("searches for anything else", () => {
    expect(addressToUrl("cute cats")).toBe("https://duckduckgo.com/?q=cute%20cats");
    expect(addressToUrl("tauri")).toBe("https://duckduckgo.com/?q=tauri");
    expect(addressToUrl("what is 2.5 + 1")).toBe("https://duckduckgo.com/?q=what%20is%202.5%20%2B%201");
  });

  it("never opens non-web schemes", () => {
    expect(addressToUrl("javascript:alert(1)")).toBeNull();
    expect(addressToUrl("file:///etc/passwd")).toBeNull();
    expect(addressToUrl("ftp://example.com")).toBeNull();
    expect(addressToUrl("tauri://localhost")).toBeNull();
    expect(addressToUrl("")).toBeNull();
    expect(addressToUrl("   ")).toBeNull();
  });
});

describe("browse paths", () => {
  it("round-trips a page through the tab path", () => {
    const url = "https://example.com/search?q=a&b=c#top";
    const path = browsePath(url);
    expect(isBrowsePath(path)).toBe(true);
    expect(urlFromBrowsePath(path)).toBe(url);
  });

  it("treats a bare /browse as the start page", () => {
    expect(browsePath()).toBe("/browse");
    expect(isBrowsePath("/browse")).toBe(true);
    expect(urlFromBrowsePath("/browse")).toBeNull();
  });

  it("ignores other routes and unsafe urls", () => {
    expect(isBrowsePath("/browser")).toBe(false);
    expect(urlFromBrowsePath("/search?url=https://example.com")).toBeNull();
    expect(urlFromBrowsePath(`/browse?url=${encodeURIComponent("javascript:alert(1)")}`)).toBeNull();
  });

  it("shows a short host", () => {
    expect(displayHost("https://www.example.com/a")).toBe("example.com");
    expect(displayHost("http://localhost:3000/")).toBe("localhost:3000");
  });
});
