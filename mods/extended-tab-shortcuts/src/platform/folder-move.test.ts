import { describe, expect, it, vi } from "vitest";
import {
  createFolderFromSelectedTabs,
  type FolderMoveBrowser,
  type FolderMoveEnvironment,
  type FolderMovePlatformFolder,
  type FolderMovePlatformTab,
  getFolderMoveDecision,
  moveSelectedTabsToFolder,
} from "./folder-move.ts";

class FakeTab implements FolderMovePlatformTab {
  group: FolderMovePlatformFolder | null = null;
  splitview: object | null = null;

  constructor(
    readonly id: string,
    private readonly workspaceId = "space-a",
    private readonly attributes = new Set<string>(),
  ) {}

  getAttribute(name: string) {
    return name === "zen-workspace-id" ? this.workspaceId : null;
  }

  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
}

const createFolder = (
  id: string,
  label: string,
  options: { level?: number; live?: boolean; spaceId?: string } = {},
): FolderMovePlatformFolder => {
  const folder: FolderMovePlatformFolder = {
    addTabs: vi.fn(tabs => {
      for (const tab of tabs) tab.group = folder;
    }),
    id,
    isLiveFolder: options.live ?? false,
    isZenFolder: true,
    label,
    level: options.level ?? 0,
    getAttribute: name =>
      name === "zen-workspace-id" ? (options.spaceId ?? "space-a") : null,
  };
  return folder;
};

const createFixture = () => {
  const tabs = [new FakeTab("tab-a"), new FakeTab("tab-b"), new FakeTab("tab-c")];
  const first = createFolder("folder-a", "Alpha");
  const second = createFolder("folder-b", "Beta", { level: 1 });
  const browser: FolderMoveBrowser = {
    addToMultiSelectedTabs: vi.fn(),
    clearMultiSelectedTabs: vi.fn(() => {
      browser.selectedTabs = browser.selectedTab ? [browser.selectedTab] : [];
      browser.multiSelectedTabsCount = 0;
    }),
    multiSelectedTabsCount: 2,
    selectedTab: tabs[1] as FakeTab,
    selectedTabs: [tabs[1] as FakeTab, tabs[0] as FakeTab],
    tabGroups: [first, second],
    tabs,
  };
  const created = createFolder("folder-created", "Created");
  const environment: FolderMoveEnvironment = {
    browser,
    currentSpaceId: "space-a",
    createFolder: vi.fn(() => created),
    foldersEnabled: true,
    privateWindow: false,
  };
  return { browser, created, environment, first, second, tabs };
};

describe("folder move platform", () => {
  it("reads the ordered selection and eligible folder presentation", () => {
    const { environment } = createFixture();

    expect(getFolderMoveDecision(environment)).toEqual({
      activeId: "tab-b",
      destinations: [
        { id: "folder-a", label: "Alpha", level: 0, shortcut: "1" },
        { id: "folder-b", label: "Beta", level: 1, shortcut: "2" },
      ],
      kind: "ready",
      tabIds: ["tab-a", "tab-b"],
    });
  });

  it("moves tabs in sidebar order and restores the active multiselection", () => {
    const { browser, environment, second, tabs } = createFixture();
    vi.mocked(second.addTabs).mockImplementation(movingTabs => {
      browser.clearMultiSelectedTabs();
      for (const tab of movingTabs) tab.group = second;
    });

    expect(moveSelectedTabsToFolder("folder-b", environment)).toBe(true);

    expect(second.addTabs).toHaveBeenCalledWith([tabs[0], tabs[1]]);
    expect(browser.selectedTab).toBe(tabs[1]);
    expect(browser.addToMultiSelectedTabs).toHaveBeenNthCalledWith(1, tabs[0]);
    expect(browser.addToMultiSelectedTabs).toHaveBeenNthCalledWith(2, tabs[1]);
  });

  it("creates a named root folder and restores the selection", () => {
    const { browser, environment, tabs } = createFixture();
    vi.mocked(environment.createFolder).mockImplementation(_movingTabs => {
      browser.clearMultiSelectedTabs();
      return createFolder("new-folder", "Research");
    });

    expect(createFolderFromSelectedTabs("  Research  ", environment)).toBe(true);

    expect(environment.createFolder).toHaveBeenCalledWith([tabs[0], tabs[1]], {
      label: "Research",
      renameFolder: false,
      workspaceId: "space-a",
    });
    expect(browser.selectedTab).toBe(tabs[1]);
    expect(browser.addToMultiSelectedTabs).toHaveBeenCalledTimes(2);
  });

  it("does not mutate for an empty name or a stale destination", () => {
    const { environment, first } = createFixture();

    expect(createFolderFromSelectedTabs("   ", environment)).toBe(false);
    environment.browser.tabGroups = [];
    expect(moveSelectedTabsToFolder(first.id, environment)).toBe(false);

    expect(environment.createFolder).not.toHaveBeenCalled();
    expect(first.addTabs).not.toHaveBeenCalled();
  });
});
