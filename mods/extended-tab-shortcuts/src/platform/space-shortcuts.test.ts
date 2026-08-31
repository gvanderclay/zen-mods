import { describe, expect, it } from "vitest";
import {
  MOVE_TABS_NEXT_SPACE_COMMAND_ID,
  MOVE_TABS_PREVIOUS_SPACE_COMMAND_ID,
  SPACE_MOVE_SHORTCUTS,
} from "./space-shortcuts.ts";

describe("space move shortcut defaults", () => {
  it("registers Vim and shifted-arrow alternatives", () => {
    expect(
      SPACE_MOVE_SHORTCUTS.map(shortcut => ({
        action: shortcut.action,
        key: shortcut.defaultBinding.key,
        keycode: shortcut.defaultBinding.keycode,
        shift: shortcut.defaultBinding.modifiers.shift,
      })),
    ).toEqual([
      {
        action: MOVE_TABS_NEXT_SPACE_COMMAND_ID,
        key: "n",
        keycode: "",
        shift: false,
      },
      {
        action: MOVE_TABS_NEXT_SPACE_COMMAND_ID,
        key: "",
        keycode: "VK_RIGHT",
        shift: true,
      },
      {
        action: MOVE_TABS_PREVIOUS_SPACE_COMMAND_ID,
        key: "p",
        keycode: "",
        shift: false,
      },
      {
        action: MOVE_TABS_PREVIOUS_SPACE_COMMAND_ID,
        key: "",
        keycode: "VK_LEFT",
        shift: true,
      },
    ]);
    expect(
      SPACE_MOVE_SHORTCUTS.every(
        shortcut =>
          shortcut.defaultBinding.modifiers.control &&
          shortcut.defaultBinding.modifiers.meta &&
          !shortcut.defaultBinding.modifiers.alt,
      ),
    ).toBe(true);
  });
});
