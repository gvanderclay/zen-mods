import { describe, expect, it, vi } from "vitest";
import {
  type PopOutBrowser,
  type PopOutEnvironment,
  type PopOutPlatformTab,
  popOutSelectedTabs,
} from "./browser.ts";

class FakeTab implements PopOutPlatformTab {
  group: object | null = null;
  multiselected = false;
  pinned = false;
  splitview: object | null = null;

  constructor(
    readonly id: string,
    private readonly workspaceId = "space-a",
  ) {}

  getAttribute(name: string) {
    return name === "zen-workspace-id" ? this.workspaceId : null;
  }

  hasAttribute(_name: string) {
    return false;
  }
}

const createFixture = () => {
  const tabs = [new FakeTab("a"), new FakeTab("b"), new FakeTab("c")];
  const destinationTab = new FakeTab("destination-active");
  const destination = {
    _zenStartupSyncFlag: "synced" as "synced" | "unsynced",
    addEventListener: vi.fn(),
    focus: vi.fn(),
    gBrowser: {
      moveTabTo: vi.fn(),
      selectedTab: destinationTab,
      tabs: [destinationTab],
    },
    gZenStartup: { promiseInitialized: Promise.resolve() },
    queueMicrotask: vi.fn((callback: () => void) => callback()),
    setTimeout: vi.fn((callback: () => void) => {
      callback();
      return 1;
    }),
  };
  const browser: PopOutBrowser = {
    tabs,
    selectedTab: tabs[1] as FakeTab,
    selectedTabs: [tabs[1] as FakeTab],
    multiSelectedTabsCount: 0,
    addTab: vi.fn(() => new FakeTab("empty")),
    removeTab: vi.fn(),
    replaceTabsWithWindow: vi.fn(() => destination),
  };
  const environment: PopOutEnvironment = {
    activeWorkspaceId: "space-a",
    browser,
    privateWindow: false,
    triggeringPrincipal: {},
  };
  return { browser, destination, environment, tabs };
};

describe("popOutSelectedTabs", () => {
  it("moves the active tab into a focused unsynced window", () => {
    const { browser, destination, environment, tabs } = createFixture();

    const result = popOutSelectedTabs(environment);

    expect(browser.replaceTabsWithWindow).toHaveBeenCalledWith(tabs[1], {});
    expect(browser.addTab).not.toHaveBeenCalled();
    expect(destination._zenStartupSyncFlag).toBe("unsynced");
    expect(destination.focus).toHaveBeenCalledOnce();
    expect(result).toBe(destination);
  });

  it("leaves an empty source tab when the complete current space moves", () => {
    const { browser, destination, environment, tabs } = createFixture();
    for (const tab of tabs) tab.multiselected = true;
    browser.selectedTabs = tabs;
    browser.multiSelectedTabsCount = tabs.length;

    popOutSelectedTabs(environment);

    expect(browser.addTab).toHaveBeenCalledWith("about:newtab", {
      inBackground: true,
      skipAnimation: true,
      triggeringPrincipal: environment.triggeringPrincipal,
    });
    expect(browser.removeTab).not.toHaveBeenCalled();
    expect(destination._zenStartupSyncFlag).toBe("unsynced");
  });

  it("ignores Zen's internal empty-tab sentinel when preserving the source", () => {
    const { browser, environment, tabs } = createFixture();
    const sentinel = new FakeTab("sentinel");
    sentinel.hasAttribute = name => name === "zen-empty-tab";
    browser.tabs = [sentinel, ...tabs];
    for (const tab of tabs) tab.multiselected = true;
    browser.selectedTabs = tabs;
    browser.multiSelectedTabsCount = tabs.length;

    popOutSelectedTabs(environment);

    expect(browser.addTab).toHaveBeenCalledOnce();
  });

  it("detaches the original active tab when source-tab creation changes selection", () => {
    const { browser, environment, tabs } = createFixture();
    for (const tab of tabs) tab.multiselected = true;
    browser.selectedTabs = tabs;
    browser.multiSelectedTabsCount = tabs.length;
    vi.mocked(browser.addTab).mockImplementation(() => {
      browser.selectedTab = tabs[0] as FakeTab;
      return new FakeTab("empty");
    });

    popOutSelectedTabs(environment);

    expect(browser.replaceTabsWithWindow).toHaveBeenCalledWith(tabs[1], {});
  });

  it("restores the active tab's sidebar position after native adoption", async () => {
    const { browser, destination, environment, tabs } = createFixture();
    const sentinel = new FakeTab("sentinel");
    sentinel.hasAttribute = name => name === "zen-empty-tab";
    destination.gBrowser.tabs = [
      sentinel,
      destination.gBrowser.selectedTab,
      new FakeTab("destination-next"),
    ];
    for (const tab of tabs) tab.multiselected = true;
    browser.selectedTabs = [tabs[1] as FakeTab, tabs[0] as FakeTab, tabs[2] as FakeTab];
    browser.multiSelectedTabsCount = tabs.length;

    popOutSelectedTabs(environment);
    const adoptionListener = vi
      .mocked(destination.addEventListener)
      .mock.calls.find(([type]) => type === "before-initial-tab-adopted")?.[1];
    expect(adoptionListener).toBeTypeOf("function");
    adoptionListener?.();
    const paintListener = vi
      .mocked(destination.addEventListener)
      .mock.calls.find(([type]) => type === "MozAfterPaint")?.[1];
    expect(paintListener).toBeTypeOf("function");
    paintListener?.();

    expect(destination.setTimeout).toHaveBeenCalledOnce();
    expect(destination.gBrowser.moveTabTo).toHaveBeenCalledWith(
      destination.gBrowser.selectedTab,
      { tabIndex: 2 },
    );
  });

  it("removes a provisional source tab when native detachment declines", () => {
    const { browser, environment, tabs } = createFixture();
    for (const tab of tabs) tab.multiselected = true;
    browser.selectedTabs = tabs;
    browser.multiSelectedTabsCount = tabs.length;
    vi.mocked(browser.replaceTabsWithWindow).mockReturnValue(null);
    const provisional = new FakeTab("empty");
    vi.mocked(browser.addTab).mockReturnValue(provisional);

    expect(popOutSelectedTabs(environment)).toBeNull();

    expect(browser.removeTab).toHaveBeenCalledWith(provisional, { animate: false });
  });

  it("does not detach when Zen declines the required source tab", () => {
    const { browser, environment, tabs } = createFixture();
    for (const tab of tabs) tab.multiselected = true;
    browser.selectedTabs = tabs;
    browser.multiSelectedTabsCount = tabs.length;
    vi.mocked(browser.addTab).mockReturnValue(null);

    expect(popOutSelectedTabs(environment)).toBeNull();

    expect(browser.replaceTabsWithWindow).not.toHaveBeenCalled();
  });

  it("does nothing for private windows or unsupported selections", () => {
    const privateFixture = createFixture();
    privateFixture.environment.privateWindow = true;
    expect(popOutSelectedTabs(privateFixture.environment)).toBeNull();
    expect(privateFixture.browser.replaceTabsWithWindow).not.toHaveBeenCalled();

    const essentialFixture = createFixture();
    const essentialTab = essentialFixture.tabs[1];
    if (!essentialTab) {
      throw new Error("Missing essential test tab");
    }
    essentialTab.hasAttribute = name => name === "zen-essential";
    expect(popOutSelectedTabs(essentialFixture.environment)).toBeNull();
    expect(essentialFixture.browser.replaceTabsWithWindow).not.toHaveBeenCalled();
    expect(essentialFixture.browser.addTab).not.toHaveBeenCalled();
  });
});
