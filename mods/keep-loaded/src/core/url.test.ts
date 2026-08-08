import { describe, expect, it, vi } from "vitest";
import { isPlaceholderUrl, resolveUrl, shortUrl, urlFromTabState } from "./url.ts";

describe("shortUrl", () => {
  it("drops the parts nobody reads", () => {
    expect(shortUrl("https://www.example.test/one")).toBe("example.test/one");
    expect(shortUrl("http://example.test/one")).toBe("example.test/one");
  });

  it("leaves a url it cannot improve alone, including about: pages", () => {
    expect(shortUrl("about:tabcrashed")).toBe("about:tabcrashed");
    expect(shortUrl("")).toBe("");
  });

  it("truncates to the length it was given, marking that it did", () => {
    expect(shortUrl("https://example.test/12345", 10)).toBe("example.t…");
    expect(shortUrl("https://example.test", 12)).toBe("example.test");
  });
});

describe("isPlaceholderUrl", () => {
  it("treats an empty url and about:blank as telling us nothing", () => {
    expect(isPlaceholderUrl("")).toBe(true);
    expect(isPlaceholderUrl("about:blank")).toBe(true);
  });

  it("treats a real url as informative, including other about: pages", () => {
    expect(isPlaceholderUrl("https://mail.google.com/")).toBe(false);
    expect(isPlaceholderUrl("about:tabcrashed")).toBe(false);
  });
});

describe("resolveUrl", () => {
  it("keeps the live url and never asks the session for one", () => {
    const stored = vi.fn(() => "https://stale.test/");
    expect(resolveUrl("https://mail.google.com/", stored)).toBe(
      "https://mail.google.com/",
    );
    expect(stored).not.toHaveBeenCalled();
  });

  it("falls back to the session when the browser is parked at about:blank", () => {
    expect(resolveUrl("about:blank", () => "https://mail.google.com/")).toBe(
      "https://mail.google.com/",
    );
  });

  it("keeps the placeholder when the session has nothing better", () => {
    expect(resolveUrl("about:blank", () => "")).toBe("about:blank");
    expect(resolveUrl("about:blank", () => "about:blank")).toBe("about:blank");
  });

  it("survives a session lookup that fails", () => {
    expect(
      resolveUrl("about:blank", () => {
        throw new Error("Need a valid tab");
      }),
    ).toBe("about:blank");
  });
});

const tabState = (state: unknown) => JSON.stringify(state);

describe("urlFromTabState", () => {
  it("reads the entry the recorded index points at", () => {
    const json = tabState({
      index: 1,
      entries: [{ url: "https://mail.google.com/" }, { url: "https://later.test/" }],
    });
    expect(urlFromTabState(json)).toBe("https://mail.google.com/");
  });

  it("falls back to the newest entry when no index is recorded", () => {
    const json = tabState({
      entries: [{ url: "https://old.test/" }, { url: "https://newest.test/" }],
    });
    expect(urlFromTabState(json)).toBe("https://newest.test/");
  });

  it("clamps an index that points outside the entries it was given", () => {
    const json = tabState({ index: 9, entries: [{ url: "https://only.test/" }] });
    expect(urlFromTabState(json)).toBe("https://only.test/");
    expect(
      urlFromTabState(tabState({ index: 0, entries: [{ url: "https://a.test/" }] })),
    ).toBe("https://a.test/");
  });

  it("returns nothing rather than throwing on state it cannot read", () => {
    expect(urlFromTabState("")).toBe("");
    expect(urlFromTabState("not json")).toBe("");
    expect(urlFromTabState(tabState(null))).toBe("");
    expect(urlFromTabState(tabState({}))).toBe("");
    expect(urlFromTabState(tabState({ entries: [] }))).toBe("");
    expect(urlFromTabState(tabState({ entries: [{}] }))).toBe("");
    expect(urlFromTabState(tabState({ entries: "nope" }))).toBe("");
  });
});
