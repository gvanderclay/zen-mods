import { describe, expect, it } from "vitest";
import { spaceGroupingMenuState } from "./space-menu.ts";

describe("spaceGroupingMenuState", () => {
  it("disables an unsupported action", () => {
    expect(
      spaceGroupingMenuState({ supported: false, moveCount: 3, pinnedMoveCount: 0 }),
    ).toEqual({ label: "Group duplicate tabs (unsupported)", disabled: true });
  });

  it("disables a no-op action", () => {
    expect(
      spaceGroupingMenuState({ supported: true, moveCount: 0, pinnedMoveCount: 0 }),
    ).toEqual({ label: "No duplicate tabs to group in this space", disabled: true });
  });

  it("counts movable duplicates", () => {
    expect(
      spaceGroupingMenuState({ supported: true, moveCount: 1, pinnedMoveCount: 0 }),
    ).toEqual({ label: "Group 1 duplicate tab in this space", disabled: false });
    expect(
      spaceGroupingMenuState({ supported: true, moveCount: 4, pinnedMoveCount: 0 }),
    ).toEqual({ label: "Group 4 duplicate tabs in this space", disabled: false });
  });

  it("explains when only pinned participation blocks grouping", () => {
    expect(
      spaceGroupingMenuState({ supported: true, moveCount: 0, pinnedMoveCount: 2 }),
    ).toEqual({
      label: "Enable pinned tabs to group duplicates in this space",
      disabled: true,
    });
  });
});
