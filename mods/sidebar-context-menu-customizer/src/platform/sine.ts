import { DisposableScope } from "@zen-mods/sine-lifecycle/disposable-scope";
import {
  bindSineWindowLifecycle,
  type SineWindowGenerationState,
} from "@zen-mods/sine-lifecycle/sine-window";

export type SidebarGeneration = SineWindowGenerationState;

export const startGeneration = (): SidebarGeneration => {
  window.zenSidebarContextMenuCustomizer?.stop("replacement");
  const scope = new DisposableScope({
    onDisposeError: error => {
      console.error("[sidebar-context-menu-customizer] disposer failed", error);
    },
  });
  let stopReason: SidebarGeneration["stopReason"] = null;
  const generation: SidebarGeneration = {
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
  window.zenSidebarContextMenuCustomizer = generation;
  generation.defer(() => {
    if (window.zenSidebarContextMenuCustomizer === generation) {
      delete window.zenSidebarContextMenuCustomizer;
    }
  });
  try {
    const binding = bindSineWindowLifecycle(window, generation);
    if (binding.sineUnload === "unavailable") {
      console.error("[sidebar-context-menu-customizer] Sine unload hook is unavailable");
    }
  } catch (error) {
    generation.stop("startup-failure");
    throw error;
  }
  return generation;
};
