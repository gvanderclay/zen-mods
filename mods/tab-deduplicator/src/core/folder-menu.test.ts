import { describe, expect, it } from "vitest";
import { folderGroupingMenuState } from "./folder-menu.ts";

describe("folderGroupingMenuState", () => {
  it("disables an unsupported folder action", () => {
    expect(
      folderGroupingMenuState({ supported: false, moveCount: 3, pinnedMoveCount: 0 }),
    ).toEqual({
      label: "Group duplicate tabs (unsupported)",
      disabled: true,
    });
  });

  it("disables the action when no tab needs to move", () => {
    expect(
      folderGroupingMenuState({ supported: true, moveCount: 0, pinnedMoveCount: 0 }),
    ).toEqual({
      label: "No duplicate tabs to group in this folder",
      disabled: true,
    });
  });

  it("counts one duplicate tab that would move", () => {
    expect(
      folderGroupingMenuState({ supported: true, moveCount: 1, pinnedMoveCount: 0 }),
    ).toEqual({
      label: "Group 1 duplicate tab in this folder",
      disabled: false,
    });
  });

  it("counts multiple duplicate tabs that would move", () => {
    expect(
      folderGroupingMenuState({ supported: true, moveCount: 4, pinnedMoveCount: 0 }),
    ).toEqual({
      label: "Group 4 duplicate tabs in this folder",
      disabled: false,
    });
  });

  it("treats an invalid count as no work", () => {
    expect(
      folderGroupingMenuState({ supported: true, moveCount: -1, pinnedMoveCount: -1 }),
    ).toEqual({
      label: "No duplicate tabs to group in this folder",
      disabled: true,
    });
  });

  it("explains when only the pinned preference prevents grouping", () => {
    expect(
      folderGroupingMenuState({ supported: true, moveCount: 0, pinnedMoveCount: 3 }),
    ).toEqual({
      label: "Enable pinned tabs to group duplicates in this folder",
      disabled: true,
    });
  });
});
