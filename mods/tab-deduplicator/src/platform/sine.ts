import { DisposableScope } from "@zen-mods/sine-lifecycle/disposable-scope";
import {
  bindSineWindowLifecycle,
  type SineWindowGenerationState,
} from "@zen-mods/sine-lifecycle/sine-window";

export type TabDeduplicatorGeneration = SineWindowGenerationState;

export const startGeneration = (): TabDeduplicatorGeneration => {
  window.zenTabDeduplicator?.stop("replacement");
  const scope = new DisposableScope({
    onDisposeError: error => {
      console.error("[tab-deduplicator] disposer failed", error);
    },
  });
  let stopReason: TabDeduplicatorGeneration["stopReason"] = null;
  const generation: TabDeduplicatorGeneration = {
    get stopReason() {
      return stopReason;
    },
    defer: disposer => scope.defer(disposer),
    isLive: () => scope.isLive(),
    stop(reason = "manual") {
      if (!scope.isLive()) {
        return false;
      }
      stopReason = reason;
      return scope.stop();
    },
  };
  window.zenTabDeduplicator = generation;
  generation.defer(() => {
    if (window.zenTabDeduplicator === generation) {
      delete window.zenTabDeduplicator;
    }
  });
  try {
    const binding = bindSineWindowLifecycle(window, generation);
    if (binding.sineUnload === "unavailable") {
      console.error("[tab-deduplicator] Sine unload hook is unavailable");
    }
  } catch (error) {
    generation.stop("startup-failure");
    throw error;
  }
  return generation;
};
