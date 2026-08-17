import { DisposableScope } from "@zen-mods/sine-lifecycle/disposable-scope";
import {
  bindSineWindowLifecycle,
  type SineWindowGenerationState,
} from "@zen-mods/sine-lifecycle/sine-window";

export type PopOutTabGeneration = SineWindowGenerationState;

export const startGeneration = (): PopOutTabGeneration => {
  window.zenPopOutTab?.stop("replacement");
  const scope = new DisposableScope({
    onDisposeError: error => {
      console.error("[pop-out-tab] disposer failed", error);
    },
  });
  let stopReason: PopOutTabGeneration["stopReason"] = null;
  const generation: PopOutTabGeneration = {
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
  window.zenPopOutTab = generation;
  generation.defer(() => {
    if (window.zenPopOutTab === generation) {
      delete window.zenPopOutTab;
    }
  });
  try {
    const binding = bindSineWindowLifecycle(window, generation);
    if (binding.sineUnload === "unavailable") {
      console.error("[pop-out-tab] Sine unload hook is unavailable");
    }
  } catch (error) {
    generation.stop("startup-failure");
    throw error;
  }
  return generation;
};

export const installSineUnloadCleanup = (
  generation: PopOutTabGeneration,
  cleanup: () => Promise<unknown>,
): boolean => {
  if (typeof window.addUnloadListener !== "function") return false;
  window.addUnloadListener(async () => {
    try {
      await cleanup();
    } finally {
      generation.stop("sine-unload");
    }
  });
  return true;
};
