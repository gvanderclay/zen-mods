/** The window's event responses: crash, forced unload, system resume, and eligibility. */

import type { ApplicationRegistration } from "./application-coordinator.ts";
import type { KeepLoadedController } from "./controller.ts";
import { type CrashFacts, type CrashKind, crashDiagnosis } from "./core/crash.ts";
import { shouldKeep } from "./core/policy.ts";
import type { PulseClaimsPort } from "./core/pulse-claims.ts";
import { networkReady, wakeReason } from "./core/resume.ts";
import { unloadPlan } from "./core/unload.ts";
import { crashFactsFor, factsFor, pinnedTabs } from "./platform/browser.ts";
import { log, logLazy } from "./platform/log.ts";
import type { PreferencesPort } from "./platform/prefs.ts";
import { networkFacts } from "./platform/system.ts";
import type { PulseOwnership } from "./pulse-ownership.ts";
import type { WindowWake } from "./window-wake.ts";

export interface TabEventPorts {
  readonly application: () => ApplicationRegistration<BrowserTab, CrashFacts> | null;
  readonly controller: KeepLoadedController;
  readonly pulseOwnership: PulseOwnership;
  readonly pulses: PulseClaimsPort<BrowserTab>;
  readonly runSweep: () => Promise<void>;
  readonly settings: PreferencesPort;
  readonly windowWake: WindowWake;
}

export const createTabEvents = ({
  application: applicationPort,
  controller,
  pulseOwnership,
  pulses,
  runSweep,
  settings,
  windowWake,
}: TabEventPorts) => {
  /** Release socket/claim resources immediately when eligibility changes. */
  const releaseIneligibleResources = () => {
    const matchers = settings.snapshot().match;
    for (const tab of pinnedTabs()) {
      try {
        if (!tab.pinned || !shouldKeep(factsFor(tab), matchers)) {
          pulseOwnership.releaseTabResources(tab);
          applicationPort()?.invalidateTab(tab);
        }
      } catch {
        // The close/discard event repeats this idempotent release if a tab vanishes.
        pulseOwnership.releaseTabResources(tab);
        applicationPort()?.invalidateTab(tab);
      }
    }
    for (const [tab] of pulses.active(controller)) {
      if (!tab.pinned) {
        pulseOwnership.releaseTabResources(tab);
        applicationPort()?.invalidateTab(tab);
      }
    }
  };

  // Queues the exact event snapshot; Zen rewrites the crash fields by dequeue (D017).
  const onCrash = (tab: BrowserTab, kind: CrashKind) => {
    if (!controller.isLive()) {
      return;
    }
    try {
      // Same gate as the sign log: a merely-pinned tab's crash is not ours (D016).
      if (!shouldKeep(factsFor(tab), settings.snapshot().match)) {
        return;
      }
      const facts = crashFactsFor(tab, kind);
      logLazy(() => {
        const diagnosis = crashDiagnosis(facts);
        return [diagnosis.message, diagnosis.lines];
      });
      void applicationPort()?.requestRecovery(tab, facts).done;
    } catch (error) {
      // Ungated and caught: this is the one report that must not go missing (D017).
      console.error("[keep-loaded] crash diagnosis failed", error);
    }
  };

  /** `_mayDiscardBrowser` ignores `undiscardable`, so re-wake instead (D005, D014). */
  const onDiscard = (tab: BrowserTab) => {
    if (!controller.isLive()) {
      return;
    }
    // Already lazy here: drop ownership first; the re-wake is the transaction's.
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
      // Only for kept tabs: a space unload walks every tab in it.
      if (kept) {
        log(`${facts.url} was unloaded — ${plan.reason}`);
      }
    } catch (error) {
      console.error("[keep-loaded] unload handling failed", error);
    }
  };

  /** Sleep and a dropped link take a tab away with no crash observer watching (D019). */
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

  return { onCrash, onDiscard, onSystemWake, releaseIneligibleResources };
};
