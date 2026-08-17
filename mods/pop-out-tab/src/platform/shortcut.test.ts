import { describe, expect, it, vi } from "vitest";
import {
  POP_OUT_COMMAND_ID,
  POP_OUT_SHORTCUT_ID,
  registerPopOutTabShortcut,
  type ShortcutBindingStore,
  type ShortcutFile,
  type ShortcutManager,
  unregisterPopOutTabShortcut,
} from "./shortcut.ts";

const createManager = (saved: ShortcutFile) => {
  let current = saved;
  const manager: ShortcutManager = {
    loader: {
      loadObject: vi.fn(async () => current),
      save: vi.fn(async value => {
        current = value;
      }),
    },
    init: vi.fn(async () => {}),
  };
  return { manager, read: () => current };
};

const createBindingStore = () => {
  let current = null as ReturnType<ShortcutBindingStore["read"]>;
  const store: ShortcutBindingStore = {
    read: vi.fn(() => current),
    write: vi.fn(value => {
      current = value;
    }),
  };
  return { read: () => current, store };
};

describe("registerPopOutTabShortcut", () => {
  it("adds the editable default and rebuilds Zen's shortcut manager", async () => {
    const { manager, read } = createManager({ shortcuts: [] });
    const { store } = createBindingStore();

    const added = await registerPopOutTabShortcut(manager, store);
    const shortcut = read().shortcuts[0];

    expect(added).toBe(true);
    expect(shortcut).toMatchObject({
      id: POP_OUT_SHORTCUT_ID,
      action: POP_OUT_COMMAND_ID,
      key: "n",
      group: "zen-other",
      internal: false,
      modifiers: {
        control: true,
        meta: true,
        alt: false,
        shift: false,
        accel: false,
      },
    });
    expect(manager.init).toHaveBeenCalledOnce();
  });

  it("preserves a user's existing binding without rebuilding", async () => {
    const existing = {
      id: POP_OUT_SHORTCUT_ID,
      action: POP_OUT_COMMAND_ID,
      key: "p",
      keycode: "",
      group: "zen-other",
      l10nId: null,
      modifiers: {
        control: true,
        alt: false,
        shift: true,
        meta: true,
        accel: false,
      },
      disabled: false,
      reserved: true,
      internal: false,
    };
    const { manager, read } = createManager({ shortcuts: [existing] });

    const added = await registerPopOutTabShortcut(manager);

    expect(added).toBe(false);
    expect(read().shortcuts).toEqual([existing]);
    expect(manager.loader.save).not.toHaveBeenCalled();
    expect(manager.init).not.toHaveBeenCalled();
  });

  it("refuses to replace a shortcut entry owned by another command", async () => {
    const { manager } = createManager({
      shortcuts: [
        {
          id: POP_OUT_SHORTCUT_ID,
          action: "some-other-command",
          key: "n",
          keycode: "",
          group: "other",
          l10nId: null,
          modifiers: {
            control: true,
            alt: false,
            shift: false,
            meta: true,
            accel: false,
          },
          disabled: false,
          reserved: false,
          internal: false,
        },
      ],
    });

    await expect(registerPopOutTabShortcut(manager)).rejects.toThrow(
      "shortcut ID is already owned by some-other-command",
    );
    expect(manager.loader.save).not.toHaveBeenCalled();
  });

  it("removes the editable action while retaining its user binding", async () => {
    const existing = {
      id: POP_OUT_SHORTCUT_ID,
      action: POP_OUT_COMMAND_ID,
      key: "p",
      keycode: "",
      group: "zen-other",
      l10nId: null,
      modifiers: {
        control: true,
        alt: false,
        shift: true,
        meta: true,
        accel: false,
      },
      disabled: false,
      reserved: true,
      internal: false,
    };
    const { manager, read } = createManager({ shortcuts: [existing] });
    const { read: readBinding, store } = createBindingStore();

    const removed = await unregisterPopOutTabShortcut(manager, store);

    expect(removed).toBe(true);
    expect(read().shortcuts).toEqual([]);
    expect(readBinding()).toEqual({
      key: "p",
      keycode: "",
      modifiers: existing.modifiers,
    });
    expect(manager.init).toHaveBeenCalledOnce();
  });

  it("restores the retained binding when the mod is enabled again", async () => {
    const { manager, read } = createManager({ shortcuts: [] });
    const { store } = createBindingStore();
    store.write({
      key: "p",
      keycode: "",
      modifiers: {
        control: true,
        alt: false,
        shift: true,
        meta: true,
        accel: false,
      },
    });

    await registerPopOutTabShortcut(manager, store);

    expect(read().shortcuts[0]).toMatchObject({
      id: POP_OUT_SHORTCUT_ID,
      key: "p",
      modifiers: {
        control: true,
        shift: true,
        meta: true,
      },
    });
  });
});
