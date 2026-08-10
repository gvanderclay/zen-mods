// Product behavior behind one terminal controller generation. Wakes allowlisted
// pinned tabs after Zen's lazy restore and marks them non-discardable.

import type {
  ApplicationOwnerApi,
  ApplicationOwnerSnapshot,
  ApplicationRegistration,
  WakeCandidate,
  WorkContext,
} from "./application-coordinator.ts";
import type { KeepLoadedController, OperationToken } from "./controller.ts";
import { wakeButtonState } from "./core/actions.ts";
import { reportCapabilities } from "./core/capabilities.ts";
import { type CrashFacts, type CrashKind, crashDiagnosis } from "./core/crash.ts";
import {
  isPulsing,
  type PulseOutcome,
  type PulseSettings,
  type PulseStep,
  parsePulseSettings,
  pulseStep,
  pulseSummary,
} from "./core/freshness.ts";
import {
  type LabelOutcome,
  type LabelStep,
  labelStep,
  labelSummary,
} from "./core/labels.ts";
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
import type { PulseClaimsPort, PulseRecord } from "./core/pulse-claims.ts";
import { parseAttempts, parseWindowMs, recoveryPlan } from "./core/recovery.ts";
import { networkReady, WAKE_TOPICS, wakeReason } from "./core/resume.ts";
import { panelReport, type RowFacts } from "./core/rows.ts";
import { socketSummary } from "./core/sockets.ts";
import { unloadPlan } from "./core/unload.ts";
import {
  browserProbes,
  crashFactsFor,
  factsFor,
  insertBrowser,
  isDocShellActive,
  isLabelManaged,
  isPending,
  isRenamed,
  markUndiscardable,
  observeTitleChanges,
  pageTitle,
  pinnedTabs,
  resetToLazy,
  rollbackWakeCandidate,
  setDocShellActive,
  setFlag,
  setMarker,
  spaceNameFor,
  tabLabel,
  wakeCandidateState,
  whenSessionRestored,
  whenSpacesReady,
  writeLabelFromPage,
} from "./platform/browser.ts";
import { observeSigns, recordSign, signFor } from "./platform/liveness.ts";
import { log } from "./platform/log.ts";
import { installKeepMenuItem } from "./platform/menu.ts";
import {
  installStatusPanel,
  renderPanelAction,
  renderPanelLines,
  renderPanelReport,
} from "./platform/panel.ts";
import { type PreferencesPort, preferences } from "./platform/prefs.ts";
import {
  socketProbes,
  socketRecordFor,
  stopWatchingSocket,
  stopWatchingSockets,
  watchSockets,
} from "./platform/sockets.ts";
import { networkFacts, observeTopic } from "./platform/system.ts";

const WAKE_TIMEOUT_MS = 20000;
const POLL_MS = 100;

let controller: KeepLoadedController;
let settings: PreferencesPort = preferences;
let pulses: PulseClaimsPort<BrowserTab>;
let application: ApplicationRegistration<BrowserTab, CrashFacts> | null = null;
let applicationOwner: ApplicationOwnerApi<BrowserTab, CrashFacts>;
let panelView: Element | null = null;

interface RecoveryUnloadExpectation {
  readonly tab: BrowserTab;
  readonly token: OperationToken;
}

/**
 * Firefox dispatches `TabBrowserDiscarded` synchronously from the discard call. A
 * recovery owns that one discard, but an unload arriving at any other time is a real
 * external signal and must request reconciliation. The token prevents a stale
 * generation from silencing a later generation's unload.
 */
let expectedRecoveryUnload: RecoveryUnloadExpectation | null = null;

const withExpectedRecoveryUnload = <T>(
  tab: BrowserTab,
  token: OperationToken,
  action: () => T,
): T => {
  const previous = expectedRecoveryUnload;
  const current = Object.freeze({ tab, token });
  expectedRecoveryUnload = current;
  try {
    return action();
  } finally {
    if (expectedRecoveryUnload === current) {
      expectedRecoveryUnload = previous;
    }
  }
};

const isExpectedRecoveryUnload = (tab: BrowserTab): boolean => {
  const expected = expectedRecoveryUnload;
  return (
    expected !== null &&
    expected.tab === tab &&
    controller.isCurrentOperation(expected.token)
  );
};

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
const wakeAll = async (
  tabs: BrowserTab[],
  token: OperationToken,
  context: WorkContext,
) => {
  if (!controller.isCurrentOperation(token) || !context.isCurrent()) {
    return "canceled" as const;
  }
  const candidates: WakeCandidate[] = tabs.map(tab =>
    Object.freeze({
      key: tab,
      insert: () => insertBrowser(tab),
      rollback: () =>
        withExpectedRecoveryUnload(tab, token, () => rollbackWakeCandidate(tab)),
      state: () => wakeCandidateState(tab),
    }),
  );
  return context.wakeCandidates(candidates, {
    pollMs: POLL_MS,
    retryLimit: 1,
    timeoutMs: WAKE_TIMEOUT_MS,
  });
};

/**
 * Puts a crashed kept tab back. Success is reported as a `crashed -> awake`
 * transition rather than a line of its own: a tab with a live browser is a sign of
 * life by the same reasoning the sweep seeds one (D016), and the ledger would
 * otherwise keep calling a recovered tab crashed.
 */
const recover = async (tab: BrowserTab, facts: CrashFacts, context: WorkContext) => {
  if (!context.isCurrent() || !controller.isLive()) {
    return;
  }
  const currentTabs = pinnedTabs();
  if (!currentTabs.includes(tab) || !tab.pinned || !isPending(tab)) {
    return;
  }
  const currentPolicyFacts = factsFor(tab);
  if (!shouldKeep(currentPolicyFacts, parseMatchList(settings.readMatch()))) {
    return;
  }
  const ownerRegistration = application;
  if (!ownerRegistration) {
    return;
  }
  const now = Date.now();
  // Settings and the continued need are read at dequeue, but the crash fields stay
  // exactly as the browser event exposed them before Zen rewrote the tab (D017).
  const windowMs = parseWindowMs(settings.readCrashWindow());
  const maxAttempts = parseAttempts(settings.readCrashAttempts());
  const spent = ownerRegistration.recentRecoveryAttempts(tab, now, windowMs);
  const plan = recoveryPlan(facts, { attempts: spent, now, windowMs, maxAttempts });
  log(`${facts.url}: ${plan.reason}`);
  if (plan.action === "skip") {
    return;
  }
  const outcome = await controller.runRecovery(
    tab,
    { pollMs: POLL_MS, timeoutMs: WAKE_TIMEOUT_MS },
    async token => {
      if (!controller.isCurrentOperation(token) || !context.isCurrent()) {
        return;
      }
      // Charged only after the application owner dequeues and revalidates the exact
      // tab, and immediately before the first recovery mutation. The stable owner
      // keeps this ledger across a cache-busted generation without retaining closed
      // tabs (its key is weak).
      const attemptAt = Date.now();
      if (ownerRegistration.chargeRecoveryAttempt(tab, attemptAt, windowMs) === false) {
        return;
      }
      if (
        plan.action === "reset-then-wake" &&
        !withExpectedRecoveryUnload(tab, token, () => resetToLazy(tab, facts.url))
      ) {
        // `_mayDiscardBrowser` never says which of its eight conditions refused.
        log(`${facts.url}: the browser refused to discard, so it stays crashed`);
        return;
      }
      const wake = await wakeAll([tab], token, context);
      if (!controller.isCurrentOperation(token) || !context.isCurrent()) {
        return;
      }
      if (wake === "failed") {
        throw new Error(`${facts.url}: wake transaction failed after rollback`);
      }
      if (wake === "canceled") {
        return;
      }
      if (isPending(tab)) {
        log(`${facts.url}: still pending after recovery`);
        return;
      }
      recordSign(tab, "awake");
    },
  );
  if (outcome === "timed-out") {
    log(`${facts.url}: gave up waiting for a sweep to finish`);
  }
};

const sweep = async (token: OperationToken, context: WorkContext) => {
  if ((await controller.wait(whenSessionRestored())).kind === "stopped") {
    return;
  }
  if ((await controller.wait(whenSpacesReady())).kind === "stopped") {
    return;
  }
  if (!controller.isCurrentOperation(token) || !context.isCurrent()) {
    return;
  }

  // After the awaits: gZenWorkspaces is not populated at module load, so probing
  // earlier would report a missing space walker that is merely late.
  const capabilities = reportCapabilities([
    ...settings.probes(),
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

  const laziness = planLazyPinned(
    settings.readLazyPinnedWanted(),
    context.readOnDemand(),
  );
  context.reconcileOnDemand(settings.readLazyPinnedWanted());
  if (laziness.set !== null) {
    log(laziness.message);
  }

  const matchers = parseMatchList(settings.readMatch());
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
    const wake = await wakeAll(
      asleep.map(({ tab }) => tab),
      token,
      context,
    );
    if (!controller.isCurrentOperation(token) || !context.isCurrent()) {
      return;
    }
    const stuck = asleep.filter(({ tab }) => isPending(tab));
    log(
      wakeSummary(
        asleep.length,
        stuck.map(({ facts }) => facts.url),
      ),
    );
    if (wake === "failed") {
      throw new Error("one or more wake candidates failed after rollback");
    }
    if (wake === "canceled") {
      return;
    }
  }

  const liveness = livenessSummary(kept.map(recordOf), Date.now());
  log(liveness.message, liveness.lines);

  // After the wake: a tab woken in this sweep has an inner window now, and had none
  // when the snapshot was taken. Re-attaching here also picks up navigations.
  watchSockets(
    kept.map(({ tab }) => tab),
    () => controller.isLive(),
  );
  const sockets = socketSummary(socketRecords(), Date.now());
  log(sockets.message, sockets.lines);

  // Also after the wake, and for the same reason: a tab that was asleep has a page to
  // take a title from now. This is the pass that catches every title change that
  // happened while the mod was not loaded — the listener catches the rest.
  relabelAll();
};

/**
 * Every pinned tab with the snapshot it was judged on, and whether the mod keeps it.
 * Read fresh each time rather than kept: the allowlist can have changed, and a tab can
 * have been unloaded, since the last sweep.
 */
const pinnedWithVerdict = (): Array<Candidate & { kept: boolean }> => {
  const matchers = parseMatchList(settings.readMatch());
  return pinnedTabs().map(tab => {
    const facts = factsFor(tab);
    return { tab, facts, kept: shouldKeep(facts, matchers) };
  });
};

const keptTabs = (): Candidate[] => pinnedWithVerdict().filter(item => item.kept);

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

const runSweep = async () => {
  const registration = application;
  if (!controller.isLive() || !registration) {
    return;
  }
  const outcome = await registration.requestSweep().done;
  if (outcome === "failed" && controller.isLive()) {
    log("an application wake failed — see the Browser Console");
  }
};

/** Settings that pulse nothing and release everything, which is what teardown wants. */
const PULSE_OFF: PulseSettings = { everyMs: 0, holdMs: 0 };

/**
 * A record can survive a cache-busted reload, but its active ownership cannot be
 * borrowed by the replacement generation. Treat a record owned by another
 * controller as metadata-only while the new generation decides its next step.
 */
const ownedPulseRecord = (tab: BrowserTab): PulseRecord => {
  const record = pulses.get(tab);
  return pulses.active(controller).some(([candidate]) => candidate === tab)
    ? record
    : { heldSince: null, lastPulseAt: record.lastPulseAt };
};

/** Closed/unpinned tabs must lose timing metadata as well as their active claim. */
const dropPulseClaim = (tab: BrowserTab) => {
  if (!tab.isConnected || !tab.pinned) {
    return pulses.remove(tab, controller);
  }
  return pulses.forget(tab, controller);
};

const pulseSettings = () =>
  parsePulseSettings(settings.readFreshenSeconds(), settings.readFreshenHoldSeconds());

/**
 * Carries out one step and reports what actually happened, which is not always what was
 * decided: `docShellIsActive` is a privileged setter, and a log line claiming a pulse
 * that never landed is worse than no line at all.
 */
const applyPulse = (tab: BrowserTab, step: PulseStep, now: number): PulseStep => {
  switch (step.action) {
    case "activate":
      // Claim before touching the docshell. This keeps a stale generation from
      // activating a tab after a replacement has acquired the same record.
      if (!pulses.set(tab, controller, { heldSince: now, lastPulseAt: now })) {
        return { action: "skip", reason: "another generation owns its docshell claim" };
      }
      if (!setDocShellActive(tab, true)) {
        // Backed off a full interval rather than retried next tick: whatever refused
        // will refuse again, and `setDocShellActive` has already said why.
        stopWatchingSocket(tab);
        dropPulseClaim(tab);
        return { action: "skip", reason: "its docshell refused to activate" };
      }
      return step;
    case "release":
      if (pulses.active(controller).some(([candidate]) => candidate === tab)) {
        if (!tab.selected && tab.isConnected) {
          setDocShellActive(tab, false);
        }
        dropPulseClaim(tab);
      }
      return step;
    // Nothing is written: the docshell stopped being ours, so the claim is all there
    // is to drop. `lastPulseAt` stays, so the tab waits out its interval as usual.
    case "forget":
      stopWatchingSocket(tab);
      dropPulseClaim(tab);
      return step;
    default:
      return step;
  }
};

/** Release only this generation's claim; socket liveness is an independent resource. */
const releasePulseClaim = (tab: BrowserTab) => {
  if (!pulses.active(controller).some(([candidate]) => candidate === tab)) {
    return;
  }
  const active = tab.isConnected && isDocShellActive(tab);
  if (!active || tab.selected) {
    // An external deactivation is a forget, not a release; its socket watcher is
    // equally stale and must not survive the claim disappearing.
    stopWatchingSocket(tab);
  }
  if (!tab.selected && tab.isConnected && active) {
    setDocShellActive(tab, false);
  }
  dropPulseClaim(tab);
};

/**
 * Synchronous release/cleanup pass used for settings-off and generation teardown. The
 * normal enabled path is `pulseCycle`, whose application owner walks one tab at a time.
 */
const pulseOnce = (settings: PulseSettings): void => {
  const now = Date.now();
  const outcomes: PulseOutcome[] = [];
  const visited = new Set<BrowserTab>();
  for (const { tab, facts, kept } of pinnedWithVerdict()) {
    visited.add(tab);
    const { heldSince, lastPulseAt } = ownedPulseRecord(tab);
    const step = pulseStep(
      {
        url: facts.url,
        kept,
        pending: facts.pending,
        selected: tab.selected,
        active: isDocShellActive(tab),
        heldSince,
        lastPulseAt,
      },
      settings,
      now,
    );
    outcomes.push({ url: facts.url, step: applyPulse(tab, step, now) });
  }
  // An active claim is intentionally iterable because the tab may no longer be
  // pinned, may have closed, or may have dropped out of the allowlist. Such a tab
  // will never appear in `pinnedWithVerdict`, so release it here instead of waiting
  // for a reload or a process-wide stop.
  for (const [tab] of pulses.active(controller)) {
    if (visited.has(tab)) {
      continue;
    }
    releasePulseClaim(tab);
  }
  const report = pulseSummary(outcomes);
  if (report) {
    log(report.message, report.lines);
  }
};

const waitPulseHold = (
  delayMs: number,
  context: WorkContext,
): Promise<"elapsed" | "canceled" | "stopped"> => {
  if (delayMs <= 0) {
    return Promise.resolve("elapsed");
  }
  return new Promise(resolve => {
    let settled = false;
    let cancel = () => {};
    const finish = (result: "elapsed" | "canceled" | "stopped") => {
      if (settled) {
        return;
      }
      settled = true;
      context.signal.removeEventListener("abort", onAbort);
      cancel();
      resolve(result);
    };
    const onAbort = () => finish("canceled");
    context.signal.addEventListener("abort", onAbort, { once: true });
    try {
      cancel = controller.schedule(delayMs, () =>
        finish(controller.isLive() ? "elapsed" : "stopped"),
      );
    } catch (error) {
      console.error("[keep-loaded] freshness hold could not be scheduled", error);
      finish("stopped");
    }
    if (context.signal.aborted) {
      finish("canceled");
    }
  });
};

/**
 * One application-owned cycle. The application owner invokes one window delegate at a
 * time, and this delegate holds at most one tab before moving to the next. That makes
 * the application-wide serial guarantee concrete rather than merely a timer rule.
 */
const pulseCycle = async (
  settings: PulseSettings,
  context: WorkContext,
): Promise<void> => {
  const outcomes: PulseOutcome[] = [];
  const visited = new Set<BrowserTab>();
  const candidates = pinnedWithVerdict();
  for (const { tab, facts, kept } of candidates) {
    if (!context.isCurrent() || !controller.isLive()) {
      return;
    }
    if (!isPulsing(pulseSettings())) {
      return;
    }
    visited.add(tab);
    const record = ownedPulseRecord(tab);
    const step = pulseStep(
      {
        url: facts.url,
        kept,
        pending: facts.pending,
        selected: tab.selected,
        active: isDocShellActive(tab),
        heldSince: record.heldSince,
        lastPulseAt: record.lastPulseAt,
      },
      settings,
      Date.now(),
    );
    const actual = applyPulse(tab, step, Date.now());
    outcomes.push({ url: facts.url, step: actual });
    if (actual.action !== "activate") {
      continue;
    }
    if ((await waitPulseHold(settings.holdMs, context)) !== "elapsed") {
      return;
    }
    if (!context.isCurrent() || !controller.isLive() || !isPulsing(pulseSettings())) {
      return;
    }
    if (pulses.active(controller).some(([candidate]) => candidate === tab)) {
      releasePulseClaim(tab);
      outcomes.push({
        url: facts.url,
        step: { action: "release", reason: `its ${settings.holdMs / 1000}s pulse is up` },
      });
    }
  }
  // A claim can disappear from the pinned inventory while this serial cycle is in
  // progress. Keep the iterable cleanup guarantee from the synchronous pass.
  for (const [tab] of pulses.active(controller)) {
    if (!visited.has(tab)) {
      releasePulseClaim(tab);
    }
  }
  const report = pulseSummary(outcomes);
  if (report) {
    log(report.message, report.lines);
  }
};

/**
 * Release all resources that are local to one tab. The operation is deliberately
 * idempotent: close/unpin/selection and a queued generation stop can report the same
 * tab more than once, and none may re-open it or touch a replacement claim.
 */
const releaseTabResources = (tab: BrowserTab) => {
  stopWatchingSocket(tab);
  const ownsClaim = pulses.active(controller).some(([candidate]) => candidate === tab);
  if (!ownsClaim) {
    return;
  }
  if (!tab.selected && tab.isConnected) {
    setDocShellActive(tab, false);
  }
  dropPulseClaim(tab);
};

/** Release socket/claim resources immediately when eligibility changes. */
const releaseIneligibleResources = () => {
  const matchers = parseMatchList(settings.readMatch());
  for (const tab of pinnedTabs()) {
    try {
      if (!tab.pinned || !shouldKeep(factsFor(tab), matchers)) {
        releaseTabResources(tab);
      }
    } catch {
      // A tab leaving its window can disappear between the inventory and facts read;
      // the close/discard event will perform the same idempotent release if needed.
      releaseTabResources(tab);
    }
  }
  for (const [tab] of pulses.active(controller)) {
    if (!tab.pinned) {
      releaseTabResources(tab);
    }
  }
};

/**
 * Matches the application-owned schedule to the settings. Turning freshening off still
 * releases this generation's claims synchronously; the stable owner cancels future
 * application pulses.
 */
const syncPulse = () => {
  if (!controller.isLive()) {
    // A reload landed while the startup sweep was still awaiting: this instance is torn
    // down already, and activating a docshell now would leave one behind.
    return;
  }
  const settings = pulseSettings();
  application?.setPulseSchedule(settings);
  if (!isPulsing(settings)) {
    log("freshness: off");
    pulseOnce(PULSE_OFF);
    return;
  }
  log(
    `freshness: running each kept tab's page for ${settings.holdMs / 1000}s every ${settings.everyMs / 1000}s`,
  );
  // Preserve the existing responsive enable behavior: the first cycle starts now;
  // the application scheduler owns every later intended deadline.
  void application?.requestPulse().done;
};

/**
 * One tab's label, brought up to date with its page. Reports what actually happened
 * rather than what was decided: `setTabTitle` returns false both when Zen refuses and
 * when the label it derived is the one already there, and a line claiming a rewrite that
 * never landed is worse than no line at all.
 */
const relabel = (tab: BrowserTab, facts: TabFacts, kept: boolean): LabelStep => {
  const step = labelStep({
    url: facts.url,
    kept,
    pending: facts.pending,
    title: pageTitle(tab),
    label: tabLabel(tab),
    renamed: isRenamed(tab),
    managed: isLabelManaged(tab),
  });
  if (step.action !== "write") {
    return step;
  }
  return writeLabelFromPage(tab)
    ? step
    : { action: "skip", reason: "its label refused to change" };
};

/** Every pinned tab at once: the startup case, where no event is coming. */
const relabelAll = () => {
  const outcomes: LabelOutcome[] = pinnedWithVerdict().map(({ tab, facts, kept }) => ({
    url: facts.url,
    step: relabel(tab, facts, kept),
  }));
  const report = labelSummary(outcomes);
  if (report) {
    log(report.message, report.lines);
  }
};

/**
 * The one-tab path, run for every title change in the window. Deliberately silent: Gmail
 * retitles on every poll, and a line each time would bury everything else the mod says.
 * The tab strip is the evidence here.
 */
const relabelOne = (tab: BrowserTab) => {
  // Cheap first: this runs for every tab in the window, and only pinned tabs are ever
  // kept, so an unpinned tab is not worth a snapshot.
  if (!tab.pinned) {
    return;
  }
  try {
    const facts = factsFor(tab);
    relabel(tab, facts, shouldKeep(facts, parseMatchList(settings.readMatch())));
  } catch (error) {
    console.error("[keep-loaded] could not bring a tab's title up to date", error);
  }
};

// Reports the crash, then queues the exact event snapshot. Recovery rereads mutable
// policy, membership, need, settings, and budget at application dequeue, but Zen has
// already rewritten the crash fields by then (D017, M12.C01).
const onCrash = (tab: BrowserTab, kind: CrashKind) => {
  if (!controller.isLive()) {
    return;
  }
  try {
    // Same gate as the sign log: a crash in a merely-pinned tab is not this mod's
    // business, and reporting one reads as if a kept tab had died (D016).
    if (!shouldKeep(factsFor(tab), parseMatchList(settings.readMatch()))) {
      return;
    }
    const facts = crashFactsFor(tab, kind);
    const diagnosis = crashDiagnosis(facts);
    log(diagnosis.message, diagnosis.lines);
    void application?.requestRecovery(tab, facts).done;
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
  if (!controller.isLive()) {
    return;
  }
  // The browser has already gone lazy by the time this event is delivered. Drop
  // our socket and docshell ownership before deciding whether a kept tab should be
  // re-woken; the re-wake, if any, belongs to the application transaction.
  releaseTabResources(tab);
  if (isExpectedRecoveryUnload(tab)) {
    return;
  }
  try {
    const facts = factsFor(tab);
    const kept = shouldKeep(facts, parseMatchList(settings.readMatch()));
    const plan = unloadPlan({
      url: facts.url,
      kept,
      // Unset until the first sweep takes the lock, which is not running.
      busy: controller.isBusy(),
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

/**
 * Sleep and a dropped link are the two ways a kept tab can be taken away with nothing
 * watching: the crash observer only sees processes that die while Zen is running, and
 * a tab the OS reclaimed comes back as an unloaded shell that a sweep can wake (D019).
 */
const onSystemWake = (topic: string, data: string) => {
  if (!controller.isLive()) {
    return;
  }
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

const liveness = () => (controller.isLive() ? keptTabs().map(recordOf) : []);

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

const fillPanel = (view: Element) => {
  // The stable widget dispatcher may outlive a cache-busted window module. It hands
  // us only a current host's view, but retain this exact node check so a retained old
  // facade cannot render into a replacement generation's panel.
  if (!controller.isLive() || view !== panelView) {
    return;
  }
  try {
    const facts = panelFacts();
    renderPanelReport(view, panelReport(facts, Date.now()));
    renderPanelAction(
      view,
      wakeButtonState({
        kept: facts.length,
        sleeping: facts.filter(item => item.pending).length,
        busy: application?.isApplicationBusy() ?? controller.isBusy(),
      }),
    );
  } catch (error) {
    console.error("[keep-loaded] could not fill the status panel", error);
    renderPanelLines(view, ["something went wrong — see the Browser Console"]);
  }
};

const sockets = () => {
  if (!controller.isLive()) {
    return { summary: "Keep Loaded is not running in this window", tabs: [] };
  }
  const records = socketRecords();
  return { summary: socketSummary(records, Date.now()).message, tabs: records };
};

export interface KeepLoadedRuntime {
  application(): {
    registrationId: string | null;
    snapshot: ApplicationOwnerSnapshot;
  };
  start(): Promise<void>;
  runSweep(): Promise<void>;
  fillPanel(view: Element): void;
  liveness(): ReturnType<typeof liveness>;
  sockets(): ReturnType<typeof sockets>;
}

let initialized = false;

export const createKeepLoadedRuntime = ({
  application: ownerApplication,
  owner,
  preferences: preferencePort = preferences,
  pulseClaims,
}: {
  application: ApplicationOwnerApi<BrowserTab, CrashFacts>;
  owner: KeepLoadedController;
  preferences?: PreferencesPort;
  pulseClaims: PulseClaimsPort<BrowserTab>;
}): KeepLoadedRuntime => {
  if (initialized) {
    throw new Error("Keep Loaded runtime already has a controller generation");
  }
  initialized = true;
  controller = owner;
  applicationOwner = ownerApplication;
  settings = preferencePort;
  pulses = pulseClaims;
  panelView = null;

  const start = async () => {
    if (!controller.isLive()) {
      return;
    }

    // Registered first so the final line is emitted after every other disposer.
    controller.defer(() => log("unloaded"));
    controller.defer(() => {
      // The stylesheet goes away too, but an owner leaves no DOM traces behind.
      for (const tab of pinnedTabs()) {
        setMarker(tab, false);
      }
    });

    controller.defer(
      settings.observe("match", () => {
        if (!controller.isLive()) {
          return;
        }
        releaseIneligibleResources();
        log("allowlist changed — re-sweeping");
        void runSweep();
      }),
    );
    controller.defer(
      settings.observe("lazy-pinned", () => {
        if (!controller.isLive()) {
          return;
        }
        application?.reconcileOnDemand(settings.readLazyPinnedWanted());
        log("lazy pinned tabs setting changed — re-sweeping");
        void runSweep();
      }),
    );

    // Scope cancellation happens before permanent disposal; then release every held
    // docshell synchronously while no ticker can re-activate one.
    controller.defer(() => pulseOnce(PULSE_OFF));

    controller.defer(
      observeTitleChanges(tab => {
        if (controller.isLive()) {
          relabelOne(tab);
        }
      }),
    );

    for (const preference of ["freshen", "freshen-hold"] as const) {
      controller.defer(
        settings.observe(preference, () => {
          if (controller.isLive()) {
            syncPulse();
          }
        }),
      );
    }

    controller.defer(
      observeSigns(
        () => controller.isLive(),
        onCrash,
        onDiscard,
        tab => {
          releaseTabResources(tab);
          application?.invalidateTab(tab);
        },
        tab => {
          releaseTabResources(tab);
          application?.invalidateTab(tab);
        },
      ),
    );

    for (const topic of WAKE_TOPICS) {
      controller.defer(observeTopic(topic, data => onSystemWake(topic, data)));
    }

    // Register before installing the panel so the stable application owner can make
    // the first/last CustomizableUI decision. The disposal defer is intentionally
    // added after the panel below, so it still cancels application work first.
    const registration = applicationOwner.register({
      isLive: () => controller.isLive(),
      pulse: context => pulseCycle(pulseSettings(), context),
      sweep: async context => {
        const outcome = await controller.runSweep(token => sweep(token, context));
        if (outcome === "busy") {
          throw new Error("application owner invoked a busy window sweep");
        }
      },
      recover: (context, tab, facts) => recover(tab, facts, context),
      reportError: error => {
        console.error("[keep-loaded] application work failed", error);
      },
    });
    application = registration;

    let disposePanel: ReturnType<typeof installStatusPanel>;
    try {
      disposePanel = installStatusPanel({
        widgetOwner: registration,
        isLive: () => controller.isLive(),
        onViewReady: view => {
          panelView = view;
        },
        onViewShowing: view => fillPanel(view),
        onWidgetError: error => {
          console.error("[keep-loaded] status widget creation failed", error);
          controller.stop("startup-failure");
        },
        onWake: view => {
          if (!controller.isLive()) {
            return;
          }
          const wake = runSweep();
          fillPanel(view);
          void controller.settlePanel(
            wake,
            () => fillPanel(view),
            error => {
              console.error("[keep-loaded] waking from the panel failed", error);
              fillPanel(view);
            },
          );
        },
      });
    } catch (error) {
      // The normal disposer is registered below, so cover a failed first-widget
      // creation here before main.ts turns the generation terminal.
      panelView = null;
      registration.dispose("generation-ended");
      if (application === registration) {
        application = null;
      }
      throw error;
    }
    controller.defer(() => {
      panelView = null;
      disposePanel();
    });

    controller.defer(stopWatchingSockets);
    controller.defer(
      installKeepMenuItem(
        () => controller.isLive(),
        tab => keepMenuState(factsFor(tab), parseMatchList(settings.readMatch())),
        tab => {
          if (!controller.isLive()) {
            return;
          }
          const facts = factsFor(tab);
          setFlag(tab, !facts.flagged);
          if (facts.flagged) {
            application?.invalidateTab(tab);
          }
          log(`${facts.flagged ? "released" : "kept"} ${facts.url}`);
          void runSweep();
        },
      ),
    );

    // Registered last so it unregisters first after the controller becomes terminal.
    controller.defer(() => {
      registration.dispose(
        controller.stopReason === "window-unload" ? "window-closed" : "generation-ended",
      );
      if (application === registration) {
        application = null;
      }
    });

    await runSweep();
    if (controller.isLive()) {
      // After the sweep, so a tab it woke has a page to run.
      syncPulse();
    }
  };

  return {
    application: () => ({
      registrationId: application?.id ?? null,
      snapshot: applicationOwner.snapshot(),
    }),
    start,
    runSweep,
    fillPanel,
    liveness,
    sockets,
  };
};
