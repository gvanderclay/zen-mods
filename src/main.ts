// Wakes allowlisted pinned tabs after Zen's lazy session restore, and marks them
// non-discardable so the memory-pressure unloader leaves them alone.
// Needs browser.sessionstore.restore_pinned_tabs_on_demand = true (set in user.js).

import { reportCapabilities } from "./core/capabilities.ts";
import { parseMatchList } from "./core/match.ts";
import { shouldKeep, sweepSummary, type TabFacts, wakeSummary } from "./core/policy.ts";
import {
  browserProbes,
  factsFor,
  insertBrowser,
  isPending,
  markUndiscardable,
  pinnedTabs,
  sleep,
  whenSessionRestored,
  whenSpacesReady,
} from "./platform/browser.ts";
import { log } from "./platform/log.ts";
import {
  isOnDemand,
  observeMatchList,
  PREF_ONDEMAND,
  prefProbes,
  rawMatchList,
  setOnDemand,
} from "./platform/prefs.ts";
import { onUnload, runDisposers, state } from "./platform/sine.ts";

const WAKE_TIMEOUT_MS = 20000;
const POLL_MS = 100;

/** A tab paired with the snapshot the policy layer decides on. */
interface Candidate {
  tab: BrowserTab;
  facts: TabFacts;
}

// Inserting a lazy browser makes SessionStore call restoreTab, which queues the
// tab and calls restoreNextTab. That queue refuses to hand out pinned tabs while
// restore_pinned_tabs_on_demand is true, so drop the pref for the duration —
// nothing else is in the queue, since tabs we never insert stay lazy. Restores
// in place: history and scroll survive, and no tab is selected, so no space switch.
const wakeAll = async (tabs: BrowserTab[]) => {
  setOnDemand(false);
  state.prefHeld = true;
  try {
    for (const tab of tabs) {
      insertBrowser(tab);
    }
    // Only 3 restore concurrently; the queue drains as each one starts, and
    // markTabAsRestoring drops "pending" at that point.
    const deadline = Date.now() + WAKE_TIMEOUT_MS;
    while (!state.disposed && tabs.some(isPending) && Date.now() < deadline) {
      await sleep(POLL_MS);
    }
  } finally {
    setOnDemand(true);
    state.prefHeld = false;
  }
};

const sweep = async () => {
  await whenSessionRestored();
  await whenSpacesReady();

  // After the awaits: gZenWorkspaces is not populated at module load, so probing
  // earlier would report a missing space walker that is merely late.
  const capabilities = reportCapabilities([...prefProbes(), ...browserProbes()]);
  if (!capabilities.ok) {
    // Ungated by the debug pref: this is the one failure the user must see.
    console.error(`[keep-loaded] ${capabilities.message}`);
    return;
  }
  if (capabilities.message) {
    log(capabilities.message);
  }

  if (!isOnDemand()) {
    log(`${PREF_ONDEMAND} is false — pinned tabs load eagerly`);
  }

  const matchers = parseMatchList(rawMatchList());
  const pinned: Candidate[] = pinnedTabs().map(tab => ({ tab, facts: factsFor(tab) }));
  const kept = pinned.filter(({ facts }) => shouldKeep(facts, matchers));

  const summary = sweepSummary(
    pinned.map(({ facts }) => facts),
    kept.map(({ facts }) => facts),
  );
  log(summary.message, summary.kept);

  for (const { tab } of kept) {
    markUndiscardable(tab);
  }

  const asleep = kept.filter(({ facts }) => facts.pending);
  if (!asleep.length) {
    return;
  }

  await wakeAll(asleep.map(({ tab }) => tab));
  const stuck = asleep.filter(({ tab }) => isPending(tab));
  log(
    wakeSummary(
      asleep.length,
      stuck.map(({ facts }) => facts.url),
    ),
  );
};

// Serialises sweeps: an allowlist edit can arrive while one is still waking tabs,
// and two overlapping wakes would fight over restore_pinned_tabs_on_demand.
const runSweep = async () => {
  if (state.running) {
    log("a sweep is already running — skipping this one");
    return;
  }
  state.running = true;
  try {
    await sweep();
  } finally {
    state.running = false;
  }
};

// Sine runs this before re-importing the module, so whatever later checkpoints
// register must be undone here or it doubles up on the next reload.
const teardown = () => {
  state.disposed = true;
  runDisposers();
  if (state.prefHeld) {
    setOnDemand(true);
    state.prefHeld = false;
  }
  log("unloaded");
};

onUnload(teardown);

state.disposed = false;

state.disposers.push(
  observeMatchList(() => {
    log("allowlist changed — re-sweeping");
    void runSweep();
  }),
);

await runSweep();
