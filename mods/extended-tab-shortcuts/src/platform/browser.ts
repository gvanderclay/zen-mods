import { decidePopOut } from "../core/pop-out.ts";

export interface PopOutPlatformTab {
  group: object | null;
  multiselected: boolean;
  pinned: boolean;
  splitview: object | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

export interface PopOutDestinationWindow {
  _zenStartupSyncFlag?: "synced" | "unsynced";
  addEventListener(
    type: "MozAfterPaint" | "before-initial-tab-adopted",
    listener: () => void,
    options: { once: boolean },
  ): void;
  gBrowser: {
    selectedTab: PopOutPlatformTab | null;
    tabs: readonly PopOutPlatformTab[];
    moveTabTo(tab: PopOutPlatformTab, options: { tabIndex: number }): void;
  };
  setTimeout(callback: () => void, delay: number): number;
  focus(): void;
}

export interface PopOutBrowser {
  tabs: readonly PopOutPlatformTab[];
  selectedTab: PopOutPlatformTab | null;
  selectedTabs: readonly PopOutPlatformTab[];
  multiSelectedTabsCount: number;
  addTab(
    url: string,
    options: {
      inBackground: boolean;
      skipAnimation: boolean;
      triggeringPrincipal: unknown;
    },
  ): PopOutPlatformTab | null;
  removeTab(tab: PopOutPlatformTab, options: { animate: boolean }): void;
  replaceTabsWithWindow(
    tab: PopOutPlatformTab,
    options: Record<string, unknown>,
  ): PopOutDestinationWindow | null | undefined;
}

export interface PopOutEnvironment {
  activeWorkspaceId: string;
  browser: PopOutBrowser;
  privateWindow: boolean;
  triggeringPrincipal: unknown;
}

const liveEnvironment = (): PopOutEnvironment => ({
  activeWorkspaceId: gZenWorkspaces.activeWorkspace,
  browser: gBrowser as unknown as PopOutBrowser,
  privateWindow: PrivateBrowsingUtils.isWindowPrivate(window),
  triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
});

// Zen 1.21.16b omni.ja: browser-init.js 378–438; tabbrowser.js 7138–7256, 7355–7437; ZenWindowSync.sys.mjs 208–255.
export const popOutSelectedTabs = (
  environment = liveEnvironment(),
): PopOutDestinationWindow | null => {
  const { activeWorkspaceId, browser } = environment;
  const activeTab = browser.selectedTab;
  const tabIds = new Map(browser.tabs.map((tab, index) => [tab, `tab-${String(index)}`]));
  const activeId = activeTab ? (tabIds.get(activeTab) ?? null) : null;
  const decision = decidePopOut({
    activeId,
    currentSpaceTabIds: browser.tabs
      .filter(
        tab =>
          !tab.pinned &&
          !tab.hasAttribute("zen-empty-tab") &&
          (!activeWorkspaceId ||
            tab.getAttribute("zen-workspace-id") === activeWorkspaceId),
      )
      .map(tab => tabIds.get(tab) as string),
    hasMultiSelection: browser.multiSelectedTabsCount > 0,
    privateWindow: environment.privateWindow,
    selectedIds: browser.selectedTabs.flatMap(tab => {
      const id = tabIds.get(tab);
      return id ? [id] : [];
    }),
    tabs: browser.tabs.map(tab => ({
      essential: tab.hasAttribute("zen-essential"),
      grouped: Boolean(tab.group),
      id: tabIds.get(tab) as string,
      split: Boolean(tab.splitview),
    })),
  });
  if (decision.kind === "blocked" || !activeTab) {
    return null;
  }

  let provisionalTab: PopOutPlatformTab | null = null;
  if (decision.createSourceTab) {
    provisionalTab = browser.addTab("about:newtab", {
      inBackground: true,
      skipAnimation: true,
      triggeringPrincipal: environment.triggeringPrincipal,
    });
    if (!provisionalTab) return null;
  }

  try {
    const destination = browser.replaceTabsWithWindow(activeTab, {});
    if (!destination) {
      if (provisionalTab) {
        browser.removeTab(provisionalTab, { animate: false });
      }
      return null;
    }
    destination._zenStartupSyncFlag = "unsynced";
    const activeIndex = decision.tabIds.indexOf(activeId as string);
    if (activeIndex > 0) {
      destination.addEventListener(
        "before-initial-tab-adopted",
        () => {
          destination.addEventListener(
            "MozAfterPaint",
            () => {
              destination.setTimeout(() => {
                const destinationActive = destination.gBrowser.selectedTab;
                if (destinationActive) {
                  const firstTabIndex = destination.gBrowser.tabs.findIndex(
                    tab => !tab.hasAttribute("zen-empty-tab"),
                  );
                  destination.gBrowser.moveTabTo(destinationActive, {
                    tabIndex: Math.max(0, firstTabIndex) + activeIndex,
                  });
                }
              }, 0);
            },
            { once: true },
          );
        },
        { once: true },
      );
    }
    destination.focus();
    return destination;
  } catch (error) {
    if (provisionalTab) {
      browser.removeTab(provisionalTab, { animate: false });
    }
    throw error;
  }
};
