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
  prompt?: {
    readonly BUTTON_POS_0: number;
    readonly BUTTON_POS_1: number;
    readonly BUTTON_POS_2: number;
    readonly BUTTON_TITLE_IS_STRING: number;
    readonly BUTTON_TITLE_CANCEL: number;
    readonly BUTTON_POS_1_DEFAULT: number;
    confirmEx(
      parent: unknown,
      title: string,
      text: string,
      flags: number,
      button0: string | null,
      button1: string | null,
      button2: string | null,
      checkMessage: string | null,
      checkState: Record<string, unknown>,
    ): unknown;
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
