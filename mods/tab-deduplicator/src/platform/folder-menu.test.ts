import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuplicateMove } from "../core/duplicates.ts";
import type { CloseReview } from "../core/review.ts";
import {
  applyFolderMoves,
  closeCurrentFolderDuplicates,
  closeFolderCandidates,
  folderCloseCandidates,
  resolveFolderContextTarget,
} from "./folder-menu.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

interface FakeGroup {
  id: string;
  label?: string;
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
  label?: string;
  pinned: boolean;
  userContextId: number;
  lastSeenActive: number;
  linkedPanel: string | null;
  linkedBrowser?: { currentURI: { spec: string } };
  group?: FakeGroup | null;
  hasAttribute(name: string): boolean;
}

const group = (overrides: Partial<FakeGroup> = {}): FakeGroup => ({
  id: "folder-a",
  label: "Folder A",
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
  label: id,
  pinned: true,
  userContextId: 0,
  lastSeenActive: 0,
  linkedPanel: `panel-${id}`,
  linkedBrowser: { currentURI: { spec: "https://example.com/duplicate" } },
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

const ordinaryTab = (
  id: string,
  folder: FakeGroup,
  options: { pinned?: boolean; essential?: boolean } = {},
): FakeTab => ({
  ...tab(id, folder),
  pinned: options.pinned ?? false,
  hasAttribute: name => name === "zen-essential" && options.essential === true,
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

describe("folderCloseCandidates", () => {
  it("keeps only live ordinary, non-essential candidates in the requested folder", () => {
    const folderA = group({ id: "folder-a" });
    const folderB = group({ id: "folder-b" });
    const ordinary = ordinaryTab("ordinary", folderA);
    const tabs = new Map([
      ["ordinary", ordinary],
      ["pinned", ordinaryTab("pinned", folderA, { pinned: true })],
      ["essential", ordinaryTab("essential", folderA, { essential: true })],
      ["other-folder", ordinaryTab("other-folder", folderB)],
    ]);

    expect(
      folderCloseCandidates(
        ["ordinary", "pinned", "essential", "other-folder", "missing"],
        tabs,
        "folder-a",
      ),
    ).toEqual([ordinary]);
  });

  it("keeps only live pinned, non-essential candidates when pinned tabs are requested", () => {
    const folderA = group({ id: "folder-a" });
    const pinned = ordinaryTab("pinned", folderA, { pinned: true });
    const tabs = new Map([
      ["ordinary", ordinaryTab("ordinary", folderA)],
      ["pinned", pinned],
      ["essential", ordinaryTab("essential", folderA, { pinned: true, essential: true })],
    ]);

    expect(
      folderCloseCandidates(["ordinary", "pinned", "essential"], tabs, "folder-a", true),
    ).toEqual([pinned]);
  });

  it("invokes the native helper only for a non-empty fresh candidate list", () => {
    const folderA = group({ id: "folder-a" });
    const ordinary = ordinaryTab("ordinary", folderA);
    const close = vi.fn();

    expect(closeFolderCandidates(folderA, [], 4, close)).toBe(false);
    expect(close).not.toHaveBeenCalled();

    expect(closeFolderCandidates(folderA, [ordinary], 4, close)).toBe(true);
    expect(close).toHaveBeenCalledWith(folderA, [ordinary], 4);
  });

  it("reviews and closes only fresh candidates from the captured folder", async () => {
    const folderA = group({ id: "folder-a", label: "Work" });
    const keeper = ordinaryTab("keeper", folderA);
    const duplicate = ordinaryTab("duplicate", folderA);
    const otherFolder = group({ id: "folder-b", label: "Personal" });
    const otherKeeper = ordinaryTab("other-keeper", otherFolder);
    const otherDuplicate = ordinaryTab("other-duplicate", otherFolder);
    const close = vi.fn();
    vi.stubGlobal("gBrowser", {
      tabs: [keeper, duplicate, otherKeeper, otherDuplicate],
    });
    const presenter = {
      show: vi.fn(async (_review: CloseReview) => ({
        kind: "confirm" as const,
        includePinned: false,
      })),
      dispose: vi.fn(),
    };

    await expect(
      closeCurrentFolderDuplicates(
        folderA as BrowserTabGroup,
        false,
        presenter,
        () => true,
        9,
        close,
      ),
    ).resolves.toBe(true);
    expect(presenter.show.mock.calls[0]?.[0].groups).toHaveLength(1);
    expect(close).toHaveBeenCalledWith(folderA, [duplicate], 9);
  });
});
