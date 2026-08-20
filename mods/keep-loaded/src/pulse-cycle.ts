/** One application-owned pulse cycle, holding at most one tab at a time (R009). */

import type { ApplicationRegistration, WorkContext } from "./application-coordinator.ts";
import type { KeepLoadedController } from "./controller.ts";
import type { CrashFacts } from "./core/crash.ts";
import {
  isPulsing,
  type PulseOutcome,
  type PulseSettings,
  pulseStep,
  pulseSummary,
} from "./core/freshness.ts";
import { shouldKeep, type TabFacts } from "./core/policy.ts";
import type { PulseClaimsPort } from "./core/pulse-claims.ts";
import { factsFor } from "./platform/browser.ts";
import { docShellState } from "./platform/docshell.ts";
import { log, logLazy } from "./platform/log.ts";
import type { PreferencesPort } from "./platform/prefs.ts";
import { PULSE_OFF, type PulseOwnership } from "./pulse-ownership.ts";
import { pinnedWithVerdict } from "./tab-inventory.ts";

export interface PulseCyclePorts {
  readonly application: () => ApplicationRegistration<BrowserTab, CrashFacts> | null;
  readonly controller: KeepLoadedController;
  readonly ownership: PulseOwnership;
  readonly pulseSettings: () => PulseSettings;
  readonly pulses: PulseClaimsPort<BrowserTab>;
  readonly settings: PreferencesPort;
}

export const createPulseCycle = ({
  application: applicationPort,
  controller,
  ownership,
  pulseSettings,
  pulses,
  settings,
}: PulseCyclePorts) => {
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

  /** Holds at most one tab before moving on, making R009's serial guarantee concrete. */
  const pulseCycle = async (
    schedule: PulseSettings,
    context: WorkContext,
  ): Promise<void> => {
    const outcomes: PulseOutcome[] = [];
    const visited = new Set<BrowserTab>();
    const candidates = pinnedWithVerdict(settings);
    for (const { tab } of candidates) {
      if (!context.isCurrent() || !controller.isLive()) {
        return;
      }
      if (!isPulsing(pulseSettings())) {
        return;
      }
      visited.add(tab);
      let facts: TabFacts;
      let kept: boolean;
      try {
        facts = factsFor(tab);
        kept = tab.pinned && shouldKeep(facts, settings.snapshot().match);
      } catch {
        ownership.releaseTabResources(tab);
        applicationPort()?.invalidateTab(tab);
        continue;
      }
      if (!kept) {
        ownership.releaseTabResources(tab);
        applicationPort()?.invalidateTab(tab);
        continue;
      }
      const record = ownership.ownedPulseRecord(tab);
      const shellState = docShellState(tab);
      const step = pulseStep(
        {
          url: facts.url,
          kept,
          pending: facts.pending,
          selected: tab.selected,
          // Only a proven inactive/gone state is safe to treat as inactive.
          active: shellState === "active" || shellState === "unknown",
          heldSince: record.heldSince,
          lastPulseAt: record.lastPulseAt,
        },
        schedule,
        controller.now(),
      );
      const actual = ownership.applyPulse(tab, step, controller.now());
      outcomes.push({ url: facts.url, step: actual });
      if (actual.action !== "activate") {
        continue;
      }
      let hold: Awaited<ReturnType<typeof waitPulseHold>> = "stopped";
      let released = true;
      try {
        hold = await waitPulseHold(schedule.holdMs, context);
      } finally {
        released = ownership.releasePulseClaim(tab);
      }
      if (released) {
        outcomes.push({
          url: facts.url,
          step: {
            action: "release",
            reason: `its ${schedule.holdMs / 1000}s pulse is up`,
          },
        });
      }
      if (
        hold !== "elapsed" ||
        !released ||
        !context.isCurrent() ||
        !controller.isLive() ||
        !isPulsing(pulseSettings())
      ) {
        return;
      }
    }
    // A claim can leave the pinned inventory mid-cycle; still release it.
    for (const [tab] of pulses.active(controller)) {
      if (!visited.has(tab)) {
        ownership.releasePulseClaim(tab);
      }
    }
    logLazy(() => {
      const report = pulseSummary(outcomes);
      return report ? [report.message, report.lines] : null;
    });
  };

  /** Settings-off still releases this generation's claims synchronously. */
  const syncPulse = () => {
    if (!controller.isLive()) {
      // A reload during the startup sweep already tore this instance down.
      return;
    }
    const settings = pulseSettings();
    applicationPort()?.setPulseSchedule(settings);
    if (!isPulsing(settings)) {
      log("freshness: off");
      ownership.pulseOnce(PULSE_OFF);
      return;
    }
    log(
      `freshness: running each kept tab's page for ${settings.holdMs / 1000}s every ${settings.everyMs / 1000}s`,
    );
    // The first cycle starts now; the scheduler owns every later deadline.
    void applicationPort()?.requestPulse().done;
  };

  return { pulseCycle, syncPulse };
};
