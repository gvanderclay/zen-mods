import { DisposableScope } from "@zen-mods/sine-lifecycle/disposable-scope";
import {
  bindSineWindowLifecycle,
  type SineWindowGenerationState,
} from "@zen-mods/sine-lifecycle/sine-window";

export type CopyLinksGeneration = SineWindowGenerationState;

export const startGeneration = (): CopyLinksGeneration => {
  window.zenCopyLinks?.stop("replacement");
  const scope = new DisposableScope({
    onDisposeError: error => {
      console.error("[copy-links] disposer failed", error);
    },
  });
  let stopReason: CopyLinksGeneration["stopReason"] = null;
  const generation: CopyLinksGeneration = {
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
  window.zenCopyLinks = generation;
  generation.defer(() => {
    if (window.zenCopyLinks === generation) {
      delete window.zenCopyLinks;
    }
  });
  try {
    const binding = bindSineWindowLifecycle(window, generation);
    if (binding.sineUnload === "unavailable") {
      console.error("[copy-links] Sine unload hook is unavailable");
    }
  } catch (error) {
    generation.stop("startup-failure");
    throw error;
  }
  return generation;
};
