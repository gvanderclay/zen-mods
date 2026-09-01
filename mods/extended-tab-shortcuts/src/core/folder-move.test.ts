import { describe, expect, it } from "vitest";
import { decideFolderMove, type FolderMoveInput } from "./folder-move.ts";

const TAB_A: FolderMoveInput["tabs"][number] = {
  essential: false,
  groupId: null,
  id: "tab-a",
  liveFolderItem: false,
  spaceId: "space-a",
  split: false,
};
const TAB_B: FolderMoveInput["tabs"][number] = {
  ...TAB_A,
  id: "tab-b",
};

const input = (overrides: Partial<FolderMoveInput> = {}): FolderMoveInput => ({
  activeId: "tab-b",
  currentSpaceId: "space-a",
  folders: [],
  hasMultiSelection: true,
  privateWindow: false,
  selectedIds: ["tab-b", "tab-a"],
  tabs: [TAB_A, TAB_B],
  ...overrides,
});

describe("decideFolderMove", () => {
  it("keeps tab and folder order while assigning only shortcuts 1 through 9", () => {
    const folders = Array.from({ length: 11 }, (_, index) => ({
      id: `folder-${String(index + 1)}`,
      label: `Folder ${String(index + 1)}`,
      level: index % 3,
      live: false,
      spaceId: "space-a",
    }));
    folders.splice(1, 0, {
      id: "folder-live",
      label: "Live",
      level: 0,
      live: true,
      spaceId: "space-a",
    });
    folders.splice(2, 0, {
      id: "folder-other-space",
      label: "Other Space",
      level: 0,
      live: false,
      spaceId: "space-b",
    });

    const decision = decideFolderMove(
      input({
        folders,
        tabs: [{ ...TAB_A, groupId: "folder-3" }, TAB_B],
      }),
    );

    expect(decision).toMatchObject({
      activeId: "tab-b",
      kind: "ready",
      tabIds: ["tab-a", "tab-b"],
    });
    if (decision.kind !== "ready") throw new Error("expected a ready decision");
    expect(decision.destinations.map(destination => destination.id)).toEqual([
      "folder-1",
      "folder-2",
      "folder-4",
      "folder-5",
      "folder-6",
      "folder-7",
      "folder-8",
      "folder-9",
      "folder-10",
      "folder-11",
    ]);
    expect(decision.destinations.map(destination => destination.shortcut)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      null,
    ]);
  });

  it("uses only the active tab when there is no multiselection", () => {
    expect(
      decideFolderMove(input({ hasMultiSelection: false, selectedIds: ["tab-a"] })),
    ).toMatchObject({
      activeId: "tab-b",
      kind: "ready",
      tabIds: ["tab-b"],
    });
  });

  it.each([
    ["private-window", { privateWindow: true }],
    [
      "unsupported-selection",
      {
        tabs: [TAB_A, { ...TAB_B, essential: true }],
      },
    ],
    [
      "mixed-space-selection",
      {
        tabs: [TAB_A, { ...TAB_B, spaceId: "space-b" }],
      },
    ],
  ] as const)("blocks %s", (reason, overrides) => {
    expect(decideFolderMove(input(overrides))).toEqual({ kind: "blocked", reason });
  });
});
