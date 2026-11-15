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
  cleanup?: () => unknown,
): boolean => {
  if (typeof window.addUnloadListener !== "function") return false;
  // Sine awaits this callback from removeUnloadListeners() (manager.sys.mjs:54-64). An
  // async callback returns a promise owned by this window's realm; once the window is
  // closed that realm's job queue is no longer drained, so the promise never settles and
  // Sine's disable waits forever on this window instead of unloading the live one. Dispose
  // synchronously, and never await a cleanup that a closed window cannot finish.
  window.addUnloadListener(() => {
    try {
      cleanup?.();
    } finally {
      generation.stop("sine-unload");
    }
  });
  return true;
};
