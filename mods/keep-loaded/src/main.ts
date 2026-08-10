// The cache-busted Sine entry point. Product behavior lives behind one terminal
// controller; this file only composes it with the current chrome window.

import { KeepLoadedController } from "./controller.ts";
import { preferences } from "./platform/prefs.ts";
import { bindLifecycle } from "./platform/sine.ts";
import { createKeepLoadedRuntime } from "./runtime.ts";

if (typeof DisposableStack !== "function") {
  throw new Error("Keep Loaded requires the DisposableStack available in Firefox 153");
}

const previous = window.zenKeepLoaded;
previous?.controller?.stop("replacement");

const pulseClaims = previous?.pulses ?? new WeakMap();
const controller = new KeepLoadedController({
  preferences,
  timers: {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: handle => window.clearTimeout(handle),
  },
  onDisposeError: error => {
    console.error("[keep-loaded] generation cleanup failed", error);
  },
});
const runtime = createKeepLoadedRuntime({
  owner: controller,
  preferences,
  pulseClaims,
});

const facade: KeepLoadedState = Object.freeze({
  controller,
  pulses: pulseClaims,
  fillPanel: (view: Element) => runtime.fillPanel(view),
  liveness: () => runtime.liveness(),
  sockets: () => runtime.sockets(),
});
window.zenKeepLoaded = facade;

controller.defer(() => {
  if (window.zenKeepLoaded === facade) {
    window.zenKeepLoaded = Object.freeze({ pulses: pulseClaims });
  }
});

// Sine hot reload and actual browser-window destruction are separate lifecycle
// signals in Sine 2.3.3.0. Both reach this controller's one terminal operation.
bindLifecycle(controller);

try {
  await runtime.start();
} catch (error) {
  controller.stop("startup-failure");
  throw error;
}
