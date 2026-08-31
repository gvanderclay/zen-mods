import { describe, expect, it } from "vitest";
import {
  decideWindowToggle,
  type WindowToggleSnapshot,
  type WindowToggleTab,
} from "./pop-out.ts";

const tab = (id: string, overrides: Partial<WindowToggleTab> = {}): WindowToggleTab => ({
  essential: false,
  grouped: false,
  id,
  split: false,
  ...overrides,
});

const snapshot = (
  overrides: Partial<WindowToggleSnapshot> = {},
): WindowToggleSnapshot => ({
  activeId: "b",
  currentSpaceTabIds: ["a", "b", "c", "d"],
  hasMultiSelection: false,
  isolatedWindowCount: 0,
  privateWindow: false,
  realTabIds: ["a", "b", "c", "d"],
  selectedIds: ["b"],
  sharedWindowAvailable: true,
  sourceUnsynced: false,
  tabs: [tab("a"), tab("b"), tab("c"), tab("d")],
  ...overrides,
});

describe("decideWindowToggle", () => {
  it("creates an isolated destination for the active tab when none exists", () => {
    expect(decideWindowToggle(snapshot())).toEqual({
      closeSourceWindow: false,
      createSourceTab: false,
      destination: "new-isolated",
      kind: "move",
      tabIds: ["b"],
    });
  });

  it("moves the complete ordered selection into the first existing isolated window", () => {
    expect(
      decideWindowToggle(
        snapshot({
          hasMultiSelection: true,
          isolatedWindowCount: 2,
          selectedIds: ["b", "a", "c"],
        }),
      ),
    ).toEqual({
      closeSourceWindow: false,
      createSourceTab: false,
      destination: "existing-isolated",
      kind: "move",
      tabIds: ["a", "b", "c"],
    });
  });

  it("creates a source tab when every current-space tab will move", () => {
    expect(
      decideWindowToggle(
        snapshot({
          hasMultiSelection: true,
          selectedIds: ["a", "b", "c", "d"],
        }),
      ),
    ).toEqual({
      closeSourceWindow: false,
      createSourceTab: true,
      destination: "new-isolated",
      kind: "move",
      tabIds: ["a", "b", "c", "d"],
    });
  });

  it("creates a source tab when a synced window would otherwise become empty", () => {
    expect(
      decideWindowToggle(
        snapshot({
          activeId: "b",
          currentSpaceTabIds: [],
          realTabIds: ["b"],
          selectedIds: ["b"],
          tabs: [tab("b")],
        }),
      ),
    ).toEqual({
      closeSourceWindow: false,
      createSourceTab: true,
      destination: "new-isolated",
      kind: "move",
      tabIds: ["b"],
    });
  });

  it("merges a selection into an existing shared window without closing the source", () => {
    expect(
      decideWindowToggle(
        snapshot({
          hasMultiSelection: true,
          selectedIds: ["b", "a"],
          sourceUnsynced: true,
        }),
      ),
    ).toEqual({
      closeSourceWindow: false,
      createSourceTab: false,
      destination: "existing-shared",
      kind: "move",
      tabIds: ["a", "b"],
    });
  });

  it("creates a shared destination and closes the source when every real tab merges", () => {
    expect(
      decideWindowToggle(
        snapshot({
          hasMultiSelection: true,
          selectedIds: ["d", "b", "a", "c"],
          sharedWindowAvailable: false,
          sourceUnsynced: true,
        }),
      ),
    ).toEqual({
      closeSourceWindow: true,
      createSourceTab: false,
      destination: "new-shared",
      kind: "move",
      tabIds: ["a", "b", "c", "d"],
    });
  });

  it("keeps an isolated source open with a new current-space tab when other tabs remain", () => {
    expect(
      decideWindowToggle(
        snapshot({
          currentSpaceTabIds: ["a", "b", "c"],
          hasMultiSelection: true,
          selectedIds: ["c", "a", "b"],
          sourceUnsynced: true,
        }),
      ),
    ).toEqual({
      closeSourceWindow: false,
      createSourceTab: true,
      destination: "existing-shared",
      kind: "move",
      tabIds: ["a", "b", "c"],
    });
  });

  it("blocks private windows before moving any tab", () => {
    expect(decideWindowToggle(snapshot({ privateWindow: true }))).toEqual({
      kind: "blocked",
      reason: "private-window",
    });
  });

  it.each([
    ["essential", { essential: true }],
    ["grouped", { grouped: true }],
    ["split", { split: true }],
  ] as const)("blocks a selection containing an %s tab", (reason, unsupported) => {
    expect(
      decideWindowToggle(
        snapshot({
          hasMultiSelection: true,
          selectedIds: ["a", "b"],
          tabs: [tab("a"), tab("b", unsupported)],
        }),
      ),
    ).toEqual({ kind: "blocked", reason });
  });
});
