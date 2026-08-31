import { popOutSelectedTabs } from "./platform/browser.ts";
import { installCommands } from "./platform/command.ts";
import {
  CLEAR_SELECTION_COMMAND_ID,
  EXTEND_SELECTION_NEXT_COMMAND_ID,
  EXTEND_SELECTION_PREVIOUS_COMMAND_ID,
  POP_OUT_COMMAND_ID,
  POP_OUT_SHORTCUT,
  registerShortcuts,
  TAB_SELECTION_SHORTCUTS,
  unregisterShortcuts,
} from "./platform/shortcut.ts";
import { installSineUnloadCleanup, startGeneration } from "./platform/sine.ts";
import { createBrowserTabSelectionPort } from "./platform/tab-selection.ts";
import { createTabSelectionController } from "./tab-selection.ts";

const shortcuts = [POP_OUT_SHORTCUT, ...TAB_SELECTION_SHORTCUTS];
const generation = startGeneration();
generation.defer(() => {
  console.info("[extended-tab-shortcuts] unloaded");
});

try {
  const tabSelection = createTabSelectionController(createBrowserTabSelectionPort());
  generation.defer(() => tabSelection.dispose());
  generation.defer(
    installCommands(
      [
        { id: POP_OUT_COMMAND_ID, run: popOutSelectedTabs },
        { id: EXTEND_SELECTION_NEXT_COMMAND_ID, run: tabSelection.next },
        { id: EXTEND_SELECTION_PREVIOUS_COMMAND_ID, run: tabSelection.previous },
        { id: CLEAR_SELECTION_COMMAND_ID, run: tabSelection.clear },
      ],
      {
        report: error => console.error("[extended-tab-shortcuts] action failed", error),
      },
    ),
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
