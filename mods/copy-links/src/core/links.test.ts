import { describe, expect, it } from "vitest";
import { copyLinksMenuState, linksAsPlainText } from "./links.ts";

describe("linksAsPlainText", () => {
  it("copies URLs in Firefox's selected-tab order with one URL per line", () => {
    expect(
      linksAsPlainText([
        { url: "https://example.com/one", title: "One" },
        { url: "https://example.com/two", title: "Two" },
      ]),
    ).toBe("https://example.com/one\nhttps://example.com/two");
  });

  it("does not add titles or a trailing newline", () => {
    expect(linksAsPlainText([{ url: "https://example.com", title: "Example" }])).toBe(
      "https://example.com",
    );
    expect(linksAsPlainText([])).toBe("");
  });
});

describe("copyLinksMenuState", () => {
  it("uses Firefox's singular fallback and disables an empty action", () => {
    expect(copyLinksMenuState(0)).toEqual({ disabled: true, labelCount: 1 });
  });

  it("uses the shareable link count for an enabled action", () => {
    expect(copyLinksMenuState(1)).toEqual({ disabled: false, labelCount: 1 });
    expect(copyLinksMenuState(3)).toEqual({ disabled: false, labelCount: 3 });
  });
});
