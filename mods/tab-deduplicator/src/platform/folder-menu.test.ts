import { describe, expect, it, vi } from "vitest";
import type { DuplicateMove } from "../core/duplicates.ts";
import { applyFolderMoves, resolveFolderContextTarget } from "./folder-menu.ts";

interface FakeGroup {
  id: string;
  isZenFolder?: boolean;
  group?: FakeGroup | null;
  hasAttribute(name: string): boolean;
}

interface FakeTarget {
  kind?: "label" | "other";
  group?: FakeGroup | null;
  parentElement?: FakeTarget | FakeGroup | null;
  isZenFolder?: boolean;
  classList: { contains(name: string): boolean };
}

interface FakeTab {
  id: string;
  pinned: boolean;
  userContextId: number;
  lastSeenActive: number;
  group?: FakeGroup | null;
  hasAttribute(name: string): boolean;
}

const group = (overrides: Partial<FakeGroup> = {}): FakeGroup => ({
  id: "folder-a",
  isZenFolder: true,
  group: null,
  hasAttribute: () => false,
  ...overrides,
});

const target = (overrides: Partial<FakeTarget> = {}): FakeTarget => ({
  kind: "other",
  group: null,
  parentElement: null,
  classList: { contains: () => false },
  ...overrides,
});

const tab = (id: string, folder: FakeGroup, splitView = false): FakeTab => ({
  id,
  pinned: true,
  userContextId: 0,
  lastSeenActive: 0,
  group: splitView
    ? group({
        id: `split-${id}`,
        isZenFolder: false,
        group: folder,
        hasAttribute: name => name === "split-view-group",
      })
    : folder,
  hasAttribute: () => false,
});

const isLabel = (candidate: unknown) =>
  (candidate as FakeTarget | null)?.kind === "label";

describe("resolveFolderContextTarget", () => {
  it("resolves a folder from its group label", () => {
    const folder = group();
    expect(
      resolveFolderContextTarget(target({ kind: "label", group: folder }), isLabel),
    ).toBe(folder);
  });

  it("resolves a folder from a child of its group label", () => {
    const folder = group();
    const label = target({ kind: "label", group: folder });
    expect(resolveFolderContextTarget(target({ parentElement: label }), isLabel)).toBe(
      folder,
    );
  });

  it("resolves Zen's folder label container shape", () => {
    const folder = Object.assign(group(), { parentElement: null });
    const container = target({
      parentElement: folder,
      classList: { contains: name => name === "tab-group-label-container" },
    });
    expect(resolveFolderContextTarget(container, isLabel)).toBe(folder);
  });

  it("rejects a non-folder target", () => {
    expect(resolveFolderContextTarget(target(), isLabel)).toBeNull();
  });
});

describe("applyFolderMoves", () => {
  it("moves live tabs after their planned anchors inside the same folder", () => {
    const folder = group();
    const moving = tab("moving", folder);
    const anchor = tab("anchor", folder);
    const moveAfter = vi.fn();
    const moves: DuplicateMove[] = [
      { tabId: "moving", afterTabId: "anchor", laneId: "folder:folder-a" },
    ];

    expect(
      applyFolderMoves(
        moves,
        new Map([
          ["moving", moving],
          ["anchor", anchor],
        ]),
        moveAfter,
      ),
    ).toBe(1);
    expect(moveAfter).toHaveBeenCalledWith(moving, anchor);
  });

  it("skips stale, cross-folder, and split-view moves", () => {
    const folderA = group({ id: "folder-a" });
    const folderB = group({ id: "folder-b" });
    const anchor = tab("anchor", folderA);
    const moveAfter = vi.fn();
    const moves: DuplicateMove[] = [
      { tabId: "missing", afterTabId: "anchor", laneId: "folder:folder-a" },
      { tabId: "cross-folder", afterTabId: "anchor", laneId: "folder:folder-a" },
      { tabId: "split", afterTabId: "anchor", laneId: "folder:folder-a" },
      { tabId: "ordinary", afterTabId: "split-anchor", laneId: "folder:folder-a" },
    ];

    expect(
      applyFolderMoves(
        moves,
        new Map([
          ["anchor", anchor],
          ["cross-folder", tab("cross-folder", folderB)],
          ["split", tab("split", folderA, true)],
          ["ordinary", tab("ordinary", folderA)],
          ["split-anchor", tab("split-anchor", folderA, true)],
        ]),
        moveAfter,
      ),
    ).toBe(0);
    expect(moveAfter).not.toHaveBeenCalled();
  });
});
