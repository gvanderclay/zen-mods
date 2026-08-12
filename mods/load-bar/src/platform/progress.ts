import type { BrowserProgressSource } from "../runtime.ts";

export interface WebProgressSnapshot {
  readonly isTopLevel?: boolean;
}

export interface BrowserProgressListener<Browser extends object> {
  onStateChange(
    browser: Browser,
    webProgress: WebProgressSnapshot | null,
    request: unknown,
    stateFlags: number,
    status: number,
  ): void;
}

export interface ProgressTab {
  hasAttribute(name: string): boolean;
}

export interface ProgressTabBrowser<Browser extends object> {
  readonly selectedBrowser: Browser | null;
  addTabsProgressListener?: (listener: BrowserProgressListener<Browser>) => unknown;
  removeTabsProgressListener?: (listener: BrowserProgressListener<Browser>) => unknown;
  getTabForBrowser?: (browser: Browser) => ProgressTab | null;
}

export interface ProgressStateFlags {
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
  if (
    typeof add !== "function" ||
    typeof getTab !== "function" ||
    typeof remove !== "function"
  ) {
    throw new Error("Zen tab progress API is unavailable");
  }

  return {
    currentLoadingBrowser: () => {
      const browser = tabs.selectedBrowser;
      if (!browser) {
        return null;
      }
      const tab = getTab.call(tabs, browser);
      return tab?.hasAttribute("busy") ? browser : null;
    },
    install: listener => {
      let active = true;
      const progressListener: BrowserProgressListener<Browser> = {
        onStateChange: (browser, webProgress, _request, stateFlags, status) => {
          if (!active || !isLive() || !webProgress?.isTopLevel) {
            return;
          }
          const isNetwork = Boolean(stateFlags & flags.network);
          if (!isNetwork) {
            return;
          }

          // Zen 1.21.13b tabbrowser.js:9635-9711 sets busy before callbacks at 9829-9833.
          if (stateFlags & flags.start) {
            const tab = getTab.call(tabs, browser);
            if (stateFlags & flags.restoring || !tab?.hasAttribute("busy")) {
              return;
            }
            listener({ kind: "begin", browser });
            return;
          }

          // Zen 1.21.13b tabbrowser.js:9712-9747 removes busy and retains nsresult status.
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
