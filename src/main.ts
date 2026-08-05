// Wakes allowlisted pinned tabs after Zen's lazy session restore, and marks them
// non-discardable so the memory-pressure unloader leaves them alone.
// Owns browser.sessionstore.restore_pinned_tabs_on_demand, via its own setting.

import { reportCapabilities } from "./core/capabilities.ts";
import { type CrashFacts, type CrashKind, crashDiagnosis } from "./core/crash.ts";
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
  parseAttempts,
  parseWindowMs,
  recentAttempts,
  recoveryPlan,
} from "./core/recovery.ts";
import { networkReady, WAKE_TOPICS, wakeReason } from "./core/resume.ts";
import { panelReport, type RowFacts } from "./core/rows.ts";
import { socketSummary } from "./core/sockets.ts";
import { unloadPlan } from "./core/unload.ts";
import {
  browserProbes,
  crashFactsFor,
  factsFor,
  insertBrowser,
  isPending,
  markUndiscardable,
  pinnedTabs,
  resetToLazy,
  setFlag,
  setMarker,
  sleep,
  spaceNameFor,
  whenSessionRestored,
  whenSpacesReady,
} from "./platform/browser.ts";
import { observeSigns, recordSign, signFor } from "./platform/liveness.ts";
import { log } from "./platform/log.ts";
import { installKeepMenuItem } from "./platform/menu.ts";
import {
  installStatusPanel,
  renderPanelLines,
  renderPanelReport,
} from "./platform/panel.ts";
import {
  isLazyPinnedWanted,
  isOnDemand,
  observePref,
  PREF_LAZY_PINNED,
  PREF_MATCH,
  prefProbes,
  rawCrashAttempts,
  rawCrashWindow,
  rawMatchList,
  setOnDemand,
} from "./platform/prefs.ts";
import { onUnload, runDisposers, state } from "./platform/sine.ts";
import {
  socketProbes,
  socketRecordFor,
  stopWatchingSockets,
  watchSockets,
} from "./platform/sockets.ts";
import { networkFacts, observeTopic } from "./platform/system.ts";

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

/**
 * When each tab was last recovered, pruned to the budget window on every read so it
 * cannot grow with the session. Emptied by a mod reload, exactly like the sign ledger.
 */
const attempts = new WeakMap<BrowserTab, number[]>();

/**
 * Waits for a sweep to let go of `restore_pinned_tabs_on_demand`, which a recovery
 * has to drop around its own insert. Waiting rather than skipping: a sweep may be
 * waking this very tab, and dropping the recovery would leave it dead.
 */
const whenSweepIdle = async () => {
  const deadline = Date.now() + WAKE_TIMEOUT_MS;
  while (state.running && !state.disposed && Date.now() < deadline) {
    await sleep(POLL_MS);
  }
  return !state.running && !state.disposed;
};

/**
 * Puts a crashed kept tab back. Success is reported as a `crashed -> awake`
 * transition rather than a line of its own: a tab with a live browser is a sign of
 * life by the same reasoning the sweep seeds one (D016), and the ledger would
 * otherwise keep calling a recovered tab crashed.
 */
const recover = async (tab: BrowserTab, facts: CrashFacts) => {
  const now = Date.now();
  // Read per crash, so edited settings apply to the next one without a reload.
  const windowMs = parseWindowMs(rawCrashWindow());
  const maxAttempts = parseAttempts(rawCrashAttempts());
  const spent = recentAttempts(attempts.get(tab) ?? [], now, windowMs);
  const plan = recoveryPlan(facts, { attempts: spent, now, windowMs, maxAttempts });
  log(`${facts.url}: ${plan.reason}`);
  if (plan.action === "skip") {
    return;
  }
  if (!(await whenSweepIdle())) {
    log(`${facts.url}: gave up waiting for a sweep to finish`);
    return;
  }
  // Stamped when the attempt was planned, not now: the wait can be long, and the
  // budget is about how often this tab crashes, not how long its recoveries took.
  attempts.set(tab, [...spent, now]);
  state.running = true;
  try {
    if (plan.action === "reset-then-wake" && !resetToLazy(tab, facts.url)) {
      // `_mayDiscardBrowser` never says which of its eight conditions refused.
      log(`${facts.url}: the browser refused to discard, so it stays crashed`);
      return;
    }
    await wakeAll([tab]);
    if (isPending(tab)) {
      log(`${facts.url}: still pending after recovery`);
      return;
    }
    recordSign(tab, "awake");
  } finally {
    state.running = false;
  }
};

const sweep = async () => {
  await whenSessionRestored();
  await whenSpacesReady();

  // After the awaits: gZenWorkspaces is not populated at module load, so probing
  // earlier would report a missing space walker that is merely late.
  const capabilities = reportCapabilities([
    ...prefProbes(),
    ...browserProbes(),
    ...socketProbes(),
  ]);
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

  const keptSet = new Set(kept.map(({ tab }) => tab));
  for (const { tab } of pinned) {
    setMarker(tab, keptSet.has(tab));
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

  // After the wake: a tab woken in this sweep has an inner window now, and had none
  // when the snapshot was taken. Re-attaching here also picks up navigations.
  watchSockets(kept.map(({ tab }) => tab));
  const sockets = socketSummary(socketRecords(), Date.now());
  log(sockets.message, sockets.lines);
};

/**
 * Every kept tab with the snapshot it was judged on. Read fresh each time rather than
 * kept: the allowlist can have changed, and a tab can have been unloaded, since the
 * last sweep.
 */
const keptTabs = (): Candidate[] => {
  const matchers = parseMatchList(rawMatchList());
  return pinnedTabs()
    .map(tab => ({ tab, facts: factsFor(tab) }))
    .filter(({ facts }) => shouldKeep(facts, matchers));
};

/** The readings for every kept tab, whether or not a listener ever attached. */
const socketRecords = () =>
  keptTabs().map(({ tab, facts }) => socketRecordFor(tab, facts.space, facts.url));

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
    log("another wake is already running — skipping this sweep");
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
  delete state.sockets;
  delete state.fillPanel;
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

// Reports the crash, then hands it to `recover`. The readout is what the recovery
// was written against — the source alone would not have shown the crash page clearing
// `pending`, or the browser staying non-remote (D017, D018).
const onCrash = (tab: BrowserTab, kind: CrashKind) => {
  try {
    // Same gate as the sign log: a crash in a merely-pinned tab is not this mod's
    // business, and reporting one reads as if a kept tab had died (D016).
    if (!shouldKeep(factsFor(tab), parseMatchList(rawMatchList()))) {
      return;
    }
    // Read now, acted on later: everything the plan keys off is rewritten within
    // this dispatch, so the async half works from this snapshot, not from the tab.
    const facts = crashFactsFor(tab, kind);
    const diagnosis = crashDiagnosis(facts);
    log(diagnosis.message, diagnosis.lines);
    // Caught here too: the recovery runs after this dispatch, so the `catch` below
    // cannot see it, and `updateBrowserRemotenessByURL` and `discardBrowser` are
    // both privileged calls that a Zen update could turn into a throw (D017).
    // Nothing to unwind here: `recover` owns the lock it takes, in a `finally`.
    // Clearing it from out here could release a lock a *sweep* holds, if the throw
    // came from the wait rather than from the recovery.
    void recover(tab, facts).catch(error => {
      console.error("[keep-loaded] crash recovery failed", error);
    });
  } catch (error) {
    // Ungated, and caught rather than left to the event loop: a kept tab dying is
    // the report that must not go missing, and an uncaught listener error is easy
    // to filter out of the console by accident — which is how D017's throwing
    // debug-only API cost a full test cycle.
    console.error("[keep-loaded] crash diagnosis failed", error);
  }
};

/**
 * Zen's "unload space" and "unload all other spaces" reach a kept tab: `undiscardable`
 * is read only by the memory-pressure unloader, never by `_mayDiscardBrowser`, and both
 * commands force the discard. Neither can be filtered from outside, so the mod notices
 * and wakes the tab again instead (D005). Releasing the tab from the allowlist is how
 * you make an unload stick — the per-tab toggle is one click (D014).
 */
const onDiscard = (tab: BrowserTab) => {
  try {
    const facts = factsFor(tab);
    const kept = shouldKeep(facts, parseMatchList(rawMatchList()));
    const plan = unloadPlan({
      url: facts.url,
      kept,
      // Unset until the first sweep takes the lock, which is not running.
      busy: state.running === true,
    });
    if (plan.action === "wake") {
      log(plan.message);
      void runSweep();
      return;
    }
    // Only for a tab the mod keeps: a space unload walks every tab in it, and a line
    // each for the ones this mod never claimed would bury the one that matters.
    if (kept) {
      log(`${facts.url} was unloaded — ${plan.reason}`);
    }
  } catch (error) {
    console.error("[keep-loaded] unload handling failed", error);
  }
};

state.disposers.push(observeSigns(onCrash, onDiscard));

/**
 * Sleep and a dropped link are the two ways a kept tab can be taken away with nothing
 * watching: the crash observer only sees processes that die while Zen is running, and
 * a tab the OS reclaimed comes back as an unloaded shell that a sweep can wake (D019).
 */
const onSystemWake = (topic: string, data: string) => {
  try {
    const reason = wakeReason(topic, data);
    if (!reason) {
      return;
    }
    const verdict = networkReady(networkFacts());
    if (!verdict.ready) {
      // Not dropped, deferred: the link coming up is itself one of these topics.
      log(`${reason}, but ${verdict.reason} — waiting for the network`);
      return;
    }
    log(`${reason} — re-sweeping`);
    void runSweep();
  } catch (error) {
    console.error("[keep-loaded] resume handling failed", error);
  }
};

for (const topic of WAKE_TOPICS) {
  state.disposers.push(observeTopic(topic, data => onSystemWake(topic, data)));
}

state.liveness = () => keptTabs().map(recordOf);

/**
 * One row per kept tab, joining the two readings the console commands print separately.
 * Both are read here rather than in `core`, which never sees a tab: the sign ledger and
 * the socket counters are keyed on the tab object itself, and matching them up by url
 * afterwards would confuse two spaces that keep the same site — which is the normal
 * case, not an edge one.
 */
const panelFacts = (): RowFacts[] =>
  keptTabs().map(({ tab, facts }) => {
    const socket = socketRecordFor(tab, facts.space, facts.url);
    return {
      // Zen's own space name, unlike the log lines: a panel is read by a person.
      space: spaceNameFor(tab),
      url: facts.url,
      pending: facts.pending,
      // `recordOf`, not `signFor`: a tab with a live browser and no sign yet is alive
      // enough to record, and seeding it here keeps the panel and the console command
      // saying the same thing about the same tab.
      last: recordOf({ tab, facts }).last,
      frames: socket.watching
        ? { in: socket.framesIn, out: socket.framesOut, lastAt: socket.lastFrameAt }
        : null,
    };
  });

state.fillPanel = body => {
  try {
    renderPanelReport(body, panelReport(panelFacts(), Date.now()));
  } catch (error) {
    console.error("[keep-loaded] could not fill the status panel", error);
    renderPanelLines(body, ["something went wrong — see the Browser Console"]);
  }
};

state.disposers.push(installStatusPanel());

state.disposers.push(stopWatchingSockets);

state.sockets = () => {
  const records = socketRecords();
  return { summary: socketSummary(records, Date.now()).message, tabs: records };
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
