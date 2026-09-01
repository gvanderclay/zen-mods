import type { TabSelectionPort, TabSelectionSnapshot } from "../tab-selection.ts";

interface BrowserTabGroup {
  readonly activeTabs?: readonly BrowserTab[];
  readonly collapsed: boolean;
  readonly group: BrowserTabGroup | null;
}

interface BrowserTab {
  readonly group: BrowserTabGroup | null;
  readonly multiselected: boolean;
  readonly pinned: boolean;
  readonly selected: boolean;
  getBoundingClientRect(): {
    readonly bottom: number;
    readonly height: number;
    readonly top: number;
  };
  hasAttribute(name: string): boolean;
  scrollIntoView(options: { behavior: "instant"; block: "center" }): void;
}

interface TabSelectionViewport {
  getBoundingClientRect(): { readonly bottom: number; readonly top: number };
}

interface TabSelectionScrollbox extends TabSelectionViewport {
  readonly overflowing: boolean;
  readonly scrollbox?: TabSelectionViewport;
}

interface TabSelectionBrowser extends EventTarget {
  readonly multiSelectedTabsCount: number;
  readonly selectedTab: BrowserTab | null;
  readonly selectedTabs: readonly BrowserTab[];
  readonly tabContainer: EventTarget & {
    readonly arrowScrollbox: TabSelectionScrollbox;
  };
  readonly visibleTabs: readonly BrowserTab[];
  addToMultiSelectedTabs(tab: BrowserTab): void;
  clearMultiSelectedTabs(): void;
  removeFromMultiSelectedTabs(tab: BrowserTab): void;
}

// Zen 1.21.16b: tabs.js 862–972 and tabbrowser.js 8129–8403.
const hiddenByCollapsedGroup = (tab: BrowserTab): boolean => {
  if (tab.selected) return false;
  let group = tab.group;
  while (group) {
    if (group.collapsed && !group.activeTabs?.includes(tab)) return true;
    group = group.group;
  }
  const workspace = gZenWorkspaces.activeWorkspaceElement;
  if (
    tab.pinned &&
    !tab.hasAttribute("zen-essential") &&
    workspace?.hasCollapsedPinnedTabs &&
    !workspace.collapsiblePins?.activeTabs?.includes(tab)
  ) {
    return true;
  }
  return false;
};

export const createBrowserTabSelectionPort = (): TabSelectionPort => {
  const browser = gBrowser as unknown as TabSelectionBrowser;
  const ids = new WeakMap<BrowserTab, string>();
  const tabsById = new Map<string, BrowserTab>();
  let nextId = 1;

  const idFor = (tab: BrowserTab): string => {
    let id = ids.get(tab);
    if (!id) {
      id = `tab-${nextId++}`;
      ids.set(tab, id);
    }
    tabsById.set(id, tab);
    return id;
  };

  const read = (): TabSelectionSnapshot => {
    const activeTab = browser.selectedTab;
    const visibleTabs = browser.visibleTabs.filter(
      tab =>
        !hiddenByCollapsedGroup(tab) && (!activeTab || tab.pinned === activeTab.pinned),
    );
    const activeId = activeTab ? idFor(activeTab) : null;
    return {
      activeId,
      hasMultiSelection: browser.multiSelectedTabsCount > 0,
      selectedIds: browser.selectedTabs.map(idFor),
      visibleIds: visibleTabs.map(idFor),
    };
  };

  return {
    read,
    applySelection(selectionIds) {
      const desiredTabs: BrowserTab[] = [];
      for (const id of selectionIds) {
        const tab = tabsById.get(id);
        if (!tab) {
          throw new Error("tab selection changed before it could be applied");
        }
        desiredTabs.push(tab);
      }
      const desiredIds = new Set(selectionIds);
      for (const tab of browser.selectedTabs) {
        if (tab.multiselected && !desiredIds.has(idFor(tab))) {
          browser.removeFromMultiSelectedTabs(tab);
        }
      }
      if (desiredTabs.length > 1) {
        for (const tab of desiredTabs) {
          if (!tab.multiselected) browser.addToMultiSelectedTabs(tab);
        }
      }
    },
    clearSelection: () => browser.clearMultiSelectedTabs(),
    revealTab(id) {
      const tab = tabsById.get(id);
      const scrollbox = browser.tabContainer.arrowScrollbox;
      if (!tab || tab.pinned || !scrollbox.overflowing) return;
      const viewport = scrollbox.scrollbox ?? scrollbox;
      const viewportBounds = viewport.getBoundingClientRect();
      const tabBounds = tab.getBoundingClientRect();
      if (
        tabBounds.height <= 0 ||
        (tabBounds.top >= viewportBounds.top - 1 &&
          tabBounds.bottom <= viewportBounds.bottom + 1)
      ) {
        return;
      }
      // Zen 1.21.16b: tabs.js 67–100, 1462–1469; arrowscrollbox.js 290–330.
      tab.scrollIntoView({ behavior: "instant", block: "center" });
    },
    onActiveChange(listener) {
      browser.tabContainer.addEventListener("TabSelect", listener);
      return () => browser.tabContainer.removeEventListener("TabSelect", listener);
    },
    onSelectionChange(listener) {
      browser.addEventListener("TabMultiSelect", listener);
      return () => browser.removeEventListener("TabMultiSelect", listener);
    },
  };
};
