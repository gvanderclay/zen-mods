import { popOutSelectedTab } from "./platform/browser.ts";
import { installPopOutTabCommand } from "./platform/command.ts";
import {
  registerPopOutTabShortcut,
  unregisterPopOutTabShortcut,
} from "./platform/shortcut.ts";
import { installSineUnloadCleanup, startGeneration } from "./platform/sine.ts";

const generation = startGeneration();
generation.defer(() => {
  console.info("[pop-out-tab] unloaded");
});

try {
  generation.defer(
    installPopOutTabCommand({
      popOutSelectedTab,
      report: error => console.error("[pop-out-tab] action failed", error),
    }),
  );
  await registerPopOutTabShortcut();
  if (!generation.isLive()) {
    await unregisterPopOutTabShortcut();
  } else {
    installSineUnloadCleanup(generation, unregisterPopOutTabShortcut);
  }
} catch (error) {
  generation.stop("startup-failure");
  throw error;
}

if (generation.isLive()) {
  console.info("[pop-out-tab] ready");
}
