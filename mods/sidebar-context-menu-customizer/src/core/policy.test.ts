import { describe, expect, it } from "vitest";
import {
  actionPreferenceKey,
  coalesceCustomizationActions,
  copyLinksPromotionState,
  decodeStoredIds,
  encodeStoredIds,
  filterCustomizationActions,
  groupCustomizationActions,
  PROMOTION_COPY_LINKS,
  resolveExcludedFromRootIds,
  resolveMoreActions,
  separatorsToHide,
  updateActionSelection,
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

describe("stored menu item preferences", () => {
  it("reads unique non-empty ids from JSON", () => {
    expect(
      decodeStoredIds(
        '["context_reloadTab", "", " context_closeTab ", "context_reloadTab"]',
      ),
    ).toEqual(new Set(["context_reloadTab", "context_closeTab"]));
  });

  it("falls back to no stored items for malformed or wrongly shaped values", () => {
    expect(decodeStoredIds("not json")).toEqual(new Set());
    expect(decodeStoredIds('{"context_reloadTab": true}')).toEqual(new Set());
  });

  it("writes ids deterministically", () => {
    expect(encodeStoredIds(new Set(["context_reloadTab", "context_closeTab"]))).toBe(
      '["context_closeTab","context_reloadTab"]',
    );
  });

  it("starts with every discovered action excluded from the root when unsaved", () => {
    expect(
      resolveExcludedFromRootIds(null, ["context_reloadTab", "context_closeTab"]),
    ).toEqual({
      ids: new Set(["context_reloadTab", "context_closeTab"]),
      initialized: true,
    });
  });

  it("keeps an explicitly saved empty choice instead of applying the default again", () => {
    expect(resolveExcludedFromRootIds(new Set(), ["context_reloadTab"])).toEqual({
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

  it("filters action labels and stable keys without case sensitivity", () => {
    const actions = [
      { key: "context_reloadTab", label: "Reload Tab", selected: true },
      { key: "context_bookmarkTab", label: "Bookmark Tab", selected: false },
    ];

    expect(
      filterCustomizationActions(actions, "RELOAD").map(action => action.key),
    ).toEqual(["context_reloadTab"]);
    expect(
      filterCustomizationActions(actions, "bookmarktab").map(action => action.key),
    ).toEqual(["context_bookmarkTab"]);
    expect(filterCustomizationActions(actions, "   ")).toEqual(actions);
  });

  it("moves every context variant between selected and not selected", () => {
    const keys = ["context_ungroupTab", "context_ungroupSplitView"];

    expect(updateActionSelection(new Set(keys), keys, true)).toEqual(new Set());
    expect(updateActionSelection(new Set(["untouched"]), keys, false)).toEqual(
      new Set(["untouched", ...keys]),
    );
  });

  it("returns a new preference set instead of mutating the caller's snapshot", () => {
    const excludedFromRoot = new Set(["context_reloadTab"]);

    updateActionSelection(excludedFromRoot, ["context_reloadTab"], true);

    expect(excludedFromRoot).toEqual(new Set(["context_reloadTab"]));
  });
});

describe("More actions organization", () => {
  it("returns only root-excluded actions in stable alphabetical order", () => {
    const actions = [
      { key: "selected", label: "Close Tab", browserVisible: true },
      { key: "share-z", label: "Share", browserVisible: false },
      { key: "tab-10", label: "Tab 10", browserVisible: true },
      { key: "tab-2", label: "Tab 2", browserVisible: true },
      { key: "share-a", label: "share", browserVisible: true },
    ];

    const result = resolveMoreActions(
      actions,
      new Set(["share-z", "tab-10", "tab-2", "share-a", "not-live"]),
    );

    expect(result.actions.map(action => action.key)).toEqual([
      "share-a",
      "share-z",
      "tab-2",
      "tab-10",
    ]);
    expect(result.visibleActions.map(action => action.key)).toEqual([
      "share-a",
      "tab-2",
      "tab-10",
    ]);
  });

  it("retains invisible context variants even when none can currently be shown", () => {
    const actions = [
      { key: "context_shareTab", label: "Share", browserVisible: false },
      { key: "context_shareSelectedTabs", label: "Share", browserVisible: false },
    ];

    const result = resolveMoreActions(
      actions,
      new Set(["context_shareTab", "context_shareSelectedTabs"]),
    );

    expect(result.actions.map(action => action.key)).toEqual([
      "context_shareSelectedTabs",
      "context_shareTab",
    ]);
    expect(result.visibleActions).toEqual([]);
  });
});
