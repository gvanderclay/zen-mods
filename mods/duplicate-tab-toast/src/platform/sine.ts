import { DisposableScope } from "@zen-mods/sine-lifecycle/disposable-scope";
import {
  bindSineWindowLifecycle,
  type SineWindowGenerationState,
} from "@zen-mods/sine-lifecycle/sine-window";

export type DuplicateTabToastGeneration = SineWindowGenerationState;

export const startGeneration = (): DuplicateTabToastGeneration => {
  window.zenDuplicateTabToast?.stop("replacement");
  const scope = new DisposableScope({
    onDisposeError: error => {
      console.error("[duplicate-tab-toast] disposer failed", error);
    },
  });
  let stopReason: DuplicateTabToastGeneration["stopReason"] = null;
  const generation: DuplicateTabToastGeneration = {
    get stopReason() {
      return stopReason;
    },
    defer: disposer => scope.defer(disposer),
    isLive: () => scope.isLive(),
    stop(reason = "manual") {
      if (!scope.isLive()) return false;
      stopReason = reason;
      return scope.stop();
    },
  };
  window.zenDuplicateTabToast = generation;
  generation.defer(() => {
    if (window.zenDuplicateTabToast === generation) {
      delete window.zenDuplicateTabToast;
    }
  });
  try {
    const binding = bindSineWindowLifecycle(window, generation);
    if (binding.sineUnload === "unavailable") {
      console.error("[duplicate-tab-toast] Sine unload hook is unavailable");
    }
  } catch (error) {
    generation.stop("startup-failure");
    throw error;
  }
  return generation;
};
