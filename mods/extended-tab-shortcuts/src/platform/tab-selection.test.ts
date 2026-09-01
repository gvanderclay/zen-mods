import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserTabSelectionPort } from "./tab-selection.ts";

class FakeTab {
  group: FakeGroup | null = null;
  multiselected = false;
  pinned = false;
  selected = false;
  bounds = { bottom: 60, height: 40, top: 20 };
  scrollIntoView = vi.fn();

  getBoundingClientRect() {
    return this.bounds;
  }

  hasAttribute() {
    return false;
  }
}

class FakeGroup {
  activeTabs: FakeTab[] = [];
  collapsed = false;
  group: FakeGroup | null = null;
}

class FakeBrowser extends EventTarget {
  readonly addToMultiSelectedTabs = vi.fn((tab: FakeTab) => {
    tab.multiselected = true;
  });
  readonly clearMultiSelectedTabs = vi.fn(() => {
    for (const tab of this.tabs) tab.multiselected = false;
  });
  readonly removeFromMultiSelectedTabs = vi.fn((tab: FakeTab) => {
    tab.multiselected = false;
  });
  readonly tabContainer = Object.assign(new EventTarget(), {
    arrowScrollbox: {
      getBoundingClientRect: () => ({ bottom: 100, height: 100, top: 0 }),
      overflowing: true,
    },
  });

  constructor(
    readonly tabs: FakeTab[],
    readonly selectedTab: FakeTab,
  ) {
    super();
    selectedTab.selected = true;
  }

  get multiSelectedTabsCount() {
    return this.tabs.filter(tab => tab.multiselected).length;
  }

  get selectedTabs() {
    const multiselected = this.tabs.filter(tab => tab.multiselected);
    return multiselected.length > 0 ? multiselected : [this.selectedTab];
  }

  get visibleTabs() {
    return this.tabs;
  }
}

beforeEach(() => {
  vi.stubGlobal("gZenWorkspaces", { activeWorkspaceElement: undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser tab selection port", () => {
  it("centers a clipped tab but leaves a visible tab in place", () => {
    const [active, visible, clipped] = [new FakeTab(), new FakeTab(), new FakeTab()];
    clipped.bounds = { bottom: 160, height: 40, top: 120 };
    const browser = new FakeBrowser([active, visible, clipped], active);
    vi.stubGlobal("gBrowser", browser);
    const port = createBrowserTabSelectionPort();
    const snapshot = port.read();

    port.revealTab(snapshot.visibleIds[1] as string);
    port.revealTab(snapshot.visibleIds[2] as string);

    expect(visible.scrollIntoView).not.toHaveBeenCalled();
    expect(clipped.scrollIntoView).toHaveBeenCalledWith({
      behavior: "instant",
      block: "center",
    });
  });

  it("reads visual order while excluding a multiselected tab in a collapsed folder", () => {
    const [first, active, collapsed, last] = [
      new FakeTab(),
      new FakeTab(),
      new FakeTab(),
      new FakeTab(),
    ];
    const group = new FakeGroup();
    group.collapsed = true;
    collapsed.group = group;
    active.multiselected = true;
    collapsed.multiselected = true;
    const browser = new FakeBrowser([first, active, collapsed, last], active);
    vi.stubGlobal("gBrowser", browser);

    const snapshot = createBrowserTabSelectionPort().read();

    expect(snapshot.visibleIds).toHaveLength(3);
    expect(snapshot.visibleIds[1]).toBe(snapshot.activeId);
    expect(snapshot.selectedIds).toHaveLength(2);
    expect(snapshot.selectedIds).toContain(snapshot.activeId);
    expect(snapshot.visibleIds).not.toContain(
      snapshot.selectedIds.find(id => id !== snapshot.activeId),
    );
  });

  it("excludes multiselected pinned tabs when the pinned section is collapsed", () => {
    const [active, collapsedPinned, next] = [new FakeTab(), new FakeTab(), new FakeTab()];
    active.multiselected = true;
    collapsedPinned.multiselected = true;
    collapsedPinned.pinned = true;
    const browser = new FakeBrowser([active, collapsedPinned, next], active);
    vi.stubGlobal("gBrowser", browser);
    vi.stubGlobal("gZenWorkspaces", {
      activeWorkspaceElement: {
        collapsiblePins: { activeTabs: [] },
        hasCollapsedPinnedTabs: true,
      },
    });

    const snapshot = createBrowserTabSelectionPort().read();

    expect(snapshot.visibleIds).toHaveLength(2);
    expect(snapshot.selectedIds).toHaveLength(2);
    expect(snapshot.visibleIds).not.toContain(
      snapshot.selectedIds.find(id => id !== snapshot.activeId),
    );
  });

  it("keeps keyboard selection inside the active tab's pinned section", () => {
    const [firstPinned, secondPinned, active, next] = [
      new FakeTab(),
      new FakeTab(),
      new FakeTab(),
      new FakeTab(),
    ];
    firstPinned.pinned = true;
    secondPinned.pinned = true;
    const ordinaryBrowser = new FakeBrowser(
      [firstPinned, secondPinned, active, next],
      active,
    );
    vi.stubGlobal("gBrowser", ordinaryBrowser);

    const ordinarySnapshot = createBrowserTabSelectionPort().read();

    expect(ordinarySnapshot.visibleIds).toHaveLength(2);
    expect(ordinarySnapshot.visibleIds[0]).toBe(ordinarySnapshot.activeId);

    const pinnedBrowser = new FakeBrowser(
      [firstPinned, secondPinned, active, next],
      firstPinned,
    );
    vi.stubGlobal("gBrowser", pinnedBrowser);

    const pinnedSnapshot = createBrowserTabSelectionPort().read();

    expect(pinnedSnapshot.visibleIds).toHaveLength(2);
    expect(pinnedSnapshot.visibleIds[0]).toBe(pinnedSnapshot.activeId);
  });

  it("applies an exact range without changing the active tab", () => {
    const [first, active, next, last] = [
      new FakeTab(),
      new FakeTab(),
      new FakeTab(),
      new FakeTab(),
    ];
    first.multiselected = true;
    active.multiselected = true;
    last.multiselected = true;
    const browser = new FakeBrowser([first, active, next, last], active);
    vi.stubGlobal("gBrowser", browser);
    const port = createBrowserTabSelectionPort();
    const snapshot = port.read();

    port.applySelection([snapshot.activeId as string, snapshot.visibleIds[2] as string]);

    expect(browser.removeFromMultiSelectedTabs).toHaveBeenCalledTimes(2);
    expect(browser.removeFromMultiSelectedTabs).toHaveBeenCalledWith(first);
    expect(browser.removeFromMultiSelectedTabs).toHaveBeenCalledWith(last);
    expect(browser.addToMultiSelectedTabs).toHaveBeenCalledOnce();
    expect(browser.addToMultiSelectedTabs).toHaveBeenCalledWith(next);
    expect(browser.selectedTab).toBe(active);
  });

  it("forwards browser selection events and removes owned listeners", () => {
    const active = new FakeTab();
    active.multiselected = true;
    const browser = new FakeBrowser([active], active);
    vi.stubGlobal("gBrowser", browser);
    const port = createBrowserTabSelectionPort();
    const onSelection = vi.fn();
    const onActive = vi.fn();
    const removeSelection = port.onSelectionChange(onSelection);
    const removeActive = port.onActiveChange(onActive);

    browser.dispatchEvent(new Event("TabMultiSelect"));
    browser.tabContainer.dispatchEvent(new Event("TabSelect"));
    port.clearSelection();
    expect(onSelection).toHaveBeenCalledOnce();
    expect(onActive).toHaveBeenCalledOnce();
    expect(browser.clearMultiSelectedTabs).toHaveBeenCalledOnce();

    removeSelection();
    removeActive();
    browser.dispatchEvent(new Event("TabMultiSelect"));
    browser.tabContainer.dispatchEvent(new Event("TabSelect"));
    expect(onSelection).toHaveBeenCalledOnce();
    expect(onActive).toHaveBeenCalledOnce();
  });
});
