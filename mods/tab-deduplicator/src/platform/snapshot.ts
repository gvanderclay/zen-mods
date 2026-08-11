/**
 * Read-only facts from Zen's current-space tab list.
 *
 * Verified in Zen's shipped `browser/omni.ja`:
 *
 * - `tabbrowser.js` 526–529 delegates `gBrowser.tabs` to `tabs.js` `allTabs`;
 *   `tabs.js` 851–904 assembles the active workspace's essentials, pinned tabs,
 *   collapsed groups, split views, and ordinary tabs without activating them.
 * - `tabbrowser.js` 5273–5294 reads `currentURI`, `userContextId`, and
 *   `lastSeenActive` to identify native duplicate candidates.
 * - `ZenPinnedTabManager.mjs` 405–407 resolves a split-view tab's outer group,
 *   while `ZenFolder.mjs` 98–112 exposes the containing group and `isZenFolder`.
 * - `ZenPinnedTabManager.mjs` 249–257 reads `_zenPinnedInitialState.entry.url`
 *   as the canonical pin URL, which `ZenWindowSync.sys.mjs` 1222–1266 stores.
 * - `tabbrowser.js` 2932–3024 derives a lazy browser's `currentURI` from
 *   `SessionStore.getLazyTabValue`; `SessionStore.sys.mjs` 5093–5103 exposes that
 *   value, while `getTabState` retains the active entry when a placeholder leaks.
 */

import {
  type DuplicatePlan,
  type DuplicatePlanOptions,
  type DuplicateTabFacts,
  planDuplicates,
} from "../core/duplicates.ts";

const CURRENT_SPACE_ID = "current-space";
export const TOP_LEVEL_PINNED_LANE = "top-level-pinned";
export const TOP_LEVEL_ORDINARY_LANE = "top-level-ordinary";

const generatedIds = new WeakMap<BrowserTab, string>();
let nextGeneratedId = 1;

const nonEmptyString = (value: unknown) =>
  typeof value === "string" && value.length > 0 ? value : null;

interface SessionStoreReader {
  getLazyTabValue(tab: BrowserTab, key: string): string | undefined;
  getTabState(tab: BrowserTab): string;
}

let cachedSessionStore: SessionStoreReader | null = null;

const browserSessionStore = () => {
  if (cachedSessionStore) {
    return cachedSessionStore;
  }
  try {
    cachedSessionStore = ChromeUtils.importESModule<{
      SessionStore: SessionStoreReader;
    }>("resource:///modules/sessionstore/SessionStore.sys.mjs").SessionStore;
  } catch {
    return null;
  }
  return cachedSessionStore;
};

const stateUrl = (json: string) => {
  try {
    const state = JSON.parse(json) as { index?: unknown; entries?: unknown } | null;
    if (!Array.isArray(state?.entries) || state.entries.length === 0) {
      return null;
    }
    const requested =
      typeof state.index === "number" ? state.index : state.entries.length;
    const index = Math.min(Math.max(requested - 1, 0), state.entries.length - 1);
    return nonEmptyString((state.entries[index] as { url?: unknown } | undefined)?.url);
  } catch {
    return null;
  }
};

const currentUrl = (tab: BrowserTab, provided?: SessionStoreReader) => {
  let live = tab.linkedPanel ? nonEmptyString(tab.linkedBrowser?.currentURI?.spec) : null;
  let reader: SessionStoreReader | null | undefined = provided;
  if (!tab.linkedPanel) {
    reader ??= browserSessionStore();
    live = nonEmptyString(reader?.getLazyTabValue(tab, "url"));
  }
  if (live && live !== "about:blank") {
    return live;
  }
  reader ??= browserSessionStore();
  if (!reader) {
    return live;
  }
  try {
    const stored = stateUrl(reader.getTabState(tab));
    return stored && stored !== "about:blank" ? stored : live;
  } catch {
    return live;
  }
};

const runtimeId = (tab: BrowserTab) => {
  const browserId = nonEmptyString(tab.id);
  if (browserId) {
    return browserId;
  }
  const existing = generatedIds.get(tab);
  if (existing) {
    return existing;
  }
  const generated = `tab-deduplicator-tab-${nextGeneratedId++}`;
  generatedIds.set(tab, generated);
  return generated;
};

export const folderLaneId = (folderId: string) => `folder:${folderId}`;

export const isSplitViewTab = (tab: BrowserTab) =>
  tab.group?.hasAttribute("split-view-group") ?? false;

export const enclosingZenFolder = (tab: BrowserTab) => {
  const immediateGroup = tab.group;
  const candidate = isSplitViewTab(tab) ? immediateGroup?.group : immediateGroup;
  return candidate?.isZenFolder && nonEmptyString(candidate.id) ? candidate : null;
};

export const tabLaneId = (tab: BrowserTab) => {
  const folder = enclosingZenFolder(tab);
  if (folder) {
    return folderLaneId(folder.id);
  }
  return tab.pinned || tab.hasAttribute("zen-essential")
    ? TOP_LEVEL_PINNED_LANE
    : TOP_LEVEL_ORDINARY_LANE;
};

const tabFacts = (
  tab: BrowserTab,
  position: number,
  sessionStore?: SessionStoreReader,
): DuplicateTabFacts => ({
  id: runtimeId(tab),
  currentUrl: currentUrl(tab, sessionStore),
  pinnedUrl: nonEmptyString(tab._zenPinnedInitialState?.entry?.url),
  containerId: tab.userContextId,
  spaceId: CURRENT_SPACE_ID,
  laneId: tabLaneId(tab),
  pinned: tab.pinned,
  essential: tab.hasAttribute("zen-essential"),
  lastSeenActive: tab.lastSeenActive,
  position,
});

export interface DuplicateSnapshot {
  facts: DuplicateTabFacts[];
  tabsById: Map<string, BrowserTab>;
}

export interface CurrentDuplicatePlan extends DuplicateSnapshot {
  plan: DuplicatePlan;
}

export const snapshotDuplicateTabs = (
  tabs: readonly BrowserTab[] = gBrowser.tabs,
  sessionStore?: SessionStoreReader,
): DuplicateSnapshot => {
  const facts: DuplicateTabFacts[] = [];
  const tabsById = new Map<string, BrowserTab>();
  for (const [position, tab] of tabs.entries()) {
    const fact = tabFacts(tab, position, sessionStore);
    facts.push(fact);
    tabsById.set(fact.id, tab);
  }
  return { facts, tabsById };
};

export const currentDuplicatePlan = (
  options: DuplicatePlanOptions = {},
): CurrentDuplicatePlan => {
  const snapshot = snapshotDuplicateTabs();
  return {
    ...snapshot,
    plan: planDuplicates(snapshot.facts, options),
  };
};
