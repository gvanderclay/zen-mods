import { describe, expect, it } from "vitest";
import {
  actionPreferenceKey,
  coalesceCustomizationActions,
  copyLinksPromotionState,
  decodeHiddenIds,
  encodeHiddenIds,
  groupCustomizationActions,
  PROMOTION_COPY_LINKS,
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

describe("submenu promotion", () => {
  it("keeps Copy Link out of the root until the user promotes it", () => {
    expect(copyLinksPromotionState(new Set(), 1)).toEqual({
      visible: false,
      disabled: false,
      labelCount: 1,
    });
  });

  it("mirrors Firefox's disabled state and plural count", () => {
    expect(copyLinksPromotionState(new Set([PROMOTION_COPY_LINKS]), 0)).toEqual({
      visible: true,
      disabled: true,
      labelCount: 1,
    });
    expect(copyLinksPromotionState(new Set([PROMOTION_COPY_LINKS]), 3)).toEqual({
      visible: true,
      disabled: false,
      labelCount: 3,
    });
  });
});

describe("customization action organization", () => {
  it("coalesces context-specific variants with the same displayed label", () => {
    const rows = coalesceCustomizationActions([
      {
        key: "context_ungroupSplitView",
        label: "Remove from Group",
        selected: false,
      },
      {
        key: "context_ungroupTab",
        label: "Remove from Group",
        selected: false,
      },
    ]);

    expect(rows).toEqual([
      {
        key: "context_ungroupSplitView",
        keys: ["context_ungroupSplitView", "context_ungroupTab"],
        label: "Remove from Group",
        selected: false,
        actions: [
          {
            key: "context_ungroupSplitView",
            label: "Remove from Group",
            selected: false,
          },
          {
            key: "context_ungroupTab",
            label: "Remove from Group",
            selected: false,
          },
        ],
      },
    ]);
  });

  it("treats a logical action as selected when any context variant is selected", () => {
    expect(
      coalesceCustomizationActions([
        { key: "single", label: "Share", selected: false },
        { key: "multiple", label: "share", selected: true },
      ])[0],
    ).toMatchObject({ keys: ["multiple", "single"], selected: true });
  });

  it("splits selected from unselected actions and alphabetizes each group", () => {
    const grouped = groupCustomizationActions([
      { key: "reload", label: "Reload Tab", selected: true },
      { key: "close", label: "close Tab", selected: false },
      { key: "ask", label: "Ask Chat", selected: true },
      { key: "bookmark", label: "Bookmark Tab", selected: false },
    ]);

    expect(grouped.selected.map(action => action.key)).toEqual(["ask", "reload"]);
    expect(grouped.unselected.map(action => action.key)).toEqual(["bookmark", "close"]);
  });

  it("uses the stable action key when two labels sort equally", () => {
    const grouped = groupCustomizationActions([
      { key: "second", label: "Share", selected: true },
      { key: "first", label: "share", selected: true },
    ]);

    expect(grouped.selected.map(action => action.key)).toEqual(["first", "second"]);
  });
});
