import { describe, expect, it, vi } from "vitest";
import { toggleSelectedTabsIsolation } from "./browser.ts";
import type {
  WindowToggleBrowser,
  WindowToggleEnvironment,
  WindowTogglePlatformTab,
  WindowToggleWindow,
} from "./browser-types.ts";

class FakeTab implements WindowTogglePlatformTab {
  group: object | null = null;
  multiselected = false;
  pinned = false;
  splitview: object | null = null;

  constructor(
    readonly id: string,
    public workspaceId = "space-a",
    private readonly attributes = new Set<string>(),
  ) {}

  getAttribute(name: string) {
    return name === "zen-workspace-id" ? this.workspaceId : null;
  }

  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
}

const createWindow = (
  id: string,
  tabs: FakeTab[],
  { unsynced = false }: { unsynced?: boolean } = {},
) => {
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
  const browser: WindowToggleBrowser = {
    addTab: vi.fn(() => {
      const tab = new FakeTab(`${id}-empty`);
      tabs.push(tab);
      return tab;
    }),
    addToMultiSelectedTabs: vi.fn(),
    adoptTab: vi.fn(tab => {
      const adopted = new FakeTab(
        `adopted-${tab.id}`,
        tab.getAttribute("zen-workspace-id") ?? "",
      );
      adopted.pinned = tab.pinned;
      tabs.push(adopted);
      return adopted;
    }),
    clearMultiSelectedTabs: vi.fn(),
    multiSelectedTabsCount: 0,
    get pinnedTabCount() {
      return tabs.filter(tab => tab.pinned).length;
    },
    moveTabTo: vi.fn(),
    removeTab: vi.fn(tab => {
      const index = tabs.indexOf(tab as FakeTab);
      if (index >= 0) tabs.splice(index, 1);
    }),
    replaceTabsWithWindow: vi.fn(),
    selectedBrowser: { focus: vi.fn() },
    selectedTab: tabs[1] ?? tabs[0] ?? null,
    selectedTabs: tabs[1] ? [tabs[1]] : tabs[0] ? [tabs[0]] : [],
    tabContainer: { _invalidateCachedTabs: vi.fn() },
    tabs,
    zenHandleTabMove: vi.fn((_tab, move) => move()),
  };
  const workspaces = {
    activeWorkspace: "space-a",
    changeWorkspaceWithID: vi.fn(async () => {}),
    getWorkspaces: vi.fn(() => [{ uuid: workspaces.activeWorkspace }]),
    lastSelectedWorkspaceTabs: {},
    moveTabToWorkspace: vi.fn((tab: WindowTogglePlatformTab, workspaceId: string) => {
      (tab as FakeTab).workspaceId = workspaceId;
      return true;
    }),
    workspaceElement: vi.fn(() => destinationElement),
  };
  const attributes = new Set(unsynced ? ["zen-unsynced-window"] : []);
  let target: WindowToggleWindow;
  target = {
    _zenStartupSyncFlag: "unsynced",
    addEventListener: vi.fn(),
    close: vi.fn(() => {
      target.closed = true;
    }),
    closed: false,
    document: {
      documentElement: {
        hasAttribute: (name: string) => attributes.has(name),
      },
    },
    focus: vi.fn(),
    gBrowser: browser,
    gZenWorkspaces: workspaces,
    setTimeout: vi.fn((callback: () => void) => {
      callback();
      return 1;
    }),
  };
  return {
    browser,
    ordinaryEnd,
    ordinaryInsertBefore,
    pinnedEnd,
    pinnedInsertBefore,
    tabs,
    window: target,
    workspaces,
  };
};

const createFixture = ({ unsynced = false }: { unsynced?: boolean } = {}) => {
  const source = createWindow(
    "source",
    [new FakeTab("a"), new FakeTab("b"), new FakeTab("c")],
    { unsynced },
  );
  const environment: WindowToggleEnvironment = {
    browserWindows: [source.window],
    firstSharedWindow: unsynced ? null : source.window,
    isPrivateWindow: vi.fn(() => false),
    sourceWindow: source.window,
    triggeringPrincipal: {},
  };
  return { environment, source };
};

describe("toggleSelectedTabsIsolation", () => {
  it("creates and focuses an unsynced window when none exists", async () => {
    const { environment, source } = createFixture();
    const created = createWindow("created", [new FakeTab("created-active")]);
    vi.mocked(source.browser.replaceTabsWithWindow).mockReturnValue(created.window);

    expect(await toggleSelectedTabsIsolation(environment)).toBe(created.window);

    expect(source.browser.replaceTabsWithWindow).toHaveBeenCalledWith(source.tabs[1], {});
    expect(created.window._zenStartupSyncFlag).toBe("unsynced");
    expect(created.window.focus).toHaveBeenCalledOnce();
  });

  it("moves the ordered selection into isolatedWindows[0]", async () => {
    const { environment, source } = createFixture();
    const first = createWindow("first", [new FakeTab("first-anchor")], {
      unsynced: true,
    });
    const second = createWindow("second", [new FakeTab("second-anchor")], {
      unsynced: true,
    });
    first.workspaces.activeWorkspace = "first-space";
    source.browser.selectedTabs = [source.tabs[1] as FakeTab, source.tabs[0] as FakeTab];
    source.browser.multiSelectedTabsCount = 2;
    environment.browserWindows = [source.window, first.window, second.window];

    expect(await toggleSelectedTabsIsolation(environment)).toBe(first.window);

    expect(first.browser.adoptTab).toHaveBeenNthCalledWith(1, source.tabs[0], {
      tabIndex: Number.POSITIVE_INFINITY,
    });
    expect(first.browser.adoptTab).toHaveBeenNthCalledWith(2, source.tabs[1], {
      tabIndex: Number.POSITIVE_INFINITY,
    });
    expect(second.browser.adoptTab).not.toHaveBeenCalled();
    const adoptedA = vi.mocked(first.browser.adoptTab).mock.results[0]?.value;
    const adoptedB = vi.mocked(first.browser.adoptTab).mock.results[1]?.value;
    expect(first.workspaces.moveTabToWorkspace).toHaveBeenNthCalledWith(
      1,
      adoptedA,
      "first-space",
    );
    expect(first.ordinaryInsertBefore).toHaveBeenNthCalledWith(
      1,
      adoptedA,
      first.ordinaryEnd,
    );
    expect(first.ordinaryInsertBefore).toHaveBeenNthCalledWith(
      2,
      adoptedB,
      first.ordinaryEnd,
    );
    expect(first.browser.selectedTab).toBe(adoptedB);
    expect(first.browser.addToMultiSelectedTabs).toHaveBeenNthCalledWith(1, adoptedA);
    expect(first.browser.addToMultiSelectedTabs).toHaveBeenNthCalledWith(2, adoptedB);
    expect(first.window.focus).toHaveBeenCalledOnce();
  });

  it("appends a pinned tab to the destination pinned section", async () => {
    const { environment, source } = createFixture();
    const pinnedAnchor = new FakeTab("pinned-anchor");
    pinnedAnchor.pinned = true;
    const isolated = createWindow("isolated", [pinnedAnchor], { unsynced: true });
    const active = source.tabs[1] as FakeTab;
    active.pinned = true;
    environment.browserWindows = [source.window, isolated.window];

    expect(await toggleSelectedTabsIsolation(environment)).toBe(isolated.window);

    expect(isolated.browser.adoptTab).toHaveBeenCalledWith(active, { tabIndex: 1 });
    const adopted = vi.mocked(isolated.browser.adoptTab).mock.results[0]?.value;
    expect(isolated.pinnedInsertBefore).toHaveBeenCalledWith(adopted, isolated.pinnedEnd);
  });

  it("merges the active tab into the existing shared window", async () => {
    const { environment, source } = createFixture({ unsynced: true });
    const shared = createWindow("shared", [new FakeTab("shared-anchor")]);
    environment.browserWindows = [source.window, shared.window];
    environment.firstSharedWindow = shared.window;

    expect(await toggleSelectedTabsIsolation(environment)).toBe(shared.window);

    expect(shared.browser.adoptTab).toHaveBeenCalledWith(source.tabs[1], {
      tabIndex: Number.POSITIVE_INFINITY,
    });
    expect(shared.workspaces.changeWorkspaceWithID).toHaveBeenCalledWith("space-a");
    expect(source.window.close).not.toHaveBeenCalled();
    expect(shared.window.focus).toHaveBeenCalledOnce();
  });

  it("closes an isolated window after its last real tabs merge", async () => {
    const { environment, source } = createFixture({ unsynced: true });
    const shared = createWindow("shared", [new FakeTab("shared-anchor")]);
    source.browser.selectedTabs = [...source.tabs];
    source.browser.multiSelectedTabsCount = source.tabs.length;
    environment.firstSharedWindow = shared.window;

    expect(await toggleSelectedTabsIsolation(environment)).toBe(shared.window);

    expect(source.browser.addTab).not.toHaveBeenCalled();
    expect(source.window.close).toHaveBeenCalledOnce();
  });

  it("creates a synced shared window when none exists", async () => {
    const { environment, source } = createFixture({ unsynced: true });
    const created = createWindow("created", [new FakeTab("created-active")]);
    source.browser.selectedTabs = [...source.tabs];
    source.browser.multiSelectedTabsCount = source.tabs.length;
    vi.mocked(source.browser.replaceTabsWithWindow).mockReturnValue(created.window);

    expect(await toggleSelectedTabsIsolation(environment)).toBe(created.window);

    expect(source.browser.addTab).toHaveBeenCalledOnce();
    expect(created.window._zenStartupSyncFlag).toBe("synced");
    const adoptionListeners = vi
      .mocked(created.window.addEventListener)
      .mock.calls.filter(([type]) => type === "before-initial-tab-adopted")
      .map(([, listener]) => listener);
    expect(adoptionListeners).toHaveLength(2);
    for (const listener of adoptionListeners) listener();
    expect(source.window.close).toHaveBeenCalledOnce();
  });

  it("keeps an isolated source open with an empty current-space tab", async () => {
    const { environment, source } = createFixture({ unsynced: true });
    const otherSpaceTab = new FakeTab("other-space", "space-b");
    source.tabs.push(otherSpaceTab);
    source.browser.selectedTab = source.tabs[1] as FakeTab;
    source.browser.selectedTabs = source.tabs.slice(0, 3);
    source.browser.multiSelectedTabsCount = 3;
    const shared = createWindow("shared", [new FakeTab("shared-anchor")]);
    environment.firstSharedWindow = shared.window;

    expect(await toggleSelectedTabsIsolation(environment)).toBe(shared.window);

    expect(source.browser.addTab).toHaveBeenCalledOnce();
    expect(source.window.close).not.toHaveBeenCalled();
  });

  it("restores the active tab position after native window creation", async () => {
    const { environment, source } = createFixture();
    const sentinel = new FakeTab("sentinel", "space-a", new Set(["zen-empty-tab"]));
    const created = createWindow("created", [
      sentinel,
      new FakeTab("created-active"),
      new FakeTab("created-next"),
    ]);
    source.browser.selectedTabs = [source.tabs[1] as FakeTab, source.tabs[0] as FakeTab];
    source.browser.multiSelectedTabsCount = 2;
    vi.mocked(source.browser.replaceTabsWithWindow).mockReturnValue(created.window);

    await toggleSelectedTabsIsolation(environment);
    const adoptionListener = vi
      .mocked(created.window.addEventListener)
      .mock.calls.find(([type]) => type === "before-initial-tab-adopted")?.[1];
    adoptionListener?.();
    const paintListener = vi
      .mocked(created.window.addEventListener)
      .mock.calls.find(([type]) => type === "MozAfterPaint")?.[1];
    paintListener?.();

    expect(created.browser.moveTabTo).toHaveBeenCalledWith(created.browser.selectedTab, {
      tabIndex: 2,
    });
  });

  it("removes a provisional source tab when native window creation declines", async () => {
    const { environment, source } = createFixture();
    source.browser.selectedTabs = [...source.tabs];
    source.browser.multiSelectedTabsCount = source.tabs.length;
    vi.mocked(source.browser.replaceTabsWithWindow).mockReturnValue(null);

    expect(await toggleSelectedTabsIsolation(environment)).toBeNull();

    const provisional = vi.mocked(source.browser.addTab).mock.results[0]?.value;
    expect(source.browser.removeTab).toHaveBeenCalledWith(provisional, {
      animate: false,
    });
  });

  it("does nothing for private windows or unsupported selections", async () => {
    const privateFixture = createFixture();
    vi.mocked(privateFixture.environment.isPrivateWindow).mockReturnValue(true);
    expect(await toggleSelectedTabsIsolation(privateFixture.environment)).toBeNull();
    expect(privateFixture.source.browser.replaceTabsWithWindow).not.toHaveBeenCalled();

    const essentialFixture = createFixture();
    const active = essentialFixture.source.tabs[1];
    if (!active) throw new Error("missing active tab fixture");
    active.hasAttribute = name => name === "zen-essential";
    expect(await toggleSelectedTabsIsolation(essentialFixture.environment)).toBeNull();
    expect(essentialFixture.source.browser.replaceTabsWithWindow).not.toHaveBeenCalled();
    expect(essentialFixture.source.browser.adoptTab).not.toHaveBeenCalled();
  });
});
