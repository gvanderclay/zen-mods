/**
 * Hand-authored types for the privileged APIs this mod touches.
 *
 * No published types exist for Firefox chrome internals, so this file is
 * deliberately narrow: only the members actually used, each traceable to a
 * source verified in the extracted `omni.ja` (see AGENTS.md).
 */

/** A tab as this mod uses it. Pinned tabs may be lazy, i.e. have no browser yet. */
interface BrowserTab {
  pinned: boolean;
  /** Consulted only by `TabUnloader`'s weighting — see D005. */
  undiscardable: boolean;
  /** Empty or null while the tab is lazy; reading `linkedBrowser` before it is set instantiates one. */
  linkedPanel: string | null;
  linkedBrowser: {
    currentURI?: { spec?: string };
    /** False right after a crash: the crash path flips the browser out of e10s. */
    isRemoteBrowser?: boolean;
    isConnected?: boolean;
    /**
     * `browser-custom-element.mjs` 626: the current document's id, or null when
     * there is no window global — a lazy tab. Changes on every navigation.
     */
    readonly innerWindowID: number | null;
  } | null;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** The subset of `SessionStore.sys.mjs` this mod calls. */
interface SessionStoreModule {
  promiseAllWindowsRestored: Promise<void>;
  getLazyTabValue(tab: BrowserTab, key: string): string | undefined;
  getCustomTabValue(tab: BrowserTab, key: string): string | undefined;
  /** Persisted with the session. Throws on a non-string value. */
  setCustomTabValue(tab: BrowserTab, key: string, value: string): void;
  /**
   * JSON, with `entries` copied from the `TabStateCache` — so the pre-crash
   * history, not whatever the live browser is showing. Throws for a tab whose
   * window SessionStore is not tracking.
   */
  getTabState(tab: BrowserTab): string;
}

/** `tabbrowser.js`. `_insertBrowser` is private and load-bearing — see D002. */
interface TabBrowser {
  /** Space-scoped in Zen (`tabs.js` `allTabs`) — see D003. */
  readonly tabs: readonly BrowserTab[];
  _insertBrowser(tab: BrowserTab): void;
  /** Public, unlike the rest of what this mod uses. Null for a foreign browser. */
  getTabForBrowser(browser: object): BrowserTab | null;
  /** Predicts the remote type from `url`, and flips only if it differs (D018). */
  updateBrowserRemotenessByURL(browser: object | null, url: string): boolean;
  /** False when `_mayDiscardBrowser` refused — the reason is never reported (D018). */
  discardBrowser(tab: BrowserTab, forceDiscard: boolean): boolean;
}

/** `ZenSpaceManager.mjs`. Everything here is private Zen surface. */
interface ZenWorkspaces {
  _hasInitializedTabsStrip?: boolean;
  /** Memo behind `allStoredTabs`; cleared to force a fresh walk. */
  _allStoredTabs: readonly BrowserTab[] | null;
  /** Walks every space's containers, unlike `gBrowser.tabs`. */
  readonly allStoredTabs: readonly BrowserTab[];
  /** Resolves after the tab strip is built. */
  promiseInitialized?: Promise<void>;
}

/** State parked on the window so it survives Sine re-importing the module — see D006. */
interface KeepLoadedState {
  disposers: Array<() => void>;
  disposed?: boolean;
  running?: boolean;
  /** Value to put `PREF_ONDEMAND` back to after a wake; `null` when none is in flight. */
  onDemandRestore?: boolean | null;
  /**
   * Console affordance: `zenKeepLoaded.liveness()` in the Browser Console dumps
   * what the watchdog has seen. Typed loosely so this file need not import core.
   */
  liveness?: () => Array<{
    space: string;
    url: string;
    last: { kind: string; at: number } | null;
  }>;
  /**
   * `zenKeepLoaded.sockets()`: the websocket readings behind M04.C04a-D. Returns the
   * verdict line as well as the rows, because the verdict is the point of the spike.
   */
  sockets?: () => { summary: string; tabs: unknown[] };
}

interface Window {
  gBrowser: TabBrowser;
  /** `parseXULToFragment` is how chrome code builds XUL from markup. */
  MozXULElement?: { parseXULToFragment(xul: string): DocumentFragment };
  gZenWorkspaces?: ZenWorkspaces;
  zenKeepLoaded?: KeepLoadedState;
  /** Injected by Sine's module loader; absent if that contract changes. */
  addUnloadListener?: (callback: () => void) => void;
}

/**
 * `nsIObserver`. The pref branch and `Services.obs` both take this shape; `data` is
 * the pref that changed, or the notification's own payload.
 */
interface XpcomObserver {
  observe(subject: unknown, topic: string, data: string): void;
}

/**
 * `nsIWebSocketEventListener`. Frames carry a payload this mod deliberately ignores;
 * the six methods are the full contract devtools implements
 * (`resources/websockets.js` 94-186), and all of them must exist or XPConnect throws
 * on the first notification it cannot deliver.
 */
interface WebSocketEventListener {
  webSocketCreated(): void;
  webSocketOpened(): void;
  webSocketMessageAvailable(): void;
  webSocketClosed(): void;
  frameReceived(): void;
  frameSent(): void;
}

/** `nsIWebSocketEventService`, keyed on inner window id, not on tab or channel. */
interface WebSocketEventService {
  addListener(innerWindowId: number, listener: WebSocketEventListener): void;
  removeListener(innerWindowId: number, listener: WebSocketEventListener): void;
  hasListenerFor(innerWindowId: number): boolean;
}

/** `nsINetworkLinkService`. `isLinkUp` means nothing while `linkStatusKnown` is false. */
interface NetworkLinkService {
  readonly isLinkUp: boolean;
  readonly linkStatusKnown: boolean;
}

/** `nsICaptivePortalService`. `state` is one of its own constants. */
interface CaptivePortalService {
  readonly state: number;
  readonly LOCKED_PORTAL: number;
}

declare const Services: {
  prefs: {
    getBoolPref(name: string, fallback?: boolean): boolean;
    setBoolPref(name: string, value: boolean): void;
    getStringPref(name: string, fallback?: string): string;
    /** `nsIPrefBranch`: 0 when the pref does not exist at all. */
    getPrefType(name: string): number;
    readonly PREF_BOOL: number;
    /** `domain` is a prefix, not an exact name — it matches every pref under it. */
    addObserver(domain: string, observer: XpcomObserver, holdWeak?: boolean): void;
    removeObserver(domain: string, observer: XpcomObserver): void;
  };
  /** `nsIObserverService`: note the argument order is the mirror of `prefs`. */
  obs: {
    addObserver(observer: XpcomObserver, topic: string, ownsWeak?: boolean): void;
    removeObserver(observer: XpcomObserver, topic: string): void;
  };
  io: {
    /** Offline mode. Usually the user's own doing, not a reading of the network. */
    readonly offline: boolean;
  };
};

declare const Cc: Record<string, { getService<T>(iface: unknown): T } | undefined>;

declare const Ci: {
  nsINetworkLinkService: unknown;
  nsICaptivePortalService: unknown;
  nsIWebSocketEventService: unknown;
};

/**
 * `tabbrowser.js` line 10448. `contextTab` is assigned by `updateContextMenu`,
 * which `main-popupset.js` wires to the menu's `popupshowing` at startup — so a
 * listener added later reads a populated value.
 */
declare const TabContextMenu: { contextTab: BrowserTab | null };

declare const ChromeUtils: {
  importESModule<T>(uri: string): T;
};
