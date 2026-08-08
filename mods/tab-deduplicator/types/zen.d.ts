/** Narrow hand-authored types for the privileged Firefox/Zen APIs this mod uses. */

interface BrowserURI {
  readonly spec?: unknown;
}

interface BrowserTabGroup {
  readonly id: string;
  readonly isZenFolder?: boolean;
  readonly group?: BrowserTabGroup | null;
  hasAttribute(name: string): boolean;
}

interface BrowserTab {
  readonly id: string;
  readonly pinned: boolean;
  readonly userContextId: number;
  readonly lastSeenActive: number;
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
  /** Native duplicate candidates for the active Zen workspace. */
  getAllDuplicateTabsToClose?(): BrowserTab[];
  /** Native action: warning, normal close semantics, and confirmation hint included. */
  removeAllDuplicateTabs?(): void;
  /** Firefox's normal tab-move path; Zen extends it for its tab structures. */
  moveTabAfter?(tab: BrowserTab, target: BrowserTab): void;
  /** Firefox helper used by Zen's own folder context-target resolver. */
  isTabGroupLabel?(target: unknown): boolean;
}

interface ServicesShape {
  prefs: {
    getBoolPref(name: string, fallback?: boolean): boolean;
  };
}

interface TabDeduplicatorState {
  disposers: Array<() => void>;
}

interface Window {
  MozXULElement?: { parseXULToFragment(xul: string): DocumentFragment };
  zenTabDeduplicator?: TabDeduplicatorState;
  addUnloadListener?: (callback: () => void) => void;
}

declare const gBrowser: TabBrowser;
declare const Services: ServicesShape;
