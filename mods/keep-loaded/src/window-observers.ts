/** Everything one generation listens to, deferred in the order its disposers must run. */

import type { ApplicationRegistration } from "./application-coordinator.ts";
import type { KeepLoadedController } from "./controller.ts";
import type { CrashFacts } from "./core/crash.ts";
import { WAKE_TOPICS } from "./core/resume.ts";
import { pinnedTabs, setMarker } from "./platform/browser.ts";
import { observeTitleChanges } from "./platform/label.ts";
import { observeSigns } from "./platform/liveness.ts";
import { log } from "./platform/log.ts";
import type { PreferencesPort } from "./platform/prefs.ts";
import { observeTopic } from "./platform/system.ts";
import type { createPulseCycle } from "./pulse-cycle.ts";
import { PULSE_OFF, type PulseOwnership } from "./pulse-ownership.ts";
import type { createTabEvents } from "./tab-events.ts";
import type { createTabLabels } from "./tab-labels.ts";

export interface WindowObserverPorts {
  readonly application: () => ApplicationRegistration<BrowserTab, CrashFacts> | null;
  readonly controller: KeepLoadedController;
  readonly pulse: ReturnType<typeof createPulseCycle>;
  readonly pulseOwnership: PulseOwnership;
  readonly runSweep: () => Promise<void>;
  readonly settings: PreferencesPort;
  readonly tabEvents: ReturnType<typeof createTabEvents>;
  readonly tabLabels: ReturnType<typeof createTabLabels>;
}

/** Called once from `start`, at the point these registrations have always occupied. */
export const observeWindow = ({
  application: applicationPort,
  controller,
  pulse,
  pulseOwnership,
  runSweep,
  settings,
  tabEvents,
  tabLabels,
}: WindowObserverPorts): void => {
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
      tabEvents.releaseIneligibleResources();
      log("allowlist changed — re-sweeping");
      void runSweep();
    }),
  );
  controller.defer(
    settings.observe("lazy-pinned", () => {
      if (!controller.isLive()) {
        return;
      }
      applicationPort()?.reconcileOnDemand(settings.snapshot().lazyPinnedWanted);
      log("lazy pinned tabs setting changed — re-sweeping");
      void runSweep();
    }),
  );

  for (const preference of ["crash-attempts", "crash-window", "debug"] as const) {
    controller.defer(settings.observe(preference, () => {}));
  }

  // Released synchronously after scope cancellation, when no ticker can re-activate.
  controller.defer(() => pulseOwnership.pulseOnce(PULSE_OFF));

  controller.defer(
    observeTitleChanges(tab => {
      if (controller.isLive()) {
        tabLabels.relabelOne(tab);
      }
    }),
  );

  for (const preference of ["freshen", "freshen-hold"] as const) {
    controller.defer(
      settings.observe(preference, () => {
        if (controller.isLive()) {
          pulse.syncPulse();
        }
      }),
    );
  }

  controller.defer(
    observeSigns(
      () => controller.isLive(),
      tabEvents.onCrash,
      tabEvents.onDiscard,
      tab => {
        pulseOwnership.releaseTabResources(tab);
        applicationPort()?.invalidateTab(tab);
      },
      tab => {
        pulseOwnership.releaseTabResources(tab);
        applicationPort()?.invalidateTab(tab);
      },
    ),
  );

  for (const topic of WAKE_TOPICS) {
    controller.defer(observeTopic(topic, data => tabEvents.onSystemWake(topic, data)));
  }
};
