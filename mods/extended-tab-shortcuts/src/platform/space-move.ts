import { decideSpaceMove, type SpaceMoveDirection } from "../core/space-move.ts";

export interface SpaceMovePlatformTab {
  group: object | null;
  pinned: boolean;
  splitview: object | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

export interface SpaceMoveBrowser {
  tabs: readonly SpaceMovePlatformTab[];
  selectedTab: SpaceMovePlatformTab | null;
  selectedTabs: readonly SpaceMovePlatformTab[];
  multiSelectedTabsCount: number;
  addToMultiSelectedTabs(tab: SpaceMovePlatformTab): void;
  clearMultiSelectedTabs(): void;
  tabContainer: { _invalidateCachedTabs(): void };
  zenHandleTabMove(tab: SpaceMovePlatformTab, move: () => void): void;
}

export interface SpaceMoveContainer {
  readonly lastChild: unknown;
  insertBefore(tab: SpaceMovePlatformTab, before: unknown): void;
}

export interface SpaceMoveWorkspaceElement {
  readonly pinnedTabsContainer: SpaceMoveContainer;
  readonly tabsContainer: SpaceMoveContainer;
}

export interface SpaceMoveWorkspace {
  readonly uuid: string;
}

export interface SpaceMoveWorkspaces {
  activeWorkspace: string;
  workspaceEnabled: boolean;
  shouldWrapAroundNavigation: boolean;
  lastSelectedWorkspaceTabs: Record<string, SpaceMovePlatformTab | undefined>;
  getWorkspaces(): readonly SpaceMoveWorkspace[];
  workspaceElement(workspaceId: string): SpaceMoveWorkspaceElement | null;
  moveTabsToWorkspace(tabs: SpaceMovePlatformTab[], workspaceId: string): boolean;
  changeWorkspace(workspace: SpaceMoveWorkspace): Promise<unknown>;
}

export interface SpaceMoveEnvironment {
  browser: SpaceMoveBrowser;
  workspaces: SpaceMoveWorkspaces;
}

const liveEnvironment = (): SpaceMoveEnvironment => ({
  browser: gBrowser as unknown as SpaceMoveBrowser,
  workspaces: gZenWorkspaces as unknown as SpaceMoveWorkspaces,
});

// Zen 1.21.16b omni.ja: ZenSpaceManager.mjs 608–685, 1511–1567, 1609–1700, 2844–2865.
export const moveSelectedTabsToSpace = async (
  direction: SpaceMoveDirection,
  environment = liveEnvironment(),
): Promise<boolean> => {
  const { browser, workspaces } = environment;
  const activeTab = browser.selectedTab;
  const tabsById = new Map(
    browser.tabs.map((tab, index) => [`tab-${String(index)}`, tab]),
  );
  const idsByTab = new Map([...tabsById].map(([id, tab]) => [tab, id]));
  const activeId = activeTab ? (idsByTab.get(activeTab) ?? null) : null;
  const spaces = workspaces.getWorkspaces();
  const decision = decideSpaceMove({
    activeId,
    currentSpaceId: workspaces.activeWorkspace,
    direction,
    hasMultiSelection: browser.multiSelectedTabsCount > 0,
    selectedIds: browser.selectedTabs.flatMap(tab => {
      const id = idsByTab.get(tab);
      return id ? [id] : [];
    }),
    spaces: spaces.map(space => space.uuid),
    tabs: [...tabsById].map(([id, tab]) => ({
      essential: tab.hasAttribute("zen-essential"),
      grouped: Boolean(tab.group),
      id,
      spaceId: tab.getAttribute("zen-workspace-id"),
      split: Boolean(tab.splitview),
    })),
    workspaceEnabled: workspaces.workspaceEnabled,
    wrap: workspaces.shouldWrapAroundNavigation,
  });
  if (decision.kind === "blocked" || !activeTab) return false;

  const destination = spaces.find(space => space.uuid === decision.destinationId);
  if (!destination) return false;
  const movingTabs = decision.tabIds.map(id => tabsById.get(id) as SpaceMovePlatformTab);
  const destinationElement = workspaces.workspaceElement(decision.destinationId);
  if (!destinationElement) return false;
  if (!workspaces.moveTabsToWorkspace([...movingTabs], decision.destinationId)) {
    return false;
  }
  for (const tab of movingTabs) {
    const container = tab.pinned
      ? destinationElement.pinnedTabsContainer
      : destinationElement.tabsContainer;
    browser.zenHandleTabMove(tab, () => {
      container.insertBefore(tab, container.lastChild);
    });
  }
  browser.tabContainer._invalidateCachedTabs();
  workspaces.lastSelectedWorkspaceTabs[decision.destinationId] = activeTab;
  await workspaces.changeWorkspace(destination);

  browser.clearMultiSelectedTabs();
  browser.selectedTab = activeTab;
  if (movingTabs.length > 1) {
    for (const tab of movingTabs) browser.addToMultiSelectedTabs(tab);
  }
  return true;
};
