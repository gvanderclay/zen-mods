import { DisposableScope } from "@zen-mods/sine-lifecycle/disposable-scope";
import { bindSineWindowLifecycle } from "@zen-mods/sine-lifecycle/sine-window";
import {
  createPlacesHistoryPort,
  installHistoryEntryRemoveButton,
} from "./platform/history-entry-remove.ts";
import {
  createClippedSidebarMotion,
  installLegacySidebarAnimation,
} from "./platform/sidebar-animation.ts";

window.zenSidebarPolish?.stop("replacement");

const scope = new DisposableScope({
  onDisposeError: error => {
    console.error("[sidebar-polish] disposer failed", error);
  },
});
let stopReason: SidebarPolishGeneration["stopReason"] = null;
const generation: SidebarPolishGeneration = {
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

window.zenSidebarPolish = generation;
generation.defer(() => {
  if (window.zenSidebarPolish === generation) {
    delete window.zenSidebarPolish;
  }
});

try {
  const binding = bindSineWindowLifecycle(window, generation);
  if (binding.sineUnload === "unavailable") {
    console.error("[sidebar-polish] Sine unload hook is unavailable");
  }
  const tabbox = window.document.getElementById("tabbrowser-tabbox");
  if (!tabbox) {
    throw new Error("Sidebar Polish requires #tabbrowser-tabbox");
  }
  generation.defer(
    installLegacySidebarAnimation({
      controller: SidebarController,
      motion: createClippedSidebarMotion({
        box: SidebarController._box,
        durationMs: SidebarController._animationDurationMs,
        splitter: SidebarController._splitter,
        tabbox,
      }),
      reduceMotion: () => window.gReduceMotion,
      report: error => console.error("[sidebar-polish] animation failed", error),
    }),
  );
  generation.defer(
    installHistoryEntryRemoveButton({
      browser: SidebarController.browser,
      history: createPlacesHistoryPort(),
      isLive: generation.isLive,
      report: error => console.error("[sidebar-polish] history removal failed", error),
    }),
  );
  console.info("[sidebar-polish] ready");
} catch (error) {
  generation.stop("startup-failure");
  throw error;
}
