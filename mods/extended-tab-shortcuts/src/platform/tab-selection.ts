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
  hasAttribute(name: string): boolean;
}

interface TabSelectionBrowser extends EventTarget {
  readonly multiSelectedTabsCount: number;
  readonly selectedTab: BrowserTab | null;
  readonly selectedTabs: readonly BrowserTab[];
  readonly tabContainer: EventTarget;
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
