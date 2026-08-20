/** Putting a crashed kept tab back, once the application owner dequeues it. */

import type { ApplicationRegistration, WorkContext } from "./application-protocol.ts";
import type { KeepLoadedController } from "./controller.ts";
import type { CrashFacts } from "./core/crash.ts";
import { shouldKeep } from "./core/policy.ts";
import { recoveryPlan } from "./core/recovery.ts";
import { factsFor, isPending, pinnedTabs, resetToLazy } from "./platform/browser.ts";
import { recordSign } from "./platform/liveness.ts";
import { log } from "./platform/log.ts";
import type { PreferencesPort } from "./platform/prefs.ts";
import { POLL_MS, WAKE_TIMEOUT_MS, type WindowWake } from "./window-wake.ts";

export interface WindowRecoveryPorts {
  readonly application: () => ApplicationRegistration<BrowserTab, CrashFacts> | null;
  readonly controller: KeepLoadedController;
  readonly settings: PreferencesPort;
  readonly wake: WindowWake;
}

export const createWindowRecovery = ({
  application,
  controller,
  settings,
  wake,
}: WindowRecoveryPorts) => {
  /** Success shows up as `crashed -> awake`, by the sweep's own reasoning (D016). */
  const recover = async (tab: BrowserTab, facts: CrashFacts, context: WorkContext) => {
    if (!context.isCurrent() || !controller.isLive()) {
      return;
    }
    const currentTabs = pinnedTabs();
    if (!currentTabs.includes(tab) || !tab.pinned || !isPending(tab)) {
      return;
    }
    const currentPolicyFacts = factsFor(tab);
    const preferenceSnapshot = settings.snapshot();
    if (!shouldKeep(currentPolicyFacts, preferenceSnapshot.match)) {
      return;
    }
    const ownerRegistration = application();
    if (!ownerRegistration) {
      return;
    }
    const now = Date.now();
    // Settings re-read at dequeue; crash fields stay as the event exposed them (D017).
    const windowMs = preferenceSnapshot.crashWindowMs;
    const maxAttempts = preferenceSnapshot.crashAttempts;
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
        // Charged after revalidation, before the first mutation; its ledger key is weak.
        const attemptAt = Date.now();
        if (ownerRegistration.chargeRecoveryAttempt(tab, attemptAt, windowMs) === false) {
          return;
        }
        if (
          plan.action === "reset-then-wake" &&
          !wake.withExpectedRecoveryUnload(tab, token, () => resetToLazy(tab, facts.url))
        ) {
          // `_mayDiscardBrowser` never says which of its eight conditions refused.
          log(`${facts.url}: the browser refused to discard, so it stays crashed`);
          return;
        }
        const woken = await wake.wakeAll([tab], token, context);
        if (!controller.isCurrentOperation(token) || !context.isCurrent()) {
          return;
        }
        if (woken === "failed") {
          throw new Error(`${facts.url}: wake transaction failed after rollback`);
        }
        if (woken === "canceled") {
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

  return recover;
};
