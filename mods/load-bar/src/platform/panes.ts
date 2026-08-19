import type { BrowserVisibilitySource } from "../contracts.ts";

export interface VisiblePaneTab<Browser extends object> {
  readonly linkedBrowser: Browser;
}

export interface VisiblePaneTabBrowser<Browser extends object, Tab> {
  readonly selectedBrowser: Browser | null;
  getTabForBrowser?: (browser: Browser) => Tab | null;
}

export interface VisiblePaneSplitter<Browser extends object> {
  readonly splitViewBrowsers: readonly Browser[];
}

export interface VisiblePaneGlanceManager<Tab> {
  getTabOrGlanceParent?: (tab: Tab) => Tab;
}

export interface VisiblePaneEventTarget {
  addEventListener(name: string, listener: () => void): void;
  removeEventListener(name: string, listener: () => void): void;
}

export interface VisiblePaneSourceOptions<Browser extends object, Tab> {
  readonly glance: VisiblePaneGlanceManager<Tab>;
  readonly isLive: () => boolean;
  readonly queueMicrotask: (callback: () => void) => void;
  readonly splitter: VisiblePaneSplitter<Browser>;
  readonly tabs: VisiblePaneTabBrowser<Browser, Tab>;
  readonly target: VisiblePaneEventTarget;
}

const PANE_EVENTS = [
  "GlanceClose",
  "GlanceOpen",
  "TabBrowserDiscarded",
  "TabClose",
  "TabSelect",
  "ZenSplitViewTabsSplit",
  "ZenTabRemovedFromSplit",
  "ZenViewSplitter:SplitViewActivated",
  "ZenViewSplitter:SplitViewDeactivated",
] as const;

const unique = <Value>(values: readonly Value[]): Value[] => [...new Set(values)];

export const createVisiblePaneSource = <
  Browser extends object,
  Tab extends VisiblePaneTab<Browser>,
>({
  glance,
  isLive,
  queueMicrotask,
  splitter,
  tabs,
  target,
}: VisiblePaneSourceOptions<Browser, Tab>): BrowserVisibilitySource<Browser> => {
  const getTab = tabs.getTabForBrowser;
  const getParent = glance.getTabOrGlanceParent;
  if (typeof getTab !== "function" || typeof getParent !== "function") {
    throw new Error("Zen visible-pane API is unavailable");
  }

  const currentBrowsers = (): readonly Browser[] => {
    const selected = tabs.selectedBrowser;
    const split = unique(splitter.splitViewBrowsers);
    if (split.length === 0) {
      return selected ? [selected] : [];
    }
    if (!selected || split.includes(selected)) {
      return split;
    }

    const selectedTab = getTab.call(tabs, selected);
    const parentBrowser = selectedTab
      ? getParent.call(glance, selectedTab)?.linkedBrowser
      : null;
    if (!parentBrowser || !split.includes(parentBrowser)) {
      throw new Error("Zen selected browser cannot be reconciled with the active split");
    }
    // Zen 1.21.13b Splitter:2568-2573 and Glance:1284-1292 retain the dimmed parent.
    return split.map(browser => (browser === parentBrowser ? selected : browser));
  };

  return {
    currentBrowsers,
    install: listener => {
      let active = true;
      let queued = false;
      const onChange = () => {
        if (!active || !isLive() || queued) {
          return;
        }
        queued = true;
        queueMicrotask(() => {
          queued = false;
          if (active && isLive()) {
            listener(currentBrowsers());
          }
        });
      };
      for (const event of PANE_EVENTS) {
        target.addEventListener(event, onChange);
      }
      return () => {
        if (!active) {
          return;
        }
        active = false;
        for (const event of PANE_EVENTS) {
          target.removeEventListener(event, onChange);
        }
      };
    },
  };
};
