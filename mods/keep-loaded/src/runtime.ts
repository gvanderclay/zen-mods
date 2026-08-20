// Product behavior behind one terminal controller generation. Wakes allowlisted
// pinned tabs after Zen's lazy restore and marks them non-discardable.

import type {
  ApplicationOwnerApi,
  ApplicationOwnerSnapshot,
} from "./application-owner-contracts.ts";
import type { ApplicationRegistration } from "./application-protocol.ts";
import type { KeepLoadedController } from "./controller.ts";
import type { CrashFacts } from "./core/crash.ts";
import { keepMenuState } from "./core/policy.ts";
import type { PulseClaimsPort } from "./core/pulse-claims.ts";
import { socketSummary } from "./core/sockets.ts";
import { factsFor, setFlag } from "./platform/browser.ts";
import { log } from "./platform/log.ts";
import { installKeepMenuItem } from "./platform/menu.ts";
import { type PreferencesPort, preferences } from "./platform/prefs.ts";
import { stopWatchingSockets } from "./platform/sockets.ts";
import { createPulseCycle } from "./pulse-cycle.ts";
import { createPulseOwnership, type PulseOwnership } from "./pulse-ownership.ts";
import { createStatusPanel } from "./status-panel.ts";
import { createTabEvents } from "./tab-events.ts";
import { keptTabs, recordOf, socketRecords } from "./tab-inventory.ts";
import { createTabLabels } from "./tab-labels.ts";
import { observeWindow } from "./window-observers.ts";
import { createWindowRecovery } from "./window-recovery.ts";
import { createWindowSweep } from "./window-sweep.ts";
import { createWindowWake, type WindowWake } from "./window-wake.ts";

let controller: KeepLoadedController;
let settings: PreferencesPort = preferences;
let application: ApplicationRegistration<BrowserTab, CrashFacts> | null = null;
let applicationOwner: ApplicationOwnerApi<BrowserTab, CrashFacts>;
let windowWake: WindowWake;
let recover: ReturnType<typeof createWindowRecovery>;
let sweep: ReturnType<typeof createWindowSweep>;
let pulseOwnership: PulseOwnership;
let pulse: ReturnType<typeof createPulseCycle>;
let tabLabels: ReturnType<typeof createTabLabels>;
let tabEvents: ReturnType<typeof createTabEvents>;
let statusPanel: ReturnType<typeof createStatusPanel>;

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

const liveness = () => (controller.isLive() ? keptTabs(settings).map(recordOf) : []);

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
  tabLabels = createTabLabels(settings);
  statusPanel = createStatusPanel({
    application: () => application,
    applicationOwner: ownerApplication,
    controller: owner,
    runSweep,
    settings,
  });
  windowWake = createWindowWake(owner);
  pulseOwnership = createPulseOwnership({ controller: owner, pulses: pulseClaims });
  pulse = createPulseCycle({
    application: () => application,
    controller: owner,
    ownership: pulseOwnership,
    pulseSettings,
    pulses: pulseClaims,
    settings,
  });
  tabEvents = createTabEvents({
    application: () => application,
    controller: owner,
    pulseOwnership,
    pulses: pulseClaims,
    runSweep,
    settings,
    windowWake,
  });
  recover = createWindowRecovery({
    application: () => application,
    controller: owner,
    settings,
    wake: windowWake,
  });
  sweep = createWindowSweep({
    controller: owner,
    relabelAll: tabLabels.relabelAll,
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

    observeWindow({
      application: () => application,
      controller,
      pulse,
      pulseOwnership,
      runSweep,
      settings,
      tabEvents,
      tabLabels,
    });

    // Register before installing the panel so the stable application owner can make
    // the first/last CustomizableUI decision. The disposal defer is intentionally
    // added after the panel below, so it still cancels application work first.
    const registration = applicationOwner.register({
      isLive: () => controller.isLive(),
      pulse: context => pulse.pulseCycle(pulseSettings(), context),
      sweep: async context => {
        const outcome = await controller.runSweep(token => sweep(token, context));
        if (outcome === "busy") {
          throw new Error("application owner invoked a busy window sweep");
        }
      },
      recover: (context, tab, facts) => recover(tab, facts, context),
      refreshStatusPanel: () => statusPanel.refresh(),
      reportError: error => {
        console.error("[keep-loaded] application work failed", error);
      },
    });
    application = registration;

    const panel = statusPanel.attach(registration);
    if (settings.snapshot().showStatusButton) {
      try {
        panel.installPanelResource();
      } catch (error) {
        // The normal registration disposer is added below, so cover failed initial
        // creation before main.ts turns the generation terminal.
        panel.disposePanelResource();
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
      pulse.syncPulse();
    }
  };

  return {
    application: () => ({
      registrationId: application?.id ?? null,
      snapshot: applicationOwner.snapshot(),
    }),
    start,
    runSweep,
    fillPanel: statusPanel.fillPanel,
    liveness,
    sockets,
  };
};
