/** Narrow hand-authored types for the privileged Firefox/Zen APIs this mod uses. */

interface BrowserTab {
  readonly pinned: boolean;
  readonly userContextId: number;
  readonly lastSeenActive: number;
  hasAttribute(name: string): boolean;
}

interface TabBrowser {
  /** Native duplicate candidates for the active Zen workspace. */
  getAllDuplicateTabsToClose?(): BrowserTab[];
  /** Native action: warning, normal close semantics, and confirmation hint included. */
  removeAllDuplicateTabs?(): void;
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
