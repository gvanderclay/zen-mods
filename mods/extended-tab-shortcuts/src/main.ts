import { toggleSelectedTabsIsolation } from "./platform/browser.ts";
import { installCommands } from "./platform/command.ts";
import { installFolderPicker } from "./platform/folder-picker.ts";
import { MOVE_TABS_TO_FOLDER_COMMAND_ID } from "./platform/folder-shortcuts.ts";
import {
  installShortcutSurface,
  SHORTCUT_MENU_ENTRIES,
} from "./platform/native-shortcuts.ts";
import {
  CLEAR_SELECTION_COMMAND_ID,
  EXTEND_SELECTION_NEXT_COMMAND_ID,
  EXTEND_SELECTION_PREVIOUS_COMMAND_ID,
  POP_OUT_COMMAND_ID,
} from "./platform/shortcut.ts";
import { migrateShortcutBindings } from "./platform/shortcut-migration.ts";
import { installSineUnloadCleanup, startGeneration } from "./platform/sine.ts";
import { moveSelectedTabsToSpace } from "./platform/space-move.ts";
import {
  MOVE_TABS_NEXT_SPACE_COMMAND_ID,
  MOVE_TABS_PREVIOUS_SPACE_COMMAND_ID,
} from "./platform/space-shortcuts.ts";
import { createBrowserTabSelectionPort } from "./platform/tab-selection.ts";
import { createTabSelectionController } from "./tab-selection.ts";

const generation = startGeneration();
generation.defer(() => {
  console.info("[extended-tab-shortcuts] unloaded");
});

try {
  const tabSelection = createTabSelectionController(createBrowserTabSelectionPort());
  generation.defer(() => tabSelection.dispose());
  const folderPicker = installFolderPicker();
  generation.defer(() => folderPicker.dispose());
  generation.defer(
    installCommands(
      [
        { id: POP_OUT_COMMAND_ID, run: toggleSelectedTabsIsolation },
        { id: EXTEND_SELECTION_NEXT_COMMAND_ID, run: tabSelection.next },
        { id: EXTEND_SELECTION_PREVIOUS_COMMAND_ID, run: tabSelection.previous },
        { id: CLEAR_SELECTION_COMMAND_ID, run: tabSelection.clear },
        {
          id: MOVE_TABS_NEXT_SPACE_COMMAND_ID,
          run: () => moveSelectedTabsToSpace(1),
        },
        {
          id: MOVE_TABS_PREVIOUS_SPACE_COMMAND_ID,
          run: () => moveSelectedTabsToSpace(-1),
        },
        {
          id: MOVE_TABS_TO_FOLDER_COMMAND_ID,
          run: folderPicker.open,
        },
      ],
      {
        report: error => console.error("[extended-tab-shortcuts] action failed", error),
      },
    ),
  );
  generation.defer(
    installShortcutSurface({
      definitions: SHORTCUT_MENU_ENTRIES,
      document: window.document,
    }),
  );
  await migrateShortcutBindings({
    definitions: SHORTCUT_MENU_ENTRIES,
    isLive: () => generation.isLive(),
    report: message => console.warn(`[extended-tab-shortcuts] ${message}`),
  });
  if (generation.isLive()) {
    installSineUnloadCleanup(generation);
  }
} catch (error) {
  generation.stop("startup-failure");
  throw error;
}

if (generation.isLive()) {
  console.info("[extended-tab-shortcuts] ready");
}
