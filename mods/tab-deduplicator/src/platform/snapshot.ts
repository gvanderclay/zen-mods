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
 */

import {
  type DuplicatePlan,
  type DuplicatePlanOptions,
  type DuplicateTabFacts,
  planDuplicates,
} from "../core/duplicates.ts";

const CURRENT_SPACE_ID = "current-space";
const TOP_LEVEL_PINNED_LANE = "top-level-pinned";
const TOP_LEVEL_ORDINARY_LANE = "top-level-ordinary";

const generatedIds = new WeakMap<BrowserTab, string>();
let nextGeneratedId = 1;

const nonEmptyString = (value: unknown) =>
  typeof value === "string" && value.length > 0 ? value : null;

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

const enclosingZenFolder = (tab: BrowserTab) => {
  const immediateGroup = tab.group;
  const candidate = immediateGroup?.hasAttribute("split-view-group")
    ? immediateGroup.group
    : immediateGroup;
  return candidate?.isZenFolder && nonEmptyString(candidate.id) ? candidate : null;
};

const laneId = (tab: BrowserTab) => {
  const folder = enclosingZenFolder(tab);
  if (folder) {
    return `folder:${folder.id}`;
  }
  return tab.pinned || tab.hasAttribute("zen-essential")
    ? TOP_LEVEL_PINNED_LANE
    : TOP_LEVEL_ORDINARY_LANE;
};

const tabFacts = (tab: BrowserTab, position: number): DuplicateTabFacts => ({
  id: runtimeId(tab),
  currentUrl: nonEmptyString(tab.linkedBrowser?.currentURI?.spec),
  pinnedUrl: nonEmptyString(tab._zenPinnedInitialState?.entry?.url),
  containerId: tab.userContextId,
  spaceId: CURRENT_SPACE_ID,
  laneId: laneId(tab),
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
): DuplicateSnapshot => {
  const facts: DuplicateTabFacts[] = [];
  const tabsById = new Map<string, BrowserTab>();
  for (const [position, tab] of tabs.entries()) {
    const fact = tabFacts(tab, position);
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
