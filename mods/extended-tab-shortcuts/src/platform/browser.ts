import { decideWindowToggle, type WindowToggleDecision } from "../core/pop-out.ts";
import type {
  WindowToggleEnvironment,
  WindowTogglePlatformTab,
  WindowToggleWindow,
} from "./browser-types.ts";

interface ZenWindowSyncModule {
  readonly ZenWindowSync: {
    readonly firstSyncedWindow: WindowToggleWindow | null;
  };
}

const liveEnvironment = (): WindowToggleEnvironment => {
  const { ZenWindowSync } = ChromeUtils.importESModule(
    "resource:///modules/zen/ZenWindowSync.sys.mjs",
  ) as ZenWindowSyncModule;
  return {
    browserWindows: [
      ...Services.wm.getEnumerator("navigator:browser"),
    ] as WindowToggleWindow[],
    firstSharedWindow: ZenWindowSync.firstSyncedWindow,
    isPrivateWindow: target =>
      PrivateBrowsingUtils.isWindowPrivate(target as unknown as Window),
    sourceWindow: window as unknown as WindowToggleWindow,
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  };
};

const isUnsynced = (target: WindowToggleWindow): boolean =>
  target.document.documentElement.hasAttribute("zen-unsynced-window");

const addSourceTab = (
  environment: WindowToggleEnvironment,
): WindowTogglePlatformTab | null =>
  environment.sourceWindow.gBrowser.addTab("about:newtab", {
    inBackground: true,
    skipAnimation: true,
    triggeringPrincipal: environment.triggeringPrincipal,
  });

const restoreCreatedWindowActivePosition = (
  destination: WindowToggleWindow,
  decision: Extract<WindowToggleDecision, { kind: "move" }>,
  activeId: string,
): void => {
  const activeIndex = decision.tabIds.indexOf(activeId);
  if (activeIndex <= 0) return;
  destination.addEventListener(
    "before-initial-tab-adopted",
    () => {
      destination.addEventListener(
        "MozAfterPaint",
        () => {
          destination.setTimeout(() => {
            const activeTab = destination.gBrowser.selectedTab;
            if (!activeTab) return;
            const firstTabIndex = destination.gBrowser.tabs.findIndex(
              tab => !tab.hasAttribute("zen-empty-tab"),
            );
            destination.gBrowser.moveTabTo(activeTab, {
              tabIndex: Math.max(0, firstTabIndex) + activeIndex,
            });
          }, 0);
        },
        { once: true },
      );
    },
    { once: true },
  );
};

const createDestinationWindow = (
  environment: WindowToggleEnvironment,
  decision: Extract<WindowToggleDecision, { kind: "move" }>,
  activeId: string,
  activeTab: WindowTogglePlatformTab,
): WindowToggleWindow | null => {
  const browser = environment.sourceWindow.gBrowser;
  let provisionalTab: WindowTogglePlatformTab | null = null;
  if (decision.createSourceTab || decision.closeSourceWindow) {
    provisionalTab = addSourceTab(environment);
    if (!provisionalTab) return null;
  }

  try {
    const destination = browser.replaceTabsWithWindow(activeTab, {});
    if (!destination) {
      if (provisionalTab) browser.removeTab(provisionalTab, { animate: false });
      return null;
    }
    destination._zenStartupSyncFlag =
      decision.destination === "new-shared" ? "synced" : "unsynced";
    restoreCreatedWindowActivePosition(destination, decision, activeId);
    if (decision.closeSourceWindow) {
      destination.addEventListener(
        "before-initial-tab-adopted",
        () => {
          if (!environment.sourceWindow.closed) environment.sourceWindow.close();
        },
        { once: true },
      );
    }
    destination.focus();
    return destination;
  } catch (error) {
    if (provisionalTab) browser.removeTab(provisionalTab, { animate: false });
    throw error;
  }
};

const moveIntoExistingWindow = async (
  environment: WindowToggleEnvironment,
  decision: Extract<WindowToggleDecision, { kind: "move" }>,
  destination: WindowToggleWindow,
  movingTabs: WindowTogglePlatformTab[],
  activeTab: WindowTogglePlatformTab,
  sourceWorkspaceIndex: number,
): Promise<WindowToggleWindow | null> => {
  const workspaceId =
    destination.gZenWorkspaces.getWorkspaces()[sourceWorkspaceIndex]?.uuid ??
    destination.gZenWorkspaces.activeWorkspace;
  const destinationElement = destination.gZenWorkspaces.workspaceElement(workspaceId);
  if (!destinationElement) return null;

  let provisionalTab: WindowTogglePlatformTab | null = null;
  if (decision.createSourceTab) {
    provisionalTab = addSourceTab(environment);
    if (!provisionalTab) return null;
  }

  const adoptedTabs: WindowTogglePlatformTab[] = [];
  for (const tab of movingTabs) {
    const adopted = destination.gBrowser.adoptTab(tab, {
      tabIndex: tab.pinned
        ? destination.gBrowser.pinnedTabCount
        : Number.POSITIVE_INFINITY,
    });
    if (!adopted) {
      if (adoptedTabs.length === 0 && provisionalTab) {
        environment.sourceWindow.gBrowser.removeTab(provisionalTab, {
          animate: false,
        });
      }
      return null;
    }
    destination.gZenWorkspaces.moveTabToWorkspace(adopted, workspaceId);
    const container = adopted.pinned
      ? destinationElement.pinnedTabsContainer
      : destinationElement.tabsContainer;
    destination.gBrowser.zenHandleTabMove(adopted, () => {
      container.insertBefore(adopted, container.lastChild);
    });
    adoptedTabs.push(adopted);
  }
  destination.gBrowser.tabContainer._invalidateCachedTabs();

  const activeIndex = movingTabs.indexOf(activeTab);
  const adoptedActive = adoptedTabs[activeIndex];
  if (!adoptedActive) return null;
  destination.gZenWorkspaces.lastSelectedWorkspaceTabs[workspaceId] = adoptedActive;
  await destination.gZenWorkspaces.changeWorkspaceWithID(workspaceId);
  destination.gBrowser.clearMultiSelectedTabs();
  destination.gBrowser.selectedTab = adoptedActive;
  if (adoptedTabs.length > 1) {
    for (const tab of adoptedTabs) destination.gBrowser.addToMultiSelectedTabs(tab);
  }
  destination.focus();
  destination.gBrowser.selectedBrowser?.focus();
  if (decision.closeSourceWindow && !environment.sourceWindow.closed) {
    environment.sourceWindow.close();
  }
  return destination;
};

// Zen 1.21.16b omni.ja: ZenSpaceManager.mjs 608–685; ZenWindowSync.sys.mjs 1281–1333; tabbrowser.js 6649–6735, 7173–7256, 7890–7972.
export const toggleSelectedTabsIsolation = async (
  environment = liveEnvironment(),
): Promise<WindowToggleWindow | null> => {
  const source = environment.sourceWindow;
  const browser = source.gBrowser;
  const activeTab = browser.selectedTab;
  const tabIds = new Map(browser.tabs.map((tab, index) => [tab, `tab-${String(index)}`]));
  const tabsById = new Map([...tabIds].map(([tab, id]) => [id, tab]));
  const activeId = activeTab ? (tabIds.get(activeTab) ?? null) : null;
  const workspaceId = source.gZenWorkspaces.activeWorkspace;
  const sourceWorkspaceIndex = source.gZenWorkspaces
    .getWorkspaces()
    .findIndex(workspace => workspace.uuid === workspaceId);
  const isolatedWindows = environment.browserWindows.filter(
    candidate =>
      !candidate.closed &&
      isUnsynced(candidate) &&
      !environment.isPrivateWindow(candidate),
  );
  const sourceUnsynced = isUnsynced(source);
  const decision = decideWindowToggle({
    activeId,
    currentSpaceTabIds: browser.tabs
      .filter(
        tab =>
          !tab.pinned &&
          !tab.hasAttribute("zen-empty-tab") &&
          (!workspaceId || tab.getAttribute("zen-workspace-id") === workspaceId),
      )
      .map(tab => tabIds.get(tab) as string),
    hasMultiSelection: browser.multiSelectedTabsCount > 0,
    isolatedWindowCount: isolatedWindows.length,
    privateWindow: environment.isPrivateWindow(source),
    realTabIds: browser.tabs
      .filter(tab => !tab.hasAttribute("zen-empty-tab"))
      .map(tab => tabIds.get(tab) as string),
    selectedIds: browser.selectedTabs.flatMap(tab => {
      const id = tabIds.get(tab);
      return id ? [id] : [];
    }),
    sharedWindowAvailable: Boolean(environment.firstSharedWindow),
    sourceUnsynced,
    tabs: browser.tabs.map(tab => ({
      essential: tab.hasAttribute("zen-essential"),
      grouped: Boolean(tab.group),
      id: tabIds.get(tab) as string,
      split: Boolean(tab.splitview),
    })),
  });
  if (decision.kind === "blocked" || !activeTab || !activeId) return null;

  const movingTabs = decision.tabIds.map(
    id => tabsById.get(id) as WindowTogglePlatformTab,
  );
  if (decision.destination === "new-isolated" || decision.destination === "new-shared") {
    return createDestinationWindow(environment, decision, activeId, activeTab);
  }
  const destination =
    decision.destination === "existing-isolated"
      ? (isolatedWindows[0] ?? null)
      : environment.firstSharedWindow;
  if (!destination) return null;
  return moveIntoExistingWindow(
    environment,
    decision,
    destination,
    movingTabs,
    activeTab,
    sourceWorkspaceIndex,
  );
};
