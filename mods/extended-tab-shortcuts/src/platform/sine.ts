import { DisposableScope } from "@zen-mods/sine-lifecycle/disposable-scope";
import {
  bindSineWindowLifecycle,
  type SineWindowGenerationState,
} from "@zen-mods/sine-lifecycle/sine-window";

export type ExtendedTabShortcutsGeneration = SineWindowGenerationState;

export const startGeneration = (): ExtendedTabShortcutsGeneration => {
  window.zenExtendedTabShortcuts?.stop("replacement");
  const scope = new DisposableScope({
    onDisposeError: error => {
      console.error("[extended-tab-shortcuts] disposer failed", error);
    },
  });
  let stopReason: ExtendedTabShortcutsGeneration["stopReason"] = null;
  const generation: ExtendedTabShortcutsGeneration = {
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
  window.zenExtendedTabShortcuts = generation;
  generation.defer(() => {
    if (window.zenExtendedTabShortcuts === generation) {
      delete window.zenExtendedTabShortcuts;
    }
  });
  try {
    const binding = bindSineWindowLifecycle(window, generation);
    if (binding.sineUnload === "unavailable") {
      console.error("[extended-tab-shortcuts] Sine unload hook is unavailable");
    }
  } catch (error) {
    generation.stop("startup-failure");
    throw error;
  }
  return generation;
};

export const installSineUnloadCleanup = (
  generation: ExtendedTabShortcutsGeneration,
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
