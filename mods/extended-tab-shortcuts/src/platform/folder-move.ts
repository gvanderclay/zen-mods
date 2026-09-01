import { decideFolderMove, type FolderMoveDecision } from "../core/folder-move.ts";

export interface FolderMovePlatformTab {
  readonly id: string;
  group: FolderMovePlatformFolder | null;
  splitview: object | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

export interface FolderMovePlatformFolder {
  readonly id: string;
  readonly isLiveFolder: boolean;
  readonly isZenFolder: boolean;
  readonly label: string;
  readonly level: number;
  addTabs(tabs: readonly FolderMovePlatformTab[]): void;
  getAttribute(name: string): string | null;
}

export interface FolderMoveBrowser {
  tabs: readonly FolderMovePlatformTab[];
  selectedTab: FolderMovePlatformTab | null;
  selectedTabs: readonly FolderMovePlatformTab[];
  multiSelectedTabsCount: number;
  tabGroups: FolderMovePlatformFolder[];
  addToMultiSelectedTabs(tab: FolderMovePlatformTab): void;
  clearMultiSelectedTabs(): void;
}

export interface CreateFolderOptions {
  readonly label: string;
  readonly renameFolder: false;
  readonly workspaceId: string;
}

export interface FolderMoveEnvironment {
  readonly browser: FolderMoveBrowser;
  readonly currentSpaceId: string;
  readonly createFolder: (
    tabs: readonly FolderMovePlatformTab[],
    options: CreateFolderOptions,
  ) => FolderMovePlatformFolder;
  readonly foldersEnabled: boolean;
  readonly privateWindow: boolean;
}

interface LiveZenFolders {
  createFolder(
    tabs: readonly FolderMovePlatformTab[],
    options: CreateFolderOptions,
  ): FolderMovePlatformFolder;
}

const liveEnvironment = (): FolderMoveEnvironment => ({
  browser: gBrowser as unknown as FolderMoveBrowser,
  createFolder: (tabs, options) =>
    (gZenFolders as unknown as LiveZenFolders).createFolder(tabs, options),
  currentSpaceId: gZenWorkspaces.activeWorkspace,
  foldersEnabled: !gZenWorkspaces.privateWindowOrDisabled,
  privateWindow: PrivateBrowsingUtils.isWindowPrivate(window),
});

export const getFolderMoveDecision = (
  environment = liveEnvironment(),
): FolderMoveDecision => {
  const { browser } = environment;
  return decideFolderMove({
    activeId: browser.selectedTab?.id ?? null,
    currentSpaceId: environment.currentSpaceId,
    folders: browser.tabGroups
      .filter(folder => folder.isZenFolder)
      .map(folder => ({
        id: folder.id,
        label: folder.label,
        level: folder.level,
        live: folder.isLiveFolder,
        spaceId: folder.getAttribute("zen-workspace-id"),
      })),
    hasMultiSelection: browser.multiSelectedTabsCount > 0,
    privateWindow: environment.privateWindow || !environment.foldersEnabled,
    selectedIds: browser.selectedTabs.map(tab => tab.id),
    tabs: browser.tabs.map(tab => ({
      essential: tab.hasAttribute("zen-essential"),
      groupId: tab.group?.id ?? null,
      id: tab.id,
      liveFolderItem: tab.hasAttribute("zen-live-folder-item-id"),
      spaceId: tab.getAttribute("zen-workspace-id"),
      split: Boolean(tab.splitview),
    })),
  });
};

const restoreSelection = (
  browser: FolderMoveBrowser,
  movingTabs: readonly FolderMovePlatformTab[],
  activeTab: FolderMovePlatformTab,
): void => {
  browser.clearMultiSelectedTabs();
  browser.selectedTab = activeTab;
  if (movingTabs.length > 1) {
    for (const tab of movingTabs) browser.addToMultiSelectedTabs(tab);
  }
};

const resolveMove = (environment: FolderMoveEnvironment) => {
  const decision = getFolderMoveDecision(environment);
  if (decision.kind === "blocked") return null;
  const tabsById = new Map(environment.browser.tabs.map(tab => [tab.id, tab]));
  const movingTabs = decision.tabIds.flatMap(id => {
    const tab = tabsById.get(id);
    return tab ? [tab] : [];
  });
  const activeTab = tabsById.get(decision.activeId);
  if (!activeTab || movingTabs.length !== decision.tabIds.length) return null;
  return { activeTab, decision, movingTabs };
};

// Zen 1.21.16b omni.ja: ZenFolders.mjs 244–303, 485–525, 624–683; tabbrowser.js 8129–8403.
export const moveSelectedTabsToFolder = (
  folderId: string,
  environment = liveEnvironment(),
): boolean => {
  const move = resolveMove(environment);
  if (!move?.decision.destinations.some(folder => folder.id === folderId)) {
    return false;
  }
  const folder = environment.browser.tabGroups.find(group => group.id === folderId);
  if (!folder) return false;

  folder.addTabs(move.movingTabs);
  restoreSelection(environment.browser, move.movingTabs, move.activeTab);
  return true;
};

export const createFolderFromSelectedTabs = (
  requestedLabel: string,
  environment = liveEnvironment(),
): boolean => {
  const label = requestedLabel.trim();
  if (!label) return false;
  const move = resolveMove(environment);
  if (!move) return false;

  environment.createFolder(move.movingTabs, {
    label,
    renameFolder: false,
    workspaceId: environment.currentSpaceId,
  });
  restoreSelection(environment.browser, move.movingTabs, move.activeTab);
  return true;
};
