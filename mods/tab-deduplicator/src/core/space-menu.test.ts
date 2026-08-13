import { describe, expect, it } from "vitest";
import { spaceGroupingMenuState } from "./space-menu.ts";

describe("spaceGroupingMenuState", () => {
  it("disables an unsupported action", () => {
    expect(
      spaceGroupingMenuState({ supported: false, moveCount: 3, pinnedMoveCount: 0 }),
    ).toEqual({
      label: "Group Duplicate Tabs",
      disabled: true,
    });
  });

  it("disables a no-op action", () => {
    expect(
      spaceGroupingMenuState({ supported: true, moveCount: 0, pinnedMoveCount: 0 }),
    ).toEqual({
      label: "Group Duplicate Tabs",
      disabled: true,
    });
  });

  it("counts movable duplicates", () => {
    expect(
      spaceGroupingMenuState({ supported: true, moveCount: 1, pinnedMoveCount: 0 }),
    ).toEqual({
      label: "Group Duplicate Tabs",
      disabled: false,
    });
    expect(
      spaceGroupingMenuState({ supported: true, moveCount: 4, pinnedMoveCount: 0 }),
    ).toEqual({
      label: "Group Duplicate Tabs",
      disabled: false,
    });
  });

  it("keeps the label stable when pinned participation blocks grouping", () => {
    expect(
      spaceGroupingMenuState({ supported: true, moveCount: 0, pinnedMoveCount: 2 }),
    ).toEqual({
      label: "Group Duplicate Tabs",
      disabled: true,
    });
  });
});
