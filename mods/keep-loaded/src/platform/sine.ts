/** Sine hot unload and the native browser-window close fallback. */

import { log } from "./log.ts";

/** Registers a cleanup to run when the mod is unloaded or reloaded. */
export const onUnload = (teardown: () => void) => {
  if (typeof window.addUnloadListener === "function") {
    window.addUnloadListener(teardown);
  } else {
    log("Sine did not expose addUnloadListener — reloads will not clean up");
  }
};

/**
 * Connects both lifecycle sources to one idempotent controller operation. They use
 * distinct tiny adapters only to preserve the first stop reason; neither adapter owns
 * cleanup. Sine 2.3.3.0 misses normal browser-window close, so both are required.
 */
export const bindLifecycle = (owner: {
  defer(disposer: () => void): void;
  stop(reason: "sine-unload" | "window-unload"): unknown;
}): void => {
  const stopForSine = () => owner.stop("sine-unload");
  const stopForWindow = () => owner.stop("window-unload");
  onUnload(stopForSine);
  window.addEventListener("unload", stopForWindow, { capture: false, once: true });
  owner.defer(() => {
    window.removeEventListener("unload", stopForWindow, { capture: false });
  });
};
