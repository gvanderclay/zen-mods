import type { BrowserProgressSource } from "../contracts.ts";

export interface WebProgressSnapshot {
  readonly isTopLevel?: boolean;
}

export interface BrowserProgressListener<Browser extends object> {
  onLocationChange(
    browser: Browser,
    webProgress: WebProgressSnapshot | null,
    request: unknown,
    location: unknown,
    locationFlags: number,
  ): void;
  onStateChange(
    browser: Browser,
    webProgress: WebProgressSnapshot | null,
    request: unknown,
    stateFlags: number,
    status: number,
  ): void;
}

export interface ProgressTab {
  readonly linkedBrowser: object;
  hasAttribute(name: string): boolean;
}

export interface ProgressTabBrowser<Browser extends object> {
  readonly selectedBrowser: Browser | null;
  readonly tabs?: readonly (ProgressTab & { readonly linkedBrowser: Browser })[];
  addTabsProgressListener?: (listener: BrowserProgressListener<Browser>) => unknown;
  removeTabsProgressListener?: (listener: BrowserProgressListener<Browser>) => unknown;
  getTabForBrowser?: (browser: Browser) => ProgressTab | null;
}

export interface ProgressStateFlags {
  readonly errorPage: number;
  readonly network: number;
  readonly restoring: number;
  readonly start: number;
  readonly stop: number;
}

export interface BrowserProgressSourceOptions<Browser extends object> {
  readonly flags: ProgressStateFlags;
  readonly isCanceledStatus: (status: number) => boolean;
  readonly isLive: () => boolean;
  readonly isSuccessStatus: (status: number) => boolean;
  readonly tabs: ProgressTabBrowser<Browser>;
}

export const createBrowserProgressSource = <Browser extends object>({
  flags,
  isCanceledStatus,
  isLive,
  isSuccessStatus,
  tabs,
}: BrowserProgressSourceOptions<Browser>): BrowserProgressSource<Browser> => {
  const add = tabs.addTabsProgressListener;
  const getTab = tabs.getTabForBrowser;
  const remove = tabs.removeTabsProgressListener;
  const currentTabs = () => {
    if (!Array.isArray(tabs.tabs)) {
      throw new Error("Zen tab progress API is unavailable");
    }
    return tabs.tabs;
  };
  if (
    typeof add !== "function" ||
    typeof getTab !== "function" ||
    typeof remove !== "function"
  ) {
    throw new Error("Zen tab progress API is unavailable");
  }
  currentTabs();

  return {
    currentLoadingBrowsers: () =>
      currentTabs()
        .filter(tab => tab.hasAttribute("busy"))
        .map(tab => tab.linkedBrowser),
    install: listener => {
      let active = true;
      const progressListener: BrowserProgressListener<Browser> = {
        // Zen 1.21.16b tabbrowser.js:10067-10075,10186-10192 clears busy before error-page callbacks.
        onLocationChange: (browser, webProgress, _request, _location, locationFlags) => {
          if (
            !active ||
            !isLive() ||
            !webProgress?.isTopLevel ||
            !(locationFlags & flags.errorPage)
          ) {
            return;
          }
          const tab = getTab.call(tabs, browser);
          if (!tab || tab.hasAttribute("busy")) {
            return;
          }
          listener({ kind: "finish", browser, outcome: "network-error" });
        },
        onStateChange: (browser, webProgress, _request, stateFlags, status) => {
          if (!active || !isLive() || !webProgress?.isTopLevel) {
            return;
          }
          const isNetwork = Boolean(stateFlags & flags.network);
          if (!isNetwork) {
            return;
          }

          // Zen 1.21.16b tabbrowser.js:9823-9893 sets busy before callbacks at 10009-10014.
          if (stateFlags & flags.start) {
            const tab = getTab.call(tabs, browser);
            if (stateFlags & flags.restoring || !tab?.hasAttribute("busy")) {
              return;
            }
            listener({ kind: "begin", browser });
            return;
          }

          // Zen 1.21.16b tabbrowser.js:9900-9931 removes busy before the same callback.
          if (stateFlags & flags.stop) {
            const outcome = isSuccessStatus(status)
              ? "success"
              : isCanceledStatus(status)
                ? "canceled"
                : "network-error";
            listener({ kind: "finish", browser, outcome });
          }
        },
      };
      add.call(tabs, progressListener);
      return () => {
        if (!active) {
          return;
        }
        active = false;
        remove.call(tabs, progressListener);
      };
    },
  };
};
