/** Every pinned tab with the verdict and the readings the rest of the mod reports. */

import { shouldKeep, type TabFacts } from "./core/policy.ts";
import { factsFor, pinnedTabs } from "./platform/browser.ts";
import { recordSign, signFor } from "./platform/liveness.ts";
import type { PreferencesPort } from "./platform/prefs.ts";
import { socketRecordFor } from "./platform/sockets.ts";

/** A tab paired with the snapshot the policy layer decides on. */
export interface Candidate {
  tab: BrowserTab;
  facts: TabFacts;
}

export interface VerdictCandidate extends Candidate {
  kept: boolean;
}

export interface TabInventory {
  pinned: VerdictCandidate[];
  kept: VerdictCandidate[];
}

/** Read fresh, not cached: the allowlist and a tab's loaded state both change. */
export const pinnedWithVerdict = (settings: PreferencesPort): VerdictCandidate[] => {
  const matchers = settings.snapshot().match;
  return pinnedTabs().map(tab => {
    const facts = factsFor(tab);
    return { tab, facts, kept: shouldKeep(facts, matchers) };
  });
};

export const takeInventory = (settings: PreferencesPort): TabInventory => {
  const pinned = pinnedWithVerdict(settings);
  return { pinned, kept: pinned.filter(item => item.kept) };
};

export const keptTabs = (settings: PreferencesPort): VerdictCandidate[] =>
  takeInventory(settings).kept;

/** The readings for every kept tab, whether or not a listener ever attached. */
export const socketRecords = (candidates: readonly Candidate[]) =>
  candidates.map(({ tab, facts }) => socketRecordFor(tab, facts.space, facts.url));

/** A live browser counts as alive; read after the wake, not from the snapshot. */
export const recordOf = ({ tab, facts }: Candidate) => {
  let last = signFor(tab);
  if (!last && !facts.pending) {
    last = recordSign(tab, "awake");
  }
  return { space: facts.space, url: facts.url, last };
};
