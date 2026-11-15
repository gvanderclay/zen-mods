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

export const MOVE_NEXT_SPACE_VIM_SHORTCUT: ShortcutDefinition = {
  id: "extended-tab-shortcuts-move-next-space-vim-key",
  label: "Move Selected Tabs to Next Space",
  action: MOVE_TABS_NEXT_SPACE_COMMAND_ID,
  defaultBinding: commandControlBinding("n"),
};

export const MOVE_NEXT_SPACE_ARROW_SHORTCUT: ShortcutDefinition = {
  id: "extended-tab-shortcuts-move-next-space-arrow-key",
  label: "Move Selected Tabs to Next Space (Alternate)",
  action: MOVE_TABS_NEXT_SPACE_COMMAND_ID,
  defaultBinding: commandControlBinding("", "VK_RIGHT", true),
};

export const MOVE_PREVIOUS_SPACE_VIM_SHORTCUT: ShortcutDefinition = {
  id: "extended-tab-shortcuts-move-previous-space-vim-key",
  label: "Move Selected Tabs to Previous Space",
  action: MOVE_TABS_PREVIOUS_SPACE_COMMAND_ID,
  defaultBinding: commandControlBinding("p"),
};

export const MOVE_PREVIOUS_SPACE_ARROW_SHORTCUT: ShortcutDefinition = {
  id: "extended-tab-shortcuts-move-previous-space-arrow-key",
  label: "Move Selected Tabs to Previous Space (Alternate)",
  action: MOVE_TABS_PREVIOUS_SPACE_COMMAND_ID,
  defaultBinding: commandControlBinding("", "VK_LEFT", true),
};

export const SPACE_MOVE_SHORTCUTS: readonly ShortcutDefinition[] = [
  MOVE_NEXT_SPACE_VIM_SHORTCUT,
  MOVE_NEXT_SPACE_ARROW_SHORTCUT,
  MOVE_PREVIOUS_SPACE_VIM_SHORTCUT,
  MOVE_PREVIOUS_SPACE_ARROW_SHORTCUT,
];
