export interface WindowTogglePlatformTab {
  readonly id: string;
  group: object | null;
  multiselected: boolean;
  pinned: boolean;
  splitview: object | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

export interface WindowToggleContainer {
  readonly lastChild: unknown;
  insertBefore(tab: WindowTogglePlatformTab, before: unknown): void;
}

export interface WindowToggleWorkspaceElement {
  readonly pinnedTabsContainer: WindowToggleContainer;
  readonly tabsContainer: WindowToggleContainer;
}

export interface WindowToggleWorkspace {
  readonly uuid: string;
}

export interface WindowToggleWorkspaces {
  readonly activeWorkspace: string;
  readonly lastSelectedWorkspaceTabs: Record<string, WindowTogglePlatformTab | undefined>;
  changeWorkspaceWithID(workspaceId: string): Promise<unknown>;
  getWorkspaces(): readonly WindowToggleWorkspace[];
  moveTabToWorkspace(tab: WindowTogglePlatformTab, workspaceId: string): boolean;
  workspaceElement(workspaceId: string): WindowToggleWorkspaceElement | null;
}

export interface WindowToggleBrowser {
  readonly tabs: WindowTogglePlatformTab[];
  selectedTab: WindowTogglePlatformTab | null;
  selectedTabs: WindowTogglePlatformTab[];
  multiSelectedTabsCount: number;
  readonly pinnedTabCount: number;
  readonly selectedBrowser?: { focus(): void };
  addTab(
    url: string,
    options: {
      inBackground: boolean;
      skipAnimation: boolean;
      triggeringPrincipal: unknown;
    },
  ): WindowTogglePlatformTab | null;
  addToMultiSelectedTabs(tab: WindowTogglePlatformTab): void;
  adoptTab(
    tab: WindowTogglePlatformTab,
    options: { tabIndex: number },
  ): WindowTogglePlatformTab | null;
  clearMultiSelectedTabs(): void;
  moveTabTo(tab: WindowTogglePlatformTab, options: { tabIndex: number }): void;
  removeTab(tab: WindowTogglePlatformTab, options: { animate: boolean }): void;
  replaceTabsWithWindow(
    tab: WindowTogglePlatformTab,
    options: Record<string, unknown>,
  ): WindowToggleWindow | null | undefined;
  readonly tabContainer: { _invalidateCachedTabs(): void };
  zenHandleTabMove(tab: WindowTogglePlatformTab, move: () => void): void;
}

export interface WindowToggleWindow {
  _zenStartupSyncFlag?: "synced" | "unsynced";
  closed: boolean;
  readonly document: {
    readonly documentElement: { hasAttribute(name: string): boolean };
  };
  readonly gBrowser: WindowToggleBrowser;
  readonly gZenWorkspaces: WindowToggleWorkspaces;
  addEventListener(
    type: "MozAfterPaint" | "before-initial-tab-adopted",
    listener: () => void,
    options: { once: boolean },
  ): void;
  close(): void;
  focus(): void;
  setTimeout(callback: () => void, delay: number): number;
}

export interface WindowToggleEnvironment {
  browserWindows: WindowToggleWindow[];
  firstSharedWindow: WindowToggleWindow | null;
  isPrivateWindow(target: WindowToggleWindow): boolean;
  sourceWindow: WindowToggleWindow;
  triggeringPrincipal: unknown;
}
