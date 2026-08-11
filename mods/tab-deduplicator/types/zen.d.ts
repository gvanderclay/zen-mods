/** Narrow hand-authored types for the privileged Firefox/Zen APIs this mod uses. */

interface BrowserURI {
  readonly spec?: unknown;
}

interface BrowserTabGroup {
  readonly id: string;
  readonly label?: string;
  readonly isZenFolder?: boolean;
  readonly group?: BrowserTabGroup | null;
  hasAttribute(name: string): boolean;
}

interface BrowserTab {
  readonly id: string;
  readonly label?: string;
  readonly pinned: boolean;
  readonly userContextId: number;
  readonly lastSeenActive: number;
  readonly closing?: boolean;
  readonly multiselected?: boolean;
  readonly linkedPanel: string | null;
  readonly linkedBrowser?: { readonly currentURI?: BrowserURI };
  readonly group?: BrowserTabGroup | null;
  readonly _zenPinnedInitialState?: {
    readonly entry?: { readonly url?: unknown };
  };
  hasAttribute(name: string): boolean;
}

interface TabBrowser {
  /** Zen's active-space tab list, including collapsed and unloaded tabs. */
  readonly tabs: BrowserTab[];
  /** Preflight that returns true when beforeunload blocked the requested close. */
  runBeforeUnloadForTabs?(tabs: BrowserTab[]): Promise<boolean>;
  /** Zen-aware unpin path, including folder and workspace state. */
  unpinTab?(tab: BrowserTab): void;
  /** Firefox's normal multi-tab close path. */
  removeTabs?(tabs: BrowserTab[], options?: { skipPermitUnload?: boolean }): void;
  /** Firefox's normal tab-move path; Zen extends it for its tab structures. */
  moveTabAfter?(tab: BrowserTab, target: BrowserTab): void;
  /** Firefox helper used by Zen's own folder context-target resolver. */
  isTabGroupLabel?(target: unknown): boolean;
  /** Private native bulk-close path used by Firefox's duplicate actions. */
  _removeDuplicateTabs?(
    confirmationAnchor: unknown,
    tabs: BrowserTab[],
    closingTabsType: number,
  ): void;
  readonly closingTabsEnum?: { readonly DUPLICATES?: number };
}

interface ServicesShape {
  prefs: {
    getBoolPref(name: string, fallback?: boolean): boolean;
  };
}

interface ChromeUtilsShape {
  importESModule<Module>(url: string): Module;
}

type TabDeduplicatorState =
  import("@zen-mods/sine-lifecycle/sine-window").SineWindowGenerationState;

interface Window {
  MozXULElement?: { parseXULToFragment(xul: string): DocumentFragment };
  zenTabDeduplicator?: TabDeduplicatorState;
  addUnloadListener?: (callback: () => void) => void;
  TabContextMenu?: {
    readonly contextTab?: BrowserTab | null;
    readonly multiselected?: boolean;
  };
}

declare const gBrowser: TabBrowser;
declare const Services: ServicesShape;
declare const ChromeUtils: ChromeUtilsShape;
