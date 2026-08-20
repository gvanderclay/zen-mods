/** The full reconciliation pass: laziness, verdicts, wake, and the readings after it. */

import type { WorkContext } from "./application-protocol.ts";
import type { KeepLoadedController, OperationToken } from "./controller.ts";
import { type Probe, reportCapabilities } from "./core/capabilities.ts";
import { planLazyPinned } from "./core/lazy.ts";
import { livenessSummary } from "./core/liveness.ts";
import { sweepSummary, wakeSummary } from "./core/policy.ts";
import { socketSummary } from "./core/sockets.ts";
import {
  browserProbes,
  isPending,
  markUndiscardable,
  setMarker,
  whenSessionRestored,
  whenSpacesReady,
} from "./platform/browser.ts";
import { log, logLazy } from "./platform/log.ts";
import type { PreferencesPort } from "./platform/prefs.ts";
import { socketProbes, watchSockets } from "./platform/sockets.ts";
import {
  recordOf,
  socketRecords,
  takeInventory,
  type VerdictCandidate,
} from "./tab-inventory.ts";
import type { WindowWake } from "./window-wake.ts";

export interface WindowSweepPorts {
  readonly controller: KeepLoadedController;
  readonly relabelAll: (candidates: readonly VerdictCandidate[]) => void;
  readonly settings: PreferencesPort;
  readonly wake: WindowWake;
}

export const createWindowSweep = ({
  controller,
  relabelAll,
  settings,
  wake,
}: WindowSweepPorts) => {
  let cachedCapabilities: readonly Probe[] | null = null;

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

    // After the awaits: gZenWorkspaces is not populated at module load.
    if (!cachedCapabilities) {
      cachedCapabilities = Object.freeze(
        [...settings.probes(), ...browserProbes(), ...socketProbes()].map(probe =>
          Object.freeze({ ...probe }),
        ),
      );
    }
    const capabilities = reportCapabilities(cachedCapabilities);
    if (!capabilities.ok) {
      // Ungated by the debug pref: this is the one failure the user must see.
      console.error(`[keep-loaded] ${capabilities.message}`);
      return;
    }
    if (capabilities.message) {
      log(capabilities.message);
    }

    const preferenceSnapshot = settings.snapshot();
    const laziness = planLazyPinned(
      preferenceSnapshot.lazyPinnedWanted,
      context.readOnDemand(),
    );
    context.reconcileOnDemand(preferenceSnapshot.lazyPinnedWanted);
    if (laziness.set !== null) {
      log(laziness.message);
    }

    let inventory = takeInventory(settings);

    logLazy(() => {
      const summary = sweepSummary(
        inventory.pinned.map(({ facts }) => facts),
        inventory.kept.map(({ facts }) => facts),
      );
      return [summary.message, summary.kept];
    });

    for (const { kept, tab } of inventory.pinned) {
      setMarker(tab, kept);
      if (kept) {
        markUndiscardable(tab);
      }
    }

    const asleep = inventory.kept.filter(({ facts }) => facts.pending);
    if (asleep.length) {
      const woken = await wake.wakeAll(
        asleep.map(({ tab }) => tab),
        token,
        context,
      );
      if (!controller.isCurrentOperation(token) || !context.isCurrent()) {
        return;
      }
      logLazy(() => {
        const stuck = asleep.filter(({ tab }) => isPending(tab));
        return [
          wakeSummary(
            asleep.length,
            stuck.map(({ facts }) => facts.url),
          ),
        ];
      });
      if (woken === "failed") {
        throw new Error("one or more wake candidates failed after rollback");
      }
      if (woken === "canceled") {
        return;
      }
      // Waking changes pending/title/socket state; post-wake consumers need a refresh.
      inventory = takeInventory(settings);
    }

    const liveness = inventory.kept.map(recordOf);
    logLazy(() => {
      const summary = livenessSummary(liveness, Date.now());
      return [summary.message, summary.lines];
    });

    // After the wake: woken tabs have an inner window, and this picks up navigations.
    watchSockets(
      inventory.kept.map(({ tab }) => tab),
      () => controller.isLive(),
    );
    logLazy(() => {
      const summary = socketSummary(socketRecords(inventory.kept), Date.now());
      return [summary.message, summary.lines];
    });

    // Also after the wake: this catches every title change made while unloaded.
    relabelAll(inventory.pinned);
  };

  return sweep;
};
