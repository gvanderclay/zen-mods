import { describe, expect, it, vi } from "vitest";
import type { BrowserProgressEvent } from "../contracts.ts";
import { type BrowserProgressListener, createBrowserProgressSource } from "./progress.ts";

const FLAGS = {
  errorPage: 1 << 4,
  restoring: 1 << 0,
  start: 1 << 1,
  stop: 1 << 2,
  network: 1 << 3,
} as const;

class FakeTab {
  busy = false;

  constructor(readonly linkedBrowser: object) {}

  hasAttribute(name: string): boolean {
    return name === "busy" && this.busy;
  }
}

const setup = () => {
  const browser = {};
  const tab = new FakeTab(browser);
  const backgroundBrowser = {};
  const backgroundTab = new FakeTab(backgroundBrowser);
  let captured: BrowserProgressListener<object> | null = null;
  const addTabsProgressListener = vi.fn((listener: BrowserProgressListener<object>) => {
    captured = listener;
  });
  const removeTabsProgressListener = vi.fn();
  const tabs = {
    addTabsProgressListener,
    getTabForBrowser: vi.fn((candidate: object) => (candidate === browser ? tab : null)),
    removeTabsProgressListener,
    selectedBrowser: browser,
    tabs: [tab, backgroundTab],
  };
  const source = createBrowserProgressSource({
    flags: FLAGS,
    isCanceledStatus: status => status === 9,
    isLive: () => true,
    isSuccessStatus: status => status === 0,
    tabs,
  });
  const events: BrowserProgressEvent<object>[] = [];
  const dispose = source.install(event => events.push(event));
  if (!captured) {
    throw new Error("listener was not installed");
  }
  return {
    browser,
    backgroundBrowser,
    backgroundTab,
    dispose,
    events,
    listener: captured as BrowserProgressListener<object>,
    removeTabsProgressListener,
    source,
    tab,
  };
};

const state = (
  listener: BrowserProgressListener<object>,
  browser: object,
  flags: number,
  status = 0,
  topLevel = true,
) => listener.onStateChange(browser, { isTopLevel: topLevel }, null, flags, status);

const location = (
  listener: BrowserProgressListener<object>,
  browser: object,
  flags: number,
  topLevel = true,
) => listener.onLocationChange(browser, { isTopLevel: topLevel }, null, null, flags);

describe("browser progress source", () => {
  it("emits a begin only for a qualifying top-level network load", () => {
    const { browser, events, listener, tab } = setup();
    tab.busy = true;

    state(listener, browser, FLAGS.start);
    state(listener, browser, FLAGS.start | FLAGS.network, 0, false);
    state(listener, browser, FLAGS.start | FLAGS.network | FLAGS.restoring);
    tab.busy = false;
    state(listener, browser, FLAGS.start | FLAGS.network);
    tab.busy = true;
    state(listener, browser, FLAGS.start | FLAGS.network);

    expect(events).toEqual([{ kind: "begin", browser }]);
  });

  it.each([
    [0, "success"],
    [9, "canceled"],
    [13, "network-error"],
  ] as const)("normalizes stop status %s as %s", (status, outcome) => {
    const { browser, events, listener } = setup();

    state(listener, browser, FLAGS.stop | FLAGS.network, status);

    expect(events).toEqual([{ kind: "finish", browser, outcome }]);
  });

  it("finishes an error-page load after Zen clears the tab's busy state", () => {
    const { browser, events, listener, tab } = setup();

    location(listener, browser, FLAGS.errorPage, false);
    location(listener, browser, 0);
    tab.busy = true;
    location(listener, browser, FLAGS.errorPage);
    tab.busy = false;
    location(listener, browser, FLAGS.errorPage);

    expect(events).toEqual([{ kind: "finish", browser, outcome: "network-error" }]);
  });

  it("reports every browser whose tab is already busy", () => {
    const { backgroundBrowser, backgroundTab, browser, source, tab } = setup();

    expect(source.currentLoadingBrowsers()).toEqual([]);
    tab.busy = true;
    backgroundTab.busy = true;
    expect(source.currentLoadingBrowsers()).toEqual([browser, backgroundBrowser]);
  });

  it("removes the exact listener and makes a retained callback inert", () => {
    const { browser, dispose, events, listener, removeTabsProgressListener, tab } =
      setup();
    tab.busy = true;

    dispose();
    dispose();
    state(listener, browser, FLAGS.start | FLAGS.network);
    tab.busy = false;
    location(listener, browser, FLAGS.errorPage);

    expect(removeTabsProgressListener).toHaveBeenCalledTimes(1);
    expect(removeTabsProgressListener).toHaveBeenCalledWith(listener);
    expect(events).toEqual([]);
  });

  it("fails closed before registration when the private API is incomplete", () => {
    expect(() =>
      createBrowserProgressSource({
        flags: FLAGS,
        isCanceledStatus: () => false,
        isLive: () => true,
        isSuccessStatus: () => true,
        tabs: { selectedBrowser: null },
      }),
    ).toThrow(/tab progress API/);
  });

  it("fails closed before registration when the tab inventory is unavailable", () => {
    expect(() =>
      createBrowserProgressSource({
        flags: FLAGS,
        isCanceledStatus: () => false,
        isLive: () => true,
        isSuccessStatus: () => true,
        tabs: {
          addTabsProgressListener: vi.fn(),
          getTabForBrowser: vi.fn(() => null),
          removeTabsProgressListener: vi.fn(),
          selectedBrowser: null,
        },
      }),
    ).toThrow(/tab progress API/);
  });
});
