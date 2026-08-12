import { describe, expect, it, vi } from "vitest";
import { createVisiblePaneSource } from "./panes.ts";

class FakeTarget {
  readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(name: string, listener: () => void): void {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  }

  removeEventListener(name: string, listener: () => void): void {
    this.listeners.get(name)?.delete(listener);
  }

  dispatch(name: string): void {
    for (const listener of [...(this.listeners.get(name) ?? [])]) listener();
  }
}

interface FakeBrowser {
  readonly name: string;
}

interface FakeTab {
  readonly linkedBrowser: FakeBrowser;
  readonly parent?: FakeTab;
}

const setup = () => {
  const first = { name: "first" };
  const second = { name: "second" };
  const overlay = { name: "overlay" };
  const firstTab = { linkedBrowser: first };
  const secondTab = { linkedBrowser: second };
  const overlayTab = { linkedBrowser: overlay, parent: firstTab };
  const tabByBrowser = new Map([
    [first, firstTab],
    [second, secondTab],
    [overlay, overlayTab],
  ]);
  const target = new FakeTarget();
  const queued: Array<() => void> = [];
  const tabs = {
    getTabForBrowser: (browser: FakeBrowser) => tabByBrowser.get(browser) ?? null,
    selectedBrowser: first as FakeBrowser | null,
  };
  const splitter = { splitViewBrowsers: [] as FakeBrowser[] };
  let live = true;
  const source = createVisiblePaneSource({
    glance: { getTabOrGlanceParent: (tab: FakeTab) => tab.parent ?? tab },
    isLive: () => live,
    queueMicrotask: callback => queued.push(callback),
    splitter,
    tabs,
    target,
  });
  const flush = () => {
    for (const callback of queued.splice(0)) callback();
  };
  return {
    first,
    firstTab,
    flush,
    overlay,
    second,
    setLive: (value: boolean) => {
      live = value;
    },
    source,
    splitter,
    tabs,
    target,
  };
};

describe("visible pane source", () => {
  it("returns the selected ordinary browser", () => {
    const { first, source } = setup();

    expect(source.currentBrowsers()).toEqual([first]);
  });

  it("returns every exact split browser", () => {
    const { first, second, source, splitter } = setup();
    splitter.splitViewBrowsers = [first, second];

    expect(source.currentBrowsers()).toEqual([first, second]);
  });

  it("replaces a split parent with its selected Glance overlay", () => {
    const { first, overlay, second, source, splitter, tabs } = setup();
    splitter.splitViewBrowsers = [first, second];
    tabs.selectedBrowser = overlay;

    expect(source.currentBrowsers()).toEqual([overlay, second]);
  });

  it("fails closed when the selected browser cannot be reconciled with the split", () => {
    const { first, source, splitter, tabs } = setup();
    const unrelated = { name: "unrelated" };
    splitter.splitViewBrowsers = [first];
    tabs.selectedBrowser = unrelated;

    expect(() => source.currentBrowsers()).toThrow(/cannot be reconciled/);
  });

  it("coalesces pane events and makes queued work inert after disposal", () => {
    const { first, flush, second, setLive, source, splitter, tabs, target } = setup();
    const listener = vi.fn();
    const dispose = source.install(listener);
    splitter.splitViewBrowsers = [first, second];

    target.dispatch("ZenViewSplitter:SplitViewActivated");
    target.dispatch("ZenSplitViewTabsSplit");
    flush();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith([first, second]);

    tabs.selectedBrowser = second;
    target.dispatch("TabSelect");
    dispose();
    setLive(false);
    flush();
    expect(listener).toHaveBeenCalledTimes(1);
    expect([...target.listeners.values()].every(listeners => listeners.size === 0)).toBe(
      true,
    );
  });
});
