import { bindSineWindowLifecycle } from "@zen-mods/sine-lifecycle/sine-window";

import { log } from "./log.ts";

export const bindLifecycle = (owner: {
  defer(disposer: () => unknown): void;
  stop(reason: "sine-unload" | "window-unload"): unknown;
}): void => {
  const binding = bindSineWindowLifecycle(window, owner);
  if (binding.sineUnload === "unavailable") {
    log("Sine did not expose addUnloadListener — native close cleanup remains active");
  }
};
