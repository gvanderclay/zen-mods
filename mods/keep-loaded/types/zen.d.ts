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
  /** DOM connection state; false once the tab has left its owning window. */
  readonly isConnected: boolean;
  /** The `selected` getter `tabbrowser.js` itself reads (1787, 2478, 8998, …). */
  readonly selected: boolean;
  /** Consulted only by `TabUnloader`'s weighting — see D005. */
  undiscardable: boolean;
  /**
   * The name the user gave this tab (`ZenUIManager` 1615, restored by `SessionStore`
   * 6707). `_setTabLabel` 2426 honours it above the page's own title, so a tab that has
   * one must be left alone — see D028.
   */
  zenStaticLabel?: string;
  /**
   * Zen's record that *this window* is where the tab's contents are being viewed. Absent
   * on a restored pinned tab (`ZenWindowSync.sys.mjs` 313), which is why such a tab can
   * never update its own label; deleted when another window takes the docshell (1090,
   * 1143, 1162), which is why this mod reads it and never writes it (D028).
   */
  _zenContentsVisible?: boolean;
  /**
   * Zen's local escape hatch past that refusal, used by `ZenUIManager` 1617 and
   * `SessionStore` 5208. Set around one `setTabTitle` call and deleted again.
   */
  _zenChangeLabelFlag?: boolean;
  /** Empty or null while the tab is lazy; reading `linkedBrowser` before it is set instantiates one. */
  linkedPanel: string | null;
  linkedBrowser: {
    currentURI?: { spec?: string };
    /** False right after a crash: the crash path flips the browser out of e10s. */
    isRemoteBrowser?: boolean;
    isConnected?: boolean;
    /**
     * Whether the page is running. False on an unselected tab (`tabbrowser.js` 1800)
     * and on a browser just inserted (3111), which suspends rAF, clamps timers and
     * reports `visibilityState: "hidden"` — see D026. Writable, and writing it is
     * what `showSplitViewPanels` (3831) and print preview (8293) both do.
     */
    docShellIsActive?: boolean;
    /**
     * `browser-custom-element.mjs` 626: the current document's id, or null when
     * there is no window global — a lazy tab. Changes on every navigation.
     */
    readonly innerWindowID: number | null;
    /** The page's own `document.title`, forwarded to the parent process. */
    readonly contentTitle?: string;
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
  /** Only read to probe for `docShellIsActive`; a window always has one. */
  readonly selectedBrowser?: object;
  _insertBrowser(tab: BrowserTab): void;
  /** Public, unlike the rest of what this mod uses. Null for a foreign browser. */
  getTabForBrowser(browser: object): BrowserTab | null;
  /** Predicts the remote type from `url`, and flips only if it differs (D018). */
  updateBrowserRemotenessByURL(browser: object | null, url: string): boolean;
  /** False when `_mayDiscardBrowser` refused — the reason is never reported (D018). */
  discardBrowser(tab: BrowserTab, forceDiscard: boolean): boolean;
  /**
   * Derives the label from the browser's own `contentTitle` and writes it, returning
   * whether it changed. False also means refused — see D028.
   */
  setTabTitle?(tab: BrowserTab): boolean;
  /** Both forward to `tabpanels` (`tabbrowser.js` 548, 552), so removal works. */
  addEventListener(type: string, listener: (event: { target?: object }) => void): void;
  removeEventListener(type: string, listener: (event: { target?: object }) => void): void;
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
  /**
   * Zen's own record for one space, looked up by the id a tab carries. Swallows its
   * own failures and returns undefined. `icon` is an emoji, or a path ending `.svg`.
   */
  getWorkspaceFromId?(id: string): { name?: string; icon?: string } | null | undefined;
}

/** The immutable facade of the current cache-busted controller generation. */
interface KeepLoadedState {
  application?: () => {
    applicationId: string;
    registrationId: string | null;
    snapshot: {
      activeCount: number;
      activeKind: "recovery" | "sweep" | null;
      applicationId: string;
      desiredOnDemand: boolean | null;
      drainingCount: number;
      keyRecords: number;
      protocol: number;
      readyCount: number;
      registrationCount: number;
      registrationIds: readonly string[];
      sweepRecords: number;
      trailingCount: number;
      wakeAttempt: number | null;
      wakeCandidates: number;
      wakePhase:
        | "acquiring"
        | "blocked"
        | "idle"
        | "inserting"
        | "restoring-preference"
        | "retrying"
        | "rolling-back"
        | "waiting";
    };
  };
  controller?: {
    readonly pendingTimers: number;
    readonly pendingWaits: number;
    isLive(): boolean;
    stop(
      reason?:
        | "manual"
        | "replacement"
        | "sine-unload"
        | "startup-failure"
        | "window-unload",
    ): boolean;
  };
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
  /** Reload-surviving freshness claims; weak keys do not retain closed tabs. */
  pulses: WeakMap<BrowserTab, { heldSince: number | null; lastPulseAt: number | null }>;
  /**
   * Fills the status panel, given the panelview itself — the rows and the footer
   * button are siblings, so a fill has to reach both. Parked on the window because a
   * CustomizableUI widget is created once per *application* while this module runs once
   * per *window*: the widget's callback reaches the right instance only by looking it
   * up here (D022).
   */
  fillPanel?: (view: Element) => void;
}

interface Document {
  /** XUL elements need their own factory; `createElement` would build an HTML one. */
  createXULElement(name: string): HTMLElement;
}

/**
 * `CustomizableUI.sys.mjs`. Only what the status panel needs. `localized: false` makes
 * `label` and `tooltiptext` literal strings rather than string-bundle ids — the
 * documented path for a widget that is not built in (`getLocalizedProperty` 2744).
 */
interface CustomizableUIApi {
  PROVIDER_API: string;
  getWidget(id: string): { provider?: string } | null;
  createWidget(spec: {
    id: string;
    type: string;
    viewId: string;
    localized: boolean;
    label: string;
    tooltiptext: string;
    defaultArea: string;
    onViewShowing: (event: { target: Element }) => void;
  }): void;
  destroyWidget(id: string): void;
}

interface Window {
  gBrowser: TabBrowser;
  /** `parseXULToFragment` is how chrome code builds XUL from markup. */
  MozXULElement?: { parseXULToFragment(xul: string): DocumentFragment };
  CustomizableUI?: CustomizableUIApi;
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
  uuid: {
    /** `nsIUUIDGenerator.generateUUID()`, used only for process-owner evidence. */
    generateUUID(): { toString(): string };
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
