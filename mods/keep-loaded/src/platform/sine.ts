/**
 * The Sine side of the contract: state that must outlive a mod reload, and the
 * teardown hook. See D006 — Sine reloads every enabled mod when any mod is
 * toggled, so a registration without a disposer doubles up.
 */

import { log } from "./log.ts";

/** Module scope is discarded on every re-import, so state is parked on the window. */
window.zenKeepLoaded ??= { disposers: [] };
export const state = window.zenKeepLoaded;

/** Registers a cleanup to run when the mod is unloaded or reloaded. */
export const onUnload = (teardown: () => void) => {
  if (typeof window.addUnloadListener === "function") {
    window.addUnloadListener(teardown);
  } else {
    log("Sine did not expose addUnloadListener — reloads will not clean up");
  }
};

/** Runs every registered disposer, swallowing failures so one cannot block the rest. */
export const runDisposers = () => {
  for (const dispose of state.disposers) {
    try {
      dispose();
    } catch (err) {
      log("disposer failed", err);
    }
  }
  state.disposers = [];
};
