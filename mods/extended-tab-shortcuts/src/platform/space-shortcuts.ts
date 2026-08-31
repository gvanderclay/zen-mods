import type { ShortcutBinding, ShortcutDefinition } from "./shortcut.ts";

export const MOVE_TABS_NEXT_SPACE_COMMAND_ID = "Move Selected Tabs to Next Space";
export const MOVE_TABS_PREVIOUS_SPACE_COMMAND_ID = "Move Selected Tabs to Previous Space";

const commandControlBinding = (
  key: string,
  keycode = "",
  shift = false,
): ShortcutBinding => ({
  key,
  keycode,
  modifiers: {
    control: true,
    alt: false,
    shift,
    meta: true,
    accel: false,
  },
});

export const SPACE_MOVE_SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    id: "extended-tab-shortcuts-move-next-space-vim-key",
    action: MOVE_TABS_NEXT_SPACE_COMMAND_ID,
    defaultBinding: commandControlBinding("n"),
  },
  {
    id: "extended-tab-shortcuts-move-next-space-arrow-key",
    action: MOVE_TABS_NEXT_SPACE_COMMAND_ID,
    defaultBinding: commandControlBinding("", "VK_RIGHT", true),
  },
  {
    id: "extended-tab-shortcuts-move-previous-space-vim-key",
    action: MOVE_TABS_PREVIOUS_SPACE_COMMAND_ID,
    defaultBinding: commandControlBinding("p"),
  },
  {
    id: "extended-tab-shortcuts-move-previous-space-arrow-key",
    action: MOVE_TABS_PREVIOUS_SPACE_COMMAND_ID,
    defaultBinding: commandControlBinding("", "VK_LEFT", true),
  },
];
