/** The docshell pulse claim ledger: one owner, one active claim, idempotent release. */

import type { KeepLoadedController } from "./controller.ts";
import type { PulseSettings, PulseStep } from "./core/freshness.ts";
import type { PulseClaimsPort, PulseRecord } from "./core/pulse-claims.ts";
import { docShellState, setDocShellActive } from "./platform/docshell.ts";
import { stopWatchingSocket } from "./platform/sockets.ts";

/** Settings that pulse nothing and release everything, which is what teardown wants. */
export const PULSE_OFF: PulseSettings = { everyMs: 0, holdMs: 0 };

export interface PulseOwnershipPorts {
  readonly controller: KeepLoadedController;
  readonly pulses: PulseClaimsPort<BrowserTab>;
}

export type PulseOwnership = ReturnType<typeof createPulseOwnership>;

export const createPulseOwnership = ({ controller, pulses }: PulseOwnershipPorts) => {
  /** Another controller's record is metadata only; ownership is never borrowed. */
  const ownedPulseRecord = (tab: BrowserTab): PulseRecord => {
    if (pulses.owned) {
      return pulses.owned(tab, controller);
    }
    // A protocol-7/8 ledger predates the direct lookup; keep its native ownership.
    const record = pulses.get(tab);
    return pulses.active(controller).some(([candidate]) => candidate === tab)
      ? record
      : { heldSince: null, lastPulseAt: record.lastPulseAt };
  };

  /** Closed/unpinned tabs must lose timing metadata as well as their active claim. */
  const dropPulseClaim = (tab: BrowserTab, owner: object = controller) => {
    if (!tab.isConnected || !tab.pinned) {
      return pulses.remove(tab, owner);
    }
    return pulses.forget(tab, owner);
  };
  /** Reports what landed, not what was decided: `docShellIsActive` can refuse. */
  const applyPulse = (tab: BrowserTab, step: PulseStep, now: number): PulseStep => {
    switch (step.action) {
      case "activate":
        // Claim first, so a stale generation cannot activate a re-claimed tab.
        if (!pulses.set(tab, controller, { heldSince: now, lastPulseAt: now })) {
          return { action: "skip", reason: "another generation owns its docshell claim" };
        }
        if (!setDocShellActive(tab, true)) {
          // Keep ownership for cleanup unless absence/inactivity is proven.
          const state = docShellState(tab);
          if (state === "gone" || state === "inactive") {
            stopWatchingSocket(tab);
            dropPulseClaim(tab);
          }
          return { action: "skip", reason: "its docshell refused to activate" };
        }
        return step;
      case "release":
        return releasePulseClaim(tab)
          ? step
          : { action: "skip", reason: "its docshell refused to release" };
      // Nothing is written; `lastPulseAt` stays so the interval still applies.
      case "forget":
        stopWatchingSocket(tab);
        dropPulseClaim(tab);
        return step;
      default:
        return step;
    }
  };

  /** Release only this generation's claim; socket liveness is an independent resource. */
  function releaseOwnedPulseClaim(tab: BrowserTab, owner: object): boolean {
    if (!pulses.active(owner).some(([candidate]) => candidate === tab)) {
      return true;
    }
    let state: ReturnType<typeof docShellState>;
    try {
      state = docShellState(tab);
      if (tab.selected) {
        // Selection transfers activeness to the user. Forget without writing false.
        stopWatchingSocket(tab);
        dropPulseClaim(tab, owner);
        return true;
      }
    } catch (error) {
      console.error("[keep-loaded] could not inspect a pulse claim for cleanup", error);
      return false;
    }
    if (state === "gone" || state === "inactive") {
      // External deactivation or disappearance ends our ownership without another write.
      stopWatchingSocket(tab);
      dropPulseClaim(tab, owner);
      return true;
    }
    if (state === "unknown" || !setDocShellActive(tab, false)) {
      return false;
    }
    const after = docShellState(tab);
    if (after !== "inactive" && after !== "gone") {
      return false;
    }
    dropPulseClaim(tab, owner);
    return true;
  }

  function releasePulseClaim(tab: BrowserTab): boolean {
    return releaseOwnedPulseClaim(tab, controller);
  }

  const releaseOrphanedPulseClaims = (): void => {
    for (const [tab, owner] of pulses.allActive()) {
      if (owner === controller) {
        continue;
      }
      try {
        releaseOwnedPulseClaim(tab, owner);
      } catch (error) {
        console.error(
          "[keep-loaded] unresolved old pulse claim could not be retried",
          error,
        );
      }
    }
  };

  /** The synchronous settings-off and teardown pass; `pulseCycle` is the enabled path. */
  const pulseOnce = (_settings: PulseSettings): void => {
    // Starts from the ledger, never browser inventory: a failing walk must skip nothing.
    for (const [tab] of pulses.active(controller)) {
      try {
        releasePulseClaim(tab);
      } catch (error) {
        console.error("[keep-loaded] pulse cleanup failed", error);
      }
    }
  };

  /** Idempotent by design: repeat reports must not re-open or touch a new claim. */
  const releaseTabResources = (tab: BrowserTab) => {
    stopWatchingSocket(tab);
    releasePulseClaim(tab);
  };

  return {
    applyPulse,
    ownedPulseRecord,
    pulseOnce,
    releaseOrphanedPulseClaims,
    releasePulseClaim,
    releaseTabResources,
  };
};
