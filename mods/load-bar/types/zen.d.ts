interface LoadBarBrowser extends Element {}

interface LoadBarTab {
  readonly linkedPanel: string | null;
  hasAttribute(name: string): boolean;
}

interface LoadBarProgressListener {
  onStateChange(
    browser: LoadBarBrowser,
    webProgress: { readonly isTopLevel?: boolean } | null,
    request: unknown,
    stateFlags: number,
    status: number,
  ): void;
}

interface LoadBarTabBrowser {
  readonly selectedBrowser: LoadBarBrowser | null;
  addTabsProgressListener(listener: LoadBarProgressListener): void;
  removeTabsProgressListener(listener: LoadBarProgressListener): void;
  getTabForBrowser(browser: LoadBarBrowser): LoadBarTab | null;
}

interface LoadBarState {
  readonly controller: {
    isLive(): boolean;
    snapshot(): {
      readonly activeRecords: number;
      readonly live: boolean;
      readonly pendingTimers: number;
      readonly pendingWaits: number;
      readonly started: boolean;
      readonly stopReason:
        | "manual"
        | "platform-failure"
        | "replacement"
        | "sine-unload"
        | "startup-failure"
        | "window-unload"
        | null;
      readonly visibleRecords: number;
    };
    stop(
      reason?:
        | "manual"
        | "platform-failure"
        | "replacement"
        | "sine-unload"
        | "startup-failure"
        | "window-unload",
    ): boolean;
  };
  readonly generationToken: string;
}

interface Window {
  readonly crypto: Crypto;
  zenLoadBar?: LoadBarState;
  addUnloadListener?: (callback: () => unknown) => void;
}

interface ComponentsShape {
  isSuccessCode(status: number): boolean;
}

interface WebProgressListenerConstants {
  readonly STATE_IS_NETWORK: number;
  readonly STATE_RESTORING: number;
  readonly STATE_START: number;
  readonly STATE_STOP: number;
}

interface CiShape {
  readonly nsIWebProgressListener: WebProgressListenerConstants;
}

interface CrShape {
  readonly NS_BINDING_ABORTED: number;
}

declare const gBrowser: LoadBarTabBrowser;
declare const Components: ComponentsShape;
declare const Ci: CiShape;
declare const Cr: CrShape;
