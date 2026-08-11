import { describe, expect, it, vi } from "vitest";
import { actionPreferenceKey } from "./policy.ts";
import {
  createPresentationSnapshot,
  type PresentationFact,
  type PresentationSourceFact,
  planMenuPresentation,
  sortPresentationActions,
} from "./presentation.ts";

const source = (
  overrides: Partial<PresentationSourceFact> &
    Pick<PresentationSourceFact, "key" | "kind" | "originalIndex">,
): PresentationSourceFact => ({
  browserVisible: true,
  controlRole: "ordinary",
  identity: null,
  label: "",
  ...overrides,
});

const action = (
  key: string,
  label: string,
  originalIndex: number,
  overrides: Partial<PresentationFact> = {},
): PresentationFact => ({
  browserVisible: true,
  controlRole: "ordinary",
  key,
  kind: "action",
  label,
  originalIndex,
  selected: false,
  ...overrides,
});

describe("presentation snapshots", () => {
  it("derives one key per visited action and carries plain facts forward", () => {
    const deriveKey = vi.fn(actionPreferenceKey);
    const inputs = [
      source({
        key: "fallback:0",
        kind: "action",
        label: "Reload Tab",
        originalIndex: 0,
        identity: {
          id: "context_reloadTab",
          l10nId: "reload-tab",
          command: null,
          className: null,
        },
      }),
      source({
        key: "fallback:1",
        kind: "action",
        label: "Close Tab",
        originalIndex: 1,
        identity: {
          id: "",
          l10nId: null,
          command: "cmd_closeTab",
          className: null,
        },
      }),
      source({
        key: "fallback:2",
        kind: "action",
        label: "Anonymous command",
        originalIndex: 2,
        identity: {
          id: "",
          l10nId: null,
          command: null,
          className: "extension-item",
        },
      }),
      source({ key: "separator:3", kind: "separator", originalIndex: 3 }),
      source({ key: "customizer", kind: "control", originalIndex: 4 }),
    ];

    const snapshot = createPresentationSnapshot(inputs, null, deriveKey);

    expect(deriveKey).toHaveBeenCalledTimes(3);
    expect(snapshot.excludedFromRootIds).toEqual(
      new Set(["context_reloadTab", "command:cmd_closeTab"]),
    );
    expect(snapshot.initialized).toBe(true);
    expect(snapshot.facts).toEqual([
      expect.objectContaining({
        key: "context_reloadTab",
        kind: "action",
        originalIndex: 0,
        selected: false,
      }),
      expect.objectContaining({
        key: "command:cmd_closeTab",
        kind: "action",
        originalIndex: 1,
        selected: false,
      }),
      expect.objectContaining({
        key: "fallback:2",
        kind: "control",
        originalIndex: 2,
        selected: true,
      }),
      expect.objectContaining({
        key: "separator:3",
        kind: "separator",
        originalIndex: 3,
        selected: true,
      }),
      expect.objectContaining({
        key: "customizer",
        kind: "control",
        originalIndex: 4,
        selected: true,
      }),
    ]);
    expect(structuredClone(snapshot)).toEqual(snapshot);
  });

  it("uses stored exclusions without changing browser-hidden or structural facts", () => {
    const snapshot = createPresentationSnapshot(
      [
        source({
          browserVisible: false,
          key: "fallback:0",
          kind: "action",
          label: "Share",
          originalIndex: 0,
          identity: {
            id: "context_shareTab",
            l10nId: null,
            command: null,
            className: null,
          },
        }),
        source({ key: "separator:1", kind: "separator", originalIndex: 1 }),
      ],
      new Set(["context_shareTab"]),
    );

    expect(snapshot.initialized).toBe(false);
    expect(snapshot.facts).toEqual([
      expect.objectContaining({
        browserVisible: false,
        key: "context_shareTab",
        kind: "action",
        selected: false,
      }),
      expect.objectContaining({ kind: "separator", selected: true }),
    ]);
  });
});

describe("menu presentation planning", () => {
  it("orders excluded actions directly and plans separators around own controls", () => {
    const facts: PresentationFact[] = [
      action("selected", "Close Tab", 0, { selected: true }),
      action("hidden", "Share", 1, { browserVisible: false }),
      action("tab-10", "Tab 10", 2),
      action("tab-2", "tab 2", 3),
      action("separator:4", "", 4, { kind: "separator", selected: true }),
      action("more-actions", "More actions", 5, {
        browserVisible: false,
        controlRole: "more-actions",
        kind: "control",
        selected: true,
      }),
      action("customizer", "Customize tab menu", 6, {
        kind: "control",
        selected: true,
      }),
      action("separator:7", "", 7, { kind: "separator", selected: true }),
    ];

    const plan = planMenuPresentation(facts);

    expect(plan.moreActions.map(item => item.key)).toEqual(["hidden", "tab-2", "tab-10"]);
    expect(plan.visibleMoreActions.map(item => item.key)).toEqual(["tab-2", "tab-10"]);
    expect(plan.moreActionsVisible).toBe(true);
    expect(plan.hiddenSeparatorIndexes).toEqual(new Set([7]));
  });

  it("keeps More actions hidden when every excluded variant is browser-hidden", () => {
    const plan = planMenuPresentation([
      action("selected", "Close", 0, { selected: true }),
      action("hidden", "Share", 1, { browserVisible: false }),
      action("separator:2", "", 2, { kind: "separator", selected: true }),
      action("more-actions", "More actions", 3, {
        browserVisible: false,
        controlRole: "more-actions",
        kind: "control",
        selected: true,
      }),
      action("customizer", "Customize", 4, { kind: "control", selected: true }),
    ]);

    expect(plan.moreActions.map(item => item.key)).toEqual(["hidden"]);
    expect(plan.visibleMoreActions).toEqual([]);
    expect(plan.moreActionsVisible).toBe(false);
    expect(plan.hiddenSeparatorIndexes).toEqual(new Set());
  });

  it("uses one natural, case-insensitive comparator with deterministic key ties", () => {
    const sorted = sortPresentationActions([
      action("tab-10", "Tab 10", 40),
      action("share-z", "Share", 41),
      action("share-a", "share", 42),
      action("share-A", "SHARE", 43),
      action("tab-2", "tab 2", 44),
    ]);

    expect(sorted.map(item => item.key)).toEqual([
      "share-A",
      "share-a",
      "share-z",
      "tab-2",
      "tab-10",
    ]);
    expect(sorted.map(item => item.originalIndex)).toEqual([43, 42, 41, 44, 40]);
  });

  it("sorts a late excluded batch without rebuilding an all-key membership set", () => {
    const late = [
      action("late-20", "Extension 20", 104),
      action("late-3", "Extension 3", 101),
      action("late-hidden", "Extension 1", 109, { browserVisible: false }),
    ];

    const plan = planMenuPresentation(late);

    expect(plan.moreActions.map(item => item.key)).toEqual([
      "late-hidden",
      "late-3",
      "late-20",
    ]);
    expect(plan.visibleMoreActions.map(item => item.key)).toEqual(["late-3", "late-20"]);
  });
});
