import { describe, expect, it } from "vitest";
import { folderCloseMenuState, folderGroupingMenuState } from "./folder-menu.ts";

describe("folderGroupingMenuState", () => {
  it("disables an unsupported folder action", () => {
    expect(
      folderGroupingMenuState({ supported: false, moveCount: 3, pinnedMoveCount: 0 }),
    ).toEqual({
      label: "Group Duplicate Tabs",
      disabled: true,
    });
  });

  it("disables the action when no tab needs to move", () => {
    expect(
      folderGroupingMenuState({ supported: true, moveCount: 0, pinnedMoveCount: 0 }),
    ).toEqual({
      label: "Group Duplicate Tabs",
      disabled: true,
    });
  });

  it("counts one duplicate tab that would move", () => {
    expect(
      folderGroupingMenuState({ supported: true, moveCount: 1, pinnedMoveCount: 0 }),
    ).toEqual({
      label: "Group Duplicate Tabs",
      disabled: false,
    });
  });

  it("counts multiple duplicate tabs that would move", () => {
    expect(
      folderGroupingMenuState({ supported: true, moveCount: 4, pinnedMoveCount: 0 }),
    ).toEqual({
      label: "Group Duplicate Tabs",
      disabled: false,
    });
  });

  it("treats an invalid count as no work", () => {
    expect(
      folderGroupingMenuState({ supported: true, moveCount: -1, pinnedMoveCount: -1 }),
    ).toEqual({
      label: "Group Duplicate Tabs",
      disabled: true,
    });
  });

  it("keeps the label stable when pinned participation blocks grouping", () => {
    expect(
      folderGroupingMenuState({ supported: true, moveCount: 0, pinnedMoveCount: 3 }),
    ).toEqual({
      label: "Group Duplicate Tabs",
      disabled: true,
    });
  });
});

describe("folderCloseMenuState", () => {
  it("disables unsupported and empty close actions", () => {
    expect(folderCloseMenuState({ supported: false, candidateCount: 2 })).toEqual({
      label: "Close Duplicate Tabs",
      disabled: true,
    });
    expect(folderCloseMenuState({ supported: true, candidateCount: 0 })).toEqual({
      label: "Close Duplicate Tabs",
      disabled: true,
    });
  });

  it("keeps the close label stable for ordinary candidates", () => {
    expect(folderCloseMenuState({ supported: true, candidateCount: 1 })).toEqual({
      label: "Close Duplicate Tabs",
      disabled: false,
    });
    expect(folderCloseMenuState({ supported: true, candidateCount: 3 })).toEqual({
      label: "Close Duplicate Tabs",
      disabled: false,
    });
  });
});
