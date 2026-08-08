import { describe, expect, it } from "vitest";
import {
  actionPreferenceKey,
  decodeHiddenIds,
  encodeHiddenIds,
  resolveHiddenIds,
  separatorsToHide,
} from "./policy.ts";

describe("actionPreferenceKey", () => {
  it("uses a browser id when one exists", () => {
    expect(
      actionPreferenceKey({
        id: "context_reloadTab",
        l10nId: "reload-tab",
        command: null,
        className: null,
      }),
    ).toBe("context_reloadTab");
  });

  it("uses localization metadata for an anonymous browser action", () => {
    expect(
      actionPreferenceKey({
        id: "",
        l10nId: "tab-context-share-url",
        command: null,
        className: "share-tab-url-item",
      }),
    ).toBe("l10n:tab-context-share-url");
  });

  it("rejects an anonymous action with no stable metadata", () => {
    expect(
      actionPreferenceKey({ id: "", l10nId: null, command: null, className: null }),
    ).toBeNull();
  });
});

describe("hidden menu item preferences", () => {
  it("reads unique non-empty ids from JSON", () => {
    expect(
      decodeHiddenIds(
        '["context_reloadTab", "", " context_closeTab ", "context_reloadTab"]',
      ),
    ).toEqual(new Set(["context_reloadTab", "context_closeTab"]));
  });

  it("falls back to no hidden items for malformed or wrongly shaped values", () => {
    expect(decodeHiddenIds("not json")).toEqual(new Set());
    expect(decodeHiddenIds('{"context_reloadTab": true}')).toEqual(new Set());
  });

  it("writes ids deterministically", () => {
    expect(encodeHiddenIds(new Set(["context_reloadTab", "context_closeTab"]))).toBe(
      '["context_closeTab","context_reloadTab"]',
    );
  });

  it("starts with every discovered action hidden when no choice is saved", () => {
    expect(resolveHiddenIds(null, ["context_reloadTab", "context_closeTab"])).toEqual({
      ids: new Set(["context_reloadTab", "context_closeTab"]),
      initialized: true,
    });
  });

  it("keeps an explicitly saved empty choice instead of applying the default again", () => {
    expect(resolveHiddenIds(new Set(), ["context_reloadTab"])).toEqual({
      ids: new Set(),
      initialized: false,
    });
  });
});

describe("separator cleanup", () => {
  it("hides leading, trailing, and repeated separators", () => {
    expect(
      separatorsToHide([
        { kind: "separator", visible: true },
        { kind: "item", visible: true },
        { kind: "separator", visible: true },
        { kind: "separator", visible: true },
        { kind: "item", visible: true },
        { kind: "separator", visible: true },
      ]),
    ).toEqual(new Set([0, 3, 5]));
  });

  it("collapses separators around items hidden by Zen or the user", () => {
    expect(
      separatorsToHide([
        { kind: "item", visible: true },
        { kind: "separator", visible: true },
        { kind: "item", visible: false },
        { kind: "separator", visible: true },
        { kind: "item", visible: true },
      ]),
    ).toEqual(new Set([3]));
  });

  it("ignores separators that Zen already hid", () => {
    expect(
      separatorsToHide([
        { kind: "item", visible: true },
        { kind: "separator", visible: false },
        { kind: "item", visible: true },
      ]),
    ).toEqual(new Set());
  });
});
