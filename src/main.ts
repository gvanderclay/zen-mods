// Wakes allowlisted pinned tabs after Zen's lazy session restore, and marks them
// non-discardable so the memory-pressure unloader leaves them alone.
// Owns browser.sessionstore.restore_pinned_tabs_on_demand, via its own setting.

import { reportCapabilities } from "./core/capabilities.ts";
import { type CrashKind, crashDiagnosis } from "./core/crash.ts";
import { planLazyPinned } from "./core/lazy.ts";
import { livenessSummary } from "./core/liveness.ts";
import { parseMatchList } from "./core/match.ts";
import {
  keepMenuState,
  shouldKeep,
  sweepSummary,
  type TabFacts,
  wakeSummary,
} from "./core/policy.ts";
import {
  browserProbes,
  crashFactsFor,
  factsFor,
  insertBrowser,
  isPending,
  markUndiscardable,
  pinnedTabs,
  setFlag,
  setMarker,
  sleep,
  whenSessionRestored,
  whenSpacesReady,
} from "./platform/browser.ts";
import { observeSigns, recordSign, signFor } from "./platform/liveness.ts";
import { log } from "./platform/log.ts";
import { installKeepMenuItem } from "./platform/menu.ts";
import {
  isLazyPinnedWanted,
  isOnDemand,
  observePref,
  PREF_LAZY_PINNED,
  PREF_MATCH,
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
  // Captured rather than assumed: the pref is only true when this mod's own
  // setting asks for it, and the teardown has to put back what was actually there.
  const restore = isOnDemand();
  state.onDemandRestore = restore;
  setOnDemand(false);
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
    setOnDemand(restore);
    state.onDemandRestore = null;
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

  const laziness = planLazyPinned(isLazyPinnedWanted(), isOnDemand());
  if (laziness.set !== null) {
    setOnDemand(laziness.set);
    log(laziness.message);
  }

  const matchers = parseMatchList(rawMatchList());
  const pinned: Candidate[] = pinnedTabs().map(tab => ({ tab, facts: factsFor(tab) }));
  const kept = pinned.filter(({ facts }) => shouldKeep(facts, matchers));

  const summary = sweepSummary(
    pinned.map(({ facts }) => facts),
    kept.map(({ facts }) => facts),
  );
  log(summary.message, summary.kept);

  const keptTabs = new Set(kept.map(({ tab }) => tab));
  for (const { tab } of pinned) {
    setMarker(tab, keptTabs.has(tab));
  }
  for (const { tab } of kept) {
    markUndiscardable(tab);
  }

  const asleep = kept.filter(({ facts }) => facts.pending);
  if (asleep.length) {
    await wakeAll(asleep.map(({ tab }) => tab));
    const stuck = asleep.filter(({ tab }) => isPending(tab));
    log(
      wakeSummary(
        asleep.length,
        stuck.map(({ facts }) => facts.url),
      ),
    );
  }

  const liveness = livenessSummary(kept.map(recordOf), Date.now());
  log(liveness.message, liveness.lines);
};

/**
 * A tab with a live browser is alive enough to record, so a reload that emptied the
 * ledger recovers on the next sweep instead of reporting every tab as unseen. Read
 * after the wake, not from the snapshot, which predates it.
 */
const recordOf = ({ tab, facts }: Candidate) => {
  if (!signFor(tab) && !isPending(tab)) {
    recordSign(tab, "awake");
  }
  return { space: facts.space, url: facts.url, last: signFor(tab) };
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
  // The stylesheet goes away with the mod, so the attribute is inert either way —
  // but leaving DOM traces behind on unload is the thing D006 exists to prevent.
  for (const tab of pinnedTabs()) {
    setMarker(tab, false);
  }
  delete state.liveness;
  if (typeof state.onDemandRestore === "boolean") {
    setOnDemand(state.onDemandRestore);
    state.onDemandRestore = null;
  }
  log("unloaded");
};

onUnload(teardown);

state.disposed = false;

for (const [pref, what] of [
  [PREF_MATCH, "allowlist"],
  [PREF_LAZY_PINNED, "lazy pinned tabs setting"],
] as const) {
  state.disposers.push(
    observePref(pref, () => {
      log(`${what} changed — re-sweeping`);
      void runSweep();
    }),
  );
}

// Reports the crash and stops there. Recovery is M04.C02b, and it is written
// against what this readout actually says rather than against the source alone.
const onCrash = (tab: BrowserTab, kind: CrashKind) => {
  try {
    // Same gate as the sign log: a crash in a merely-pinned tab is not this mod's
    // business, and reporting one reads as if a kept tab had died (D016).
    if (!shouldKeep(factsFor(tab), parseMatchList(rawMatchList()))) {
      return;
    }
    const diagnosis = crashDiagnosis(crashFactsFor(tab, kind));
    log(diagnosis.message, diagnosis.lines);
  } catch (error) {
    // Ungated, and caught rather than left to the event loop: a kept tab dying is
    // the report that must not go missing, and an uncaught listener error is easy
    // to filter out of the console by accident — which is how D017's throwing
    // debug-only API cost a full test cycle.
    console.error("[keep-loaded] crash diagnosis failed", error);
  }
};

state.disposers.push(observeSigns(onCrash));

state.liveness = () => {
  const matchers = parseMatchList(rawMatchList());
  return pinnedTabs()
    .map(tab => ({ tab, facts: factsFor(tab) }))
    .filter(({ facts }) => shouldKeep(facts, matchers))
    .map(recordOf);
};

state.disposers.push(
  installKeepMenuItem(
    tab => keepMenuState(factsFor(tab), parseMatchList(rawMatchList())),
    tab => {
      const facts = factsFor(tab);
      setFlag(tab, !facts.flagged);
      log(`${facts.flagged ? "released" : "kept"} ${facts.url}`);
      void runSweep();
    },
  ),
);

await runSweep();
