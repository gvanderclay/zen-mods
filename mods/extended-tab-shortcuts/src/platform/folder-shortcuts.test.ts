import { describe, expect, it } from "vitest";
import {
  FOLDER_MOVE_SHORTCUT,
  MOVE_TABS_TO_FOLDER_COMMAND_ID,
} from "./folder-shortcuts.ts";

describe("folder shortcut", () => {
  it("registers an editable Cmd+Ctrl+M default", () => {
    expect(FOLDER_MOVE_SHORTCUT).toEqual({
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
    });
  });
});
