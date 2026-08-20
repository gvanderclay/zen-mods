// Product behavior behind one terminal controller generation. Wakes allowlisted
// pinned tabs after Zen's lazy restore and marks them non-discardable.

import type {
  ApplicationOwnerApi,
  ApplicationOwnerSnapshot,
  ApplicationRegistration,
} from "./application-coordinator.ts";
import type { KeepLoadedController } from "./controller.ts";
import { type CrashFacts, type CrashKind, crashDiagnosis } from "./core/crash.ts";
import { isPulsing } from "./core/freshness.ts";
import {
  type LabelOutcome,
  type LabelStep,
  labelStep,
  labelSummary,
} from "./core/labels.ts";
import { panelPresentation } from "./core/panel-presentation.ts";
import { keepMenuState, shouldKeep, type TabFacts } from "./core/policy.ts";
import type { PulseClaimsPort } from "./core/pulse-claims.ts";
import { networkReady, WAKE_TOPICS, wakeReason } from "./core/resume.ts";
import { panelReport, type RowFacts } from "./core/rows.ts";
import { socketSummary } from "./core/sockets.ts";
import { unloadPlan } from "./core/unload.ts";
import { shortUrl } from "./core/url.ts";
import {
  crashFactsFor,
  factsFor,
  isPending,
  pinnedTabs,
  setFlag,
  setMarker,
  spaceNameFor,
} from "./platform/browser.ts";
import {
  isLabelManaged,
  isRenamed,
  observeTitleChanges,
  pageTitle,
  tabLabel,
  writeLabelFromPage,
} from "./platform/label.ts";
import { observeSigns } from "./platform/liveness.ts";
import { log, logLazy } from "./platform/log.ts";
import { installKeepMenuItem } from "./platform/menu.ts";
import { installStatusPanel } from "./platform/panel.ts";
import { renderPanelPresentation } from "./platform/panel-render.ts";
import { type PreferencesPort, preferences } from "./platform/prefs.ts";
import { socketRecordFor, stopWatchingSockets } from "./platform/sockets.ts";
import { networkFacts, observeTopic } from "./platform/system.ts";
import { createPulseCycle } from "./pulse-cycle.ts";
import {
  createPulseOwnership,
  PULSE_OFF,
  type PulseOwnership,
} from "./pulse-ownership.ts";
import {
  keptTabs,
  pinnedWithVerdict,
  recordOf,
  socketRecords,
  type VerdictCandidate,
} from "./tab-inventory.ts";
import { createWindowRecovery } from "./window-recovery.ts";
import { createWindowSweep } from "./window-sweep.ts";
import { createWindowWake, type WindowWake } from "./window-wake.ts";

let controller: KeepLoadedController;
let settings: PreferencesPort = preferences;
let pulses: PulseClaimsPort<BrowserTab>;
let application: ApplicationRegistration<BrowserTab, CrashFacts> | null = null;
let applicationOwner: ApplicationOwnerApi<BrowserTab, CrashFacts>;
let panelView: Element | null = null;
let panelFeedback: string | null = null;
let windowWake: WindowWake;
let recover: ReturnType<typeof createWindowRecovery>;
let sweep: ReturnType<typeof createWindowSweep>;
let pulseOwnership: PulseOwnership;
let pulseCycle: ReturnType<typeof createPulseCycle>;

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

const pulseSettings = () => settings.snapshot().freshen;

/** Release socket/claim resources immediately when eligibility changes. */
const releaseIneligibleResources = () => {
  const matchers = settings.snapshot().match;
  for (const tab of pinnedTabs()) {
    try {
      if (!tab.pinned || !shouldKeep(factsFor(tab), matchers)) {
        pulseOwnership.releaseTabResources(tab);
        application?.invalidateTab(tab);
      }
    } catch {
      // A tab leaving its window can disappear between the inventory and facts read;
      // the close/discard event will perform the same idempotent release if needed.
      pulseOwnership.releaseTabResources(tab);
      application?.invalidateTab(tab);
    }
  }
  for (const [tab] of pulses.active(controller)) {
    if (!tab.pinned) {
      pulseOwnership.releaseTabResources(tab);
      application?.invalidateTab(tab);
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
    pulseOwnership.pulseOnce(PULSE_OFF);
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
interface LabelState {
  readonly managed: boolean;
  readonly pending: boolean;
  readonly renamed: boolean;
}

const relabel = (
  tab: BrowserTab,
  facts: TabFacts,
  kept: boolean,
  state: LabelState = {
    managed: isLabelManaged(tab),
    pending: facts.pending,
    renamed: isRenamed(tab),
  },
): LabelStep => {
  const step = labelStep({
    url: facts.url,
    kept,
    pending: state.pending,
    title: pageTitle(tab),
    label: tabLabel(tab),
    renamed: state.renamed,
    managed: state.managed,
  });
  if (step.action !== "write") {
    return step;
  }
  return writeLabelFromPage(tab)
    ? step
    : { action: "skip", reason: "its label refused to change" };
};

/** Every pinned tab at once: the startup case, where no event is coming. */
const relabelAll = (
  candidates: readonly VerdictCandidate[] = pinnedWithVerdict(settings),
) => {
  const outcomes: LabelOutcome[] = candidates.map(({ tab, facts, kept }) => ({
    url: facts.url,
    step: relabel(tab, facts, kept),
  }));
  logLazy(() => {
    const report = labelSummary(outcomes);
    return report ? [report.message, report.lines] : null;
  });
};

/**
 * The one-tab path, run for every title change in the window. Deliberately silent: Gmail
 * retitles on every poll, and a line each time would bury everything else the mod says.
 * The tab strip is the evidence here.
 */
const relabelOne = (tab: BrowserTab) => {
  // Cheap first: this runs for every tab in the window. These guards are plain tab
  // properties; the rejected path never needs URL/space/SessionStore fact collection.
  if (!tab.pinned) {
    return;
  }
  try {
    const state = {
      managed: isLabelManaged(tab),
      pending: isPending(tab),
      renamed: isRenamed(tab),
    };
    if (state.pending || state.renamed || state.managed) {
      return;
    }
    const facts = factsFor(tab, state.pending);
    relabel(tab, facts, shouldKeep(facts, settings.snapshot().match), state);
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
    if (!shouldKeep(factsFor(tab), settings.snapshot().match)) {
      return;
    }
    const facts = crashFactsFor(tab, kind);
    logLazy(() => {
      const diagnosis = crashDiagnosis(facts);
      return [diagnosis.message, diagnosis.lines];
    });
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
  pulseOwnership.releaseTabResources(tab);
  if (windowWake.isExpectedRecoveryUnload(tab)) {
    return;
  }
  try {
    const facts = factsFor(tab);
    const kept = shouldKeep(facts, settings.snapshot().match);
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

const liveness = () => (controller.isLive() ? keptTabs(settings).map(recordOf) : []);

/**
 * One row per kept tab, joining the two readings the console commands print separately.
 * Both are read here rather than in `core`, which never sees a tab: the sign ledger and
 * the socket counters are keyed on the tab object itself, and matching them up by url
 * afterwards would confuse two spaces that keep the same site — which is the normal
 * case, not an edge one.
 */
const panelFacts = (now: number): { rows: RowFacts[]; sleeping: number } => {
  const rows: RowFacts[] = [];
  let sleeping = 0;
  const snapshot = settings.snapshot();
  const operation = controller.state.kind === "live" ? controller.state.operation : null;
  for (const { tab, facts } of keptTabs(settings)) {
    if (facts.pending) {
      sleeping += 1;
    }
    const socket = socketRecordFor(tab, facts.space, facts.url);
    rows.push({
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
      recovery: {
        active: operation?.kind === "recovery" && operation.tab === tab,
        attempts:
          application?.recentRecoveryAttempts(tab, now, snapshot.crashWindowMs).length ??
          0,
        maxAttempts: snapshot.crashAttempts,
      },
    });
  }
  return { rows, sleeping };
};

const fillPanel = (view: Element) => {
  // The stable widget dispatcher may outlive a cache-busted window module. It hands
  // us only a current host's view, but retain this exact node check so a retained old
  // facade cannot render into a replacement generation's panel.
  if (!controller.isLive() || view !== panelView) {
    return;
  }
  try {
    const now = Date.now();
    const facts = panelFacts(now);
    const owner = applicationOwner.snapshot();
    const localOperation =
      controller.state.kind === "live" ? controller.state.operation : null;
    const progress = owner.activeKind
      ? owner.activeKind === "recovery"
        ? localOperation?.kind === "recovery"
          ? `Recovering ${shortUrl(factsFor(localOperation.tab).url) || "kept tab"}…`
          : "Recovering a kept tab…"
        : owner.activeKind === "pulse"
          ? "Refreshing kept tabs…"
          : facts.sleeping > 0
            ? `Waking ${facts.sleeping} sleeping ${facts.sleeping === 1 ? "tab" : "tabs"}…`
            : "Checking kept tabs…"
      : null;
    renderPanelPresentation(
      view,
      panelPresentation({
        kind: "snapshot",
        kept: facts.rows.length,
        progress,
        report: panelReport(facts.rows, now),
        sleeping: facts.sleeping,
        busy: application?.isApplicationBusy() ?? controller.isBusy(),
        busyActionLabel:
          owner.activeKind === "recovery"
            ? "Recovering…"
            : owner.activeKind === "pulse"
              ? "Refreshing…"
              : "Waking…",
        feedback: panelFeedback,
        hasRecoveryAttempts: application?.hasRecoveryAttempts() ?? false,
      }),
    );
  } catch (error) {
    console.error("[keep-loaded] could not fill the status panel", error);
    renderPanelPresentation(view, panelPresentation({ kind: "unavailable" }));
  }
};

const sockets = () => {
  if (!controller.isLive()) {
    return { summary: "Keep Loaded is not running in this window", tabs: [] };
  }
  const records = socketRecords(keptTabs(settings));
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
  panelFeedback = null;
  windowWake = createWindowWake(owner);
  pulseOwnership = createPulseOwnership({ controller: owner, pulses: pulseClaims });
  pulseCycle = createPulseCycle({
    application: () => application,
    controller: owner,
    ownership: pulseOwnership,
    pulseSettings,
    pulses: pulseClaims,
    settings,
  });
  recover = createWindowRecovery({
    application: () => application,
    controller: owner,
    settings,
    wake: windowWake,
  });
  sweep = createWindowSweep({
    controller: owner,
    relabelAll,
    settings,
    wake: windowWake,
  });

  const start = async () => {
    if (!controller.isLive()) {
      return;
    }

    // A failed native hand-back remains in the reload-surviving ledger. Retry it with
    // the exact old owner token before this generation can acquire new claims.
    pulseOwnership.releaseOrphanedPulseClaims();

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
        application?.reconcileOnDemand(settings.snapshot().lazyPinnedWanted);
        log("lazy pinned tabs setting changed — re-sweeping");
        void runSweep();
      }),
    );

    for (const preference of ["crash-attempts", "crash-window", "debug"] as const) {
      controller.defer(settings.observe(preference, () => {}));
    }

    // Scope cancellation happens before permanent disposal; then release every held
    // docshell synchronously while no ticker can re-activate one.
    controller.defer(() => pulseOwnership.pulseOnce(PULSE_OFF));

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
          pulseOwnership.releaseTabResources(tab);
          application?.invalidateTab(tab);
        },
        tab => {
          pulseOwnership.releaseTabResources(tab);
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
      refreshStatusPanel: () => {
        if (panelView) {
          fillPanel(panelView);
        }
      },
      reportError: error => {
        console.error("[keep-loaded] application work failed", error);
      },
    });
    application = registration;

    let panelResource: Readonly<{
      dispose: ReturnType<typeof installStatusPanel>;
      view: Element | null;
    }> | null = null;
    const disposePanelResource = () => {
      const current = panelResource;
      if (!current) {
        return false;
      }
      panelResource = null;
      if (panelView === current.view) {
        panelView = null;
      }
      current.dispose();
      return true;
    };
    const installPanelResource = () => {
      if (!controller.isLive() || panelResource) {
        return false;
      }
      let installedView: Element | null = null;
      const dispose = installStatusPanel({
        widgetOwner: registration,
        isLive: () => controller.isLive(),
        onViewReady: view => {
          installedView = view;
          panelView = view;
        },
        onViewShowing: view => fillPanel(view),
        onWidgetError: error => {
          console.error("[keep-loaded] status widget creation failed", error);
          controller.stop("startup-failure");
        },
        onReset: view => {
          if (!controller.isLive() || view !== panelView) {
            return;
          }
          if (registration.resetRecoveryAttempts()) {
            panelFeedback = "Crash recovery history reset for this Zen session";
            fillPanel(view);
          }
        },
        onWake: view => {
          if (!controller.isLive()) {
            return;
          }
          const wake = runSweep();
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
      if (!controller.isLive()) {
        dispose();
        return false;
      }
      panelResource = Object.freeze({ dispose, view: installedView });
      return true;
    };
    controller.defer(disposePanelResource);
    controller.defer(
      settings.observe("status-button", () => {
        if (!controller.isLive()) {
          return;
        }
        if (settings.snapshot().showStatusButton) {
          try {
            installPanelResource();
          } catch (error) {
            console.error("[keep-loaded] status widget creation failed", error);
            controller.stop("startup-failure");
          }
        } else {
          disposePanelResource();
        }
      }),
    );
    if (settings.snapshot().showStatusButton) {
      try {
        installPanelResource();
      } catch (error) {
        // The normal registration disposer is added below, so cover failed initial
        // creation before main.ts turns the generation terminal.
        disposePanelResource();
        registration.dispose("generation-ended");
        if (application === registration) {
          application = null;
        }
        throw error;
      }
    }

    controller.defer(stopWatchingSockets);
    controller.defer(
      installKeepMenuItem(
        () => controller.isLive(),
        tab => keepMenuState(factsFor(tab), settings.snapshot().match),
        tab => {
          if (!controller.isLive()) {
            return;
          }
          const facts = factsFor(tab);
          setFlag(tab, !facts.flagged, facts.flagged);
          if (facts.flagged) {
            pulseOwnership.releaseTabResources(tab);
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
