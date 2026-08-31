import { describe, expect, it } from "vitest";
import {
  decideSpaceMove,
  type SpaceMoveSnapshot,
  type SpaceMoveTab,
} from "./space-move.ts";

const tab = (id: string, overrides: Partial<SpaceMoveTab> = {}): SpaceMoveTab => ({
  essential: false,
  grouped: false,
  id,
  spaceId: "space-b",
  split: false,
  ...overrides,
});

const snapshot = (overrides: Partial<SpaceMoveSnapshot> = {}): SpaceMoveSnapshot => ({
  activeId: "b",
  currentSpaceId: "space-b",
  direction: 1,
  hasMultiSelection: false,
  selectedIds: ["b"],
  spaces: ["space-a", "space-b", "space-c"],
  tabs: [tab("a"), tab("b"), tab("c")],
  workspaceEnabled: true,
  wrap: true,
  ...overrides,
});

describe("decideSpaceMove", () => {
  it("moves the active tab to the next space", () => {
    expect(decideSpaceMove(snapshot())).toEqual({
      destinationId: "space-c",
      kind: "move",
      tabIds: ["b"],
    });
  });

  it("moves a complete selection in source tab order to the previous space", () => {
    expect(
      decideSpaceMove(
        snapshot({
          direction: -1,
          hasMultiSelection: true,
          selectedIds: ["b", "a", "c"],
        }),
      ),
    ).toEqual({
      destinationId: "space-a",
      kind: "move",
      tabIds: ["a", "b", "c"],
    });
  });

  it.each([
    [1, "space-c", "space-a"],
    [-1, "space-a", "space-c"],
  ] as const)(
    "wraps direction %s from %s to %s",
    (direction, currentSpaceId, destinationId) => {
      expect(
        decideSpaceMove(
          snapshot({
            currentSpaceId,
            direction,
            tabs: [
              tab("a", { spaceId: currentSpaceId }),
              tab("b", { spaceId: currentSpaceId }),
              tab("c", { spaceId: currentSpaceId }),
            ],
          }),
        ),
      ).toMatchObject({ destinationId, kind: "move" });
    },
  );

  it.each([
    [1, "space-c"],
    [-1, "space-a"],
  ] as const)(
    "does not move past an edge when wrapping is disabled",
    (direction, currentSpaceId) => {
      expect(
        decideSpaceMove(
          snapshot({
            currentSpaceId,
            direction,
            tabs: [
              tab("a", { spaceId: currentSpaceId }),
              tab("b", { spaceId: currentSpaceId }),
              tab("c", { spaceId: currentSpaceId }),
            ],
            wrap: false,
          }),
        ),
      ).toEqual({ kind: "blocked", reason: "no-destination" });
    },
  );

  it("does nothing with one space or disabled workspaces", () => {
    expect(decideSpaceMove(snapshot({ spaces: ["space-b"] }))).toEqual({
      kind: "blocked",
      reason: "no-destination",
    });
    expect(decideSpaceMove(snapshot({ workspaceEnabled: false }))).toEqual({
      kind: "blocked",
      reason: "workspaces-disabled",
    });
  });

  it.each([
    ["essential", { essential: true }],
    ["grouped", { grouped: true }],
    ["split", { split: true }],
  ] as const)("blocks a selection containing an %s tab", (reason, unsupported) => {
    expect(
      decideSpaceMove(
        snapshot({
          hasMultiSelection: true,
          selectedIds: ["a", "b"],
          tabs: [tab("a"), tab("b", unsupported)],
        }),
      ),
    ).toEqual({ kind: "blocked", reason });
  });

  it("blocks invalid or cross-space selections", () => {
    expect(
      decideSpaceMove(
        snapshot({ hasMultiSelection: true, selectedIds: ["a", "missing"] }),
      ),
    ).toEqual({ kind: "blocked", reason: "invalid-selection" });
    expect(
      decideSpaceMove(
        snapshot({
          hasMultiSelection: true,
          selectedIds: ["a", "b"],
          tabs: [tab("a"), tab("b", { spaceId: "space-a" })],
        }),
      ),
    ).toEqual({ kind: "blocked", reason: "invalid-selection" });
  });
});
