import { popOutSelectedTab } from "./platform/browser.ts";
import { installCommands } from "./platform/command.ts";
import {
  POP_OUT_COMMAND_ID,
  POP_OUT_SHORTCUT,
  registerShortcuts,
  unregisterShortcuts,
} from "./platform/shortcut.ts";
import { installSineUnloadCleanup, startGeneration } from "./platform/sine.ts";

const shortcuts = [POP_OUT_SHORTCUT];
const generation = startGeneration();
generation.defer(() => {
  console.info("[extended-tab-shortcuts] unloaded");
});

try {
  generation.defer(
    installCommands([{ id: POP_OUT_COMMAND_ID, run: popOutSelectedTab }], {
      report: error => console.error("[extended-tab-shortcuts] action failed", error),
    }),
  );
  await registerShortcuts(shortcuts);
  if (!generation.isLive()) {
    await unregisterShortcuts(shortcuts);
  } else {
    installSineUnloadCleanup(generation, () => unregisterShortcuts(shortcuts));
  }
} catch (error) {
  generation.stop("startup-failure");
  throw error;
}

if (generation.isLive()) {
  console.info("[extended-tab-shortcuts] ready");
}
