import { describe, expect, it, vi } from "vitest";
import {
  moveSelectedTabsToSpace,
  type SpaceMoveBrowser,
  type SpaceMovePlatformTab,
  type SpaceMoveWorkspaces,
} from "./space-move.ts";

class FakeTab implements SpaceMovePlatformTab {
  group: object | null = null;
  pinned = false;
  splitview: object | null = null;
  scrollIntoView = vi.fn();

  constructor(
    readonly id: string,
    private readonly spaceId = "space-b",
  ) {}

  getAttribute(name: string) {
    return name === "zen-workspace-id" ? this.spaceId : null;
  }

  hasAttribute(_name: string) {
    return false;
  }
}

const createFixture = () => {
  const tabs = [new FakeTab("a"), new FakeTab("b"), new FakeTab("c")];
  const ordinaryEnd = {};
  const pinnedEnd = {};
  const ordinaryInsertBefore = vi.fn();
  const pinnedInsertBefore = vi.fn();
  const destinationElement = {
    pinnedTabsContainer: {
      insertBefore: pinnedInsertBefore,
      lastChild: pinnedEnd,
    },
    tabsContainer: {
      insertBefore: ordinaryInsertBefore,
      lastChild: ordinaryEnd,
    },
  };
  const browser: SpaceMoveBrowser = {
    addToMultiSelectedTabs: vi.fn(),
    clearMultiSelectedTabs: vi.fn(),
    multiSelectedTabsCount: 2,
    selectedTab: tabs[1] as FakeTab,
    selectedTabs: [tabs[1] as FakeTab, tabs[0] as FakeTab],
    tabContainer: {
      _invalidateCachedTabs: vi.fn(),
      arrowScrollbox: {
        overflowing: true,
      },
    },
    tabs,
    zenHandleTabMove: vi.fn((_tab, move) => move()),
  };
  const spaces = [{ uuid: "space-a" }, { uuid: "space-b" }, { uuid: "space-c" }];
  const workspaces: SpaceMoveWorkspaces = {
    activeWorkspace: "space-b",
    changeWorkspace: vi.fn(async () => {}),
    getWorkspaces: vi.fn(() => spaces),
    lastSelectedWorkspaceTabs: {},
    moveTabsToWorkspace: vi.fn(() => true),
    shouldWrapAroundNavigation: true,
    workspaceElement: vi.fn(() => destinationElement),
    workspaceEnabled: true,
  };
  return {
    browser,
    ordinaryEnd,
    ordinaryInsertBefore,
    pinnedEnd,
    pinnedInsertBefore,
    spaces,
    tabs,
    workspaces,
  };
};

describe("moveSelectedTabsToSpace", () => {
  it("moves the ordered selection to the next space and restores it", async () => {
    const { browser, ordinaryEnd, ordinaryInsertBefore, spaces, tabs, workspaces } =
      createFixture();

    expect(await moveSelectedTabsToSpace(1, { browser, workspaces })).toBe(true);

    expect(workspaces.moveTabsToWorkspace).toHaveBeenCalledWith(
      [tabs[0], tabs[1]],
      "space-c",
    );
    expect(ordinaryInsertBefore).toHaveBeenNthCalledWith(1, tabs[0], ordinaryEnd);
    expect(ordinaryInsertBefore).toHaveBeenNthCalledWith(2, tabs[1], ordinaryEnd);
    expect(browser.tabContainer._invalidateCachedTabs).toHaveBeenCalledOnce();
    expect(workspaces.lastSelectedWorkspaceTabs["space-c"]).toBe(tabs[1]);
    expect(workspaces.changeWorkspace).toHaveBeenCalledWith(spaces[2]);
    expect(browser.selectedTab).toBe(tabs[1]);
    expect(browser.clearMultiSelectedTabs).toHaveBeenCalledOnce();
    expect(browser.addToMultiSelectedTabs).toHaveBeenNthCalledWith(1, tabs[0]);
    expect(browser.addToMultiSelectedTabs).toHaveBeenNthCalledWith(2, tabs[1]);
    expect(tabs[1]?.scrollIntoView).toHaveBeenCalledWith({
      behavior: "instant",
      block: "center",
    });
  });

  it("moves the active tab to the previous space without creating a multiselection", async () => {
    const { browser, pinnedEnd, pinnedInsertBefore, spaces, tabs, workspaces } =
      createFixture();
    browser.multiSelectedTabsCount = 0;
    (tabs[1] as FakeTab).pinned = true;
    browser.selectedTabs = [tabs[1] as FakeTab];

    expect(await moveSelectedTabsToSpace(-1, { browser, workspaces })).toBe(true);

    expect(workspaces.moveTabsToWorkspace).toHaveBeenCalledWith([tabs[1]], "space-a");
    expect(pinnedInsertBefore).toHaveBeenCalledWith(tabs[1], pinnedEnd);
    expect(workspaces.changeWorkspace).toHaveBeenCalledWith(spaces[0]);
    expect(browser.addToMultiSelectedTabs).not.toHaveBeenCalled();
  });

  it("respects disabled wrapping at the edge", async () => {
    const { browser, workspaces } = createFixture();
    workspaces.activeWorkspace = "space-c";
    workspaces.shouldWrapAroundNavigation = false;
    browser.tabs = [new FakeTab("a", "space-c")];
    browser.selectedTab = browser.tabs[0] as FakeTab;
    browser.selectedTabs = [browser.tabs[0] as FakeTab];
    browser.multiSelectedTabsCount = 0;

    expect(await moveSelectedTabsToSpace(1, { browser, workspaces })).toBe(false);

    expect(workspaces.moveTabsToWorkspace).not.toHaveBeenCalled();
    expect(workspaces.changeWorkspace).not.toHaveBeenCalled();
  });

  it("does nothing when any selected tab is unsupported", async () => {
    const { browser, tabs, workspaces } = createFixture();
    const unsupportedTab = tabs[0];
    if (!unsupportedTab) throw new Error("missing unsupported tab fixture");
    unsupportedTab.group = {};

    expect(await moveSelectedTabsToSpace(1, { browser, workspaces })).toBe(false);

    expect(workspaces.moveTabsToWorkspace).not.toHaveBeenCalled();
    expect(workspaces.changeWorkspace).not.toHaveBeenCalled();
  });

  it("does not switch spaces when Zen declines the move", async () => {
    const { browser, workspaces } = createFixture();
    vi.mocked(workspaces.moveTabsToWorkspace).mockReturnValue(false);

    expect(await moveSelectedTabsToSpace(1, { browser, workspaces })).toBe(false);

    expect(workspaces.changeWorkspace).not.toHaveBeenCalled();
  });
});
