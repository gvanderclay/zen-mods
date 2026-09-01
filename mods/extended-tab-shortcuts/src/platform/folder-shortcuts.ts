import type { ShortcutDefinition } from "./shortcut.ts";

export const MOVE_TABS_TO_FOLDER_COMMAND_ID = "Move Selected Tabs to Folder";

export const FOLDER_MOVE_SHORTCUT: ShortcutDefinition = {
  action: MOVE_TABS_TO_FOLDER_COMMAND_ID,
  defaultBinding: {
    key: "m",
    keycode: "",
    modifiers: {
      accel: false,
      alt: false,
      control: true,
      meta: true,
      shift: false,
    },
  },
  id: "extended-tab-shortcuts-move-to-folder-key",
};
