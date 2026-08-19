import { observeDuplicateCommand } from "./platform/duplicate-command.ts";
import { startGeneration } from "./platform/sine.ts";
import { showDuplicateTabToast } from "./platform/toast.ts";

const commandSet = document.getElementById("zenCommandSet");
const toastContainer = document.getElementById("zen-toast-container");
if (!commandSet || !toastContainer) {
  throw new Error("Zen duplicate command or toast container is unavailable");
}

const generation = startGeneration();
generation.defer(() => {
  console.info("[duplicate-tab-toast] unloaded");
});

try {
  generation.defer(
    observeDuplicateCommand({
      commandSet,
      report: error => console.error("[duplicate-tab-toast] action failed", error),
      schedule: queueMicrotask,
      showToast: tabCount =>
        showDuplicateTabToast(tabCount, gZenUIManager, toastContainer),
      tabContainer: gBrowser.tabContainer,
    }),
  );
} catch (error) {
  generation.stop("startup-failure");
  throw error;
}

console.info("[duplicate-tab-toast] ready");
