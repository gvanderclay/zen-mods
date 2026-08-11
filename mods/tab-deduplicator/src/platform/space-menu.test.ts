import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuplicateMove } from "../core/duplicates.ts";
import {
  applySpaceMoves,
  closeCurrentSpaceDuplicates,
  spaceCloseCandidates,
} from "./space-menu.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

interface FakeGroup {
  id: string;
  isZenFolder?: boolean;
  group?: FakeGroup | null;
  hasAttribute(name: string): boolean;
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

const folder = (id: string): FakeGroup => ({
  id,
  isZenFolder: true,
  group: null,
  hasAttribute: () => false,
});

const tab = (
  id: string,
  options: {
    pinned?: boolean;
    essential?: boolean;
    group?: FakeGroup | null;
    split?: boolean;
  } = {},
): FakeTab => {
  const enclosingGroup = options.group ?? null;
  return {
    id,
    label: id,
    pinned: options.pinned ?? false,
    userContextId: 0,
    lastSeenActive: 0,
    linkedPanel: `panel-${id}`,
    linkedBrowser: { currentURI: { spec: "https://example.com/duplicate" } },
    group: options.split
      ? {
          id: `split-${id}`,
          group: enclosingGroup,
          hasAttribute: name => name === "split-view-group",
        }
      : enclosingGroup,
    hasAttribute: name => name === "zen-essential" && options.essential === true,
  };
};

describe("applySpaceMoves", () => {
  it("applies independent folder, pinned, and ordinary lane moves", () => {
    const folderA = folder("folder-a");
    const tabs = new Map([
      ["folder-copy", tab("folder-copy", { pinned: true, group: folderA })],
      ["folder-keeper", tab("folder-keeper", { pinned: true, group: folderA })],
      ["pin-copy", tab("pin-copy", { pinned: true })],
      ["pin-keeper", tab("pin-keeper", { pinned: true })],
      ["tab-copy", tab("tab-copy")],
      ["tab-keeper", tab("tab-keeper")],
    ]);
    const moves: DuplicateMove[] = [
      {
        tabId: "folder-copy",
        afterTabId: "folder-keeper",
        laneId: "folder:folder-a",
      },
      {
        tabId: "pin-copy",
        afterTabId: "pin-keeper",
        laneId: "top-level-pinned",
      },
      {
        tabId: "tab-copy",
        afterTabId: "tab-keeper",
        laneId: "top-level-ordinary",
      },
    ];
    const moveAfter = vi.fn();

    expect(applySpaceMoves(moves, tabs, moveAfter)).toBe(3);
    expect(moveAfter).toHaveBeenCalledTimes(3);
  });

  it("skips stale, cross-lane, and split-view moves and reports only successes", () => {
    const folderA = folder("folder-a");
    const moveAfter = vi.fn();
    const moves: DuplicateMove[] = [
      { tabId: "missing", afterTabId: "ordinary", laneId: "top-level-ordinary" },
      { tabId: "pin", afterTabId: "ordinary", laneId: "top-level-pinned" },
      {
        tabId: "ordinary-pin",
        afterTabId: "essential",
        laneId: "top-level-pinned",
      },
      { tabId: "split", afterTabId: "ordinary", laneId: "folder:folder-a" },
      { tabId: "valid", afterTabId: "ordinary", laneId: "top-level-ordinary" },
    ];
    const tabs = new Map([
      ["pin", tab("pin", { pinned: true })],
      ["ordinary-pin", tab("ordinary-pin", { pinned: true })],
      ["essential", tab("essential", { pinned: true, essential: true })],
      ["ordinary", tab("ordinary")],
      ["split", tab("split", { pinned: true, group: folderA, split: true })],
      ["valid", tab("valid")],
    ]);

    expect(applySpaceMoves(moves, tabs, moveAfter)).toBe(1);
    expect(moveAfter).toHaveBeenCalledOnce();
    expect(moveAfter).toHaveBeenCalledWith(tabs.get("valid"), tabs.get("ordinary"));
  });
});

describe("spaceCloseCandidates", () => {
  it("keeps candidates only while they remain in their planned lanes and pin category", () => {
    const folderA = folder("folder-a");
    const folderB = folder("folder-b");
    const ordinary = tab("ordinary");
    const pinned = tab("pinned", { pinned: true, group: folderA });
    const essential = tab("essential", {
      pinned: true,
      essential: true,
      group: folderA,
    });
    const tabs = new Map([
      ["ordinary", ordinary],
      ["pinned", pinned],
      ["essential", essential],
      ["moved-folder", tab("moved-folder", { pinned: true, group: folderB })],
      ["changed-category", tab("changed-category")],
    ]);

    expect(
      spaceCloseCandidates(
        [{ id: "ordinary", laneId: "top-level-ordinary" }],
        tabs,
        false,
      ),
    ).toEqual([ordinary]);
    expect(
      spaceCloseCandidates(
        [
          { id: "pinned", laneId: "folder:folder-a" },
          { id: "pinned", laneId: "folder:folder-a" },
          { id: "essential", laneId: "folder:folder-a" },
          { id: "moved-folder", laneId: "folder:folder-a" },
          { id: "changed-category", laneId: "folder:folder-a" },
          { id: "missing", laneId: "folder:folder-a" },
        ],
        tabs,
        true,
      ),
    ).toEqual([pinned]);
  });

  it("reviews and closes only the freshly confirmed current-space candidates", async () => {
    const keeper = tab("keeper");
    const duplicate = tab("duplicate");
    const close = vi.fn();
    vi.stubGlobal("gBrowser", {
      tabs: [keeper, duplicate],
      _removeDuplicateTabs: close,
      closingTabsEnum: { DUPLICATES: 7 },
    });
    const presenter = {
      show: vi.fn(async () => ({ kind: "confirm" as const, includePinned: false })),
      dispose: vi.fn(),
    };
    const anchor = {};

    await expect(
      closeCurrentSpaceDuplicates(false, anchor, presenter, () => true),
    ).resolves.toBe(true);
    expect(presenter.show).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith(anchor, [duplicate], 7);
  });

  it("refreshes the review and does not close after the duplicate set changes", async () => {
    const tabs = [tab("keeper"), tab("duplicate")];
    const close = vi.fn();
    vi.stubGlobal("gBrowser", {
      tabs,
      _removeDuplicateTabs: close,
      closingTabsEnum: { DUPLICATES: 7 },
    });
    const presenter = {
      show: vi
        .fn()
        .mockImplementationOnce(async () => {
          tabs.pop();
          return { kind: "confirm" as const, includePinned: false };
        })
        .mockResolvedValueOnce({ kind: "cancel" as const }),
      dispose: vi.fn(),
    };

    await expect(
      closeCurrentSpaceDuplicates(false, {}, presenter, () => true),
    ).resolves.toBe(false);
    expect(presenter.show).toHaveBeenCalledTimes(2);
    expect(presenter.show.mock.calls[1]?.[1]).toEqual({ changed: true });
    expect(close).not.toHaveBeenCalled();
  });
});
