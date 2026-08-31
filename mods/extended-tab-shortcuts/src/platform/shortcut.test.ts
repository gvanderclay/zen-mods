import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLEAR_SELECTION_COMMAND_ID,
  EXTEND_SELECTION_NEXT_COMMAND_ID,
  EXTEND_SELECTION_PREVIOUS_COMMAND_ID,
  POP_OUT_COMMAND_ID,
  POP_OUT_SHORTCUT,
  POP_OUT_SHORTCUT_ID,
  registerShortcuts,
  type ShortcutBindingStore,
  type ShortcutFile,
  type ShortcutManager,
  TAB_SELECTION_SHORTCUTS,
  unregisterShortcuts,
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
  const bindings = new Map<string, ReturnType<ShortcutBindingStore["read"]>>();
  const store: ShortcutBindingStore = {
    read: vi.fn(id => bindings.get(id) ?? null),
    write: vi.fn((id, value) => {
      bindings.set(id, value);
    }),
  };
  return { read: (id: string) => bindings.get(id) ?? null, store };
};

const SELECT_NEXT_SHORTCUT = TAB_SELECTION_SHORTCUTS[0];
if (!SELECT_NEXT_SHORTCUT) throw new Error("selection shortcut fixture is missing");
const SHORTCUTS = [POP_OUT_SHORTCUT, SELECT_NEXT_SHORTCUT];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tab selection shortcut defaults", () => {
  it("registers Vim and arrow alternatives plus clear selection", () => {
    expect(
      TAB_SELECTION_SHORTCUTS.map(shortcut => ({
        action: shortcut.action,
        key: shortcut.defaultBinding.key,
        keycode: shortcut.defaultBinding.keycode,
      })),
    ).toEqual([
      { action: EXTEND_SELECTION_NEXT_COMMAND_ID, key: "j", keycode: "" },
      { action: EXTEND_SELECTION_NEXT_COMMAND_ID, key: "", keycode: "VK_DOWN" },
      { action: EXTEND_SELECTION_PREVIOUS_COMMAND_ID, key: "k", keycode: "" },
      {
        action: EXTEND_SELECTION_PREVIOUS_COMMAND_ID,
        key: "",
        keycode: "VK_UP",
      },
      { action: CLEAR_SELECTION_COMMAND_ID, key: "`", keycode: "" },
    ]);
    expect(
      TAB_SELECTION_SHORTCUTS.every(
        shortcut =>
          shortcut.defaultBinding.modifiers.control &&
          shortcut.defaultBinding.modifiers.meta &&
          !shortcut.defaultBinding.modifiers.alt &&
          !shortcut.defaultBinding.modifiers.shift,
      ),
    ).toBe(true);
  });
});

describe("registerShortcuts", () => {
  it("adds every editable default with one manager rebuild", async () => {
    const { manager, read } = createManager({ shortcuts: [] });
    const { store } = createBindingStore();

    const added = await registerShortcuts(SHORTCUTS, manager, store);
    const [popOut, selectNext] = read().shortcuts;

    expect(added).toBe(2);
    expect(popOut).toMatchObject({
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
    expect(selectNext).toMatchObject({
      id: SELECT_NEXT_SHORTCUT.id,
      action: SELECT_NEXT_SHORTCUT.action,
      key: "j",
    });
    expect(manager.loader.save).toHaveBeenCalledOnce();
    expect(manager.init).toHaveBeenCalledOnce();
  });

  it("preserves existing bindings while adding missing actions", async () => {
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
    const { store } = createBindingStore();

    const added = await registerShortcuts(SHORTCUTS, manager, store);

    expect(added).toBe(1);
    expect(read().shortcuts[0]).toEqual(existing);
    expect(read().shortcuts[1]).toMatchObject({ id: SELECT_NEXT_SHORTCUT.id });
    expect(manager.loader.save).toHaveBeenCalledOnce();
    expect(manager.init).toHaveBeenCalledOnce();
  });

  it("does not rebuild when every action is already registered", async () => {
    const existing = SHORTCUTS.map(shortcut => ({
      id: shortcut.id,
      action: shortcut.action,
      key: "p",
      keycode: "",
      group: "zen-other",
      l10nId: null,
      modifiers: shortcut.defaultBinding.modifiers,
      disabled: false,
      reserved: true,
      internal: false,
    }));
    const { manager, read } = createManager({ shortcuts: existing });
    const { store } = createBindingStore();

    const added = await registerShortcuts(SHORTCUTS, manager, store);

    expect(added).toBe(0);
    expect(read().shortcuts).toEqual(existing);
    expect(manager.loader.save).not.toHaveBeenCalled();
    expect(manager.init).not.toHaveBeenCalled();
  });

  it("refuses the whole registration when an ID belongs to another command", async () => {
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
    const { store } = createBindingStore();

    await expect(registerShortcuts(SHORTCUTS, manager, store)).rejects.toThrow(
      "shortcut ID is already owned by some-other-command",
    );
    expect(manager.loader.save).not.toHaveBeenCalled();
    expect(store.read).not.toHaveBeenCalled();
  });

  it("restores the legacy pop-out binding into the renamed project", async () => {
    const retained = {
      key: "o",
      keycode: "",
      modifiers: POP_OUT_SHORTCUT.defaultBinding.modifiers,
    };
    const getStringPref = vi.fn((name: string, fallback: string) =>
      name === "zen.pop-out-tab.saved-binding" ? JSON.stringify(retained) : fallback,
    );
    const setStringPref = vi.fn();
    vi.stubGlobal("Services", { prefs: { getStringPref, setStringPref } });
    const { manager, read } = createManager({ shortcuts: [] });

    await registerShortcuts([POP_OUT_SHORTCUT], manager);
    await unregisterShortcuts([POP_OUT_SHORTCUT], manager);

    expect(read().shortcuts).toEqual([]);
    expect(manager.loader.save).toHaveBeenCalledTimes(2);
    expect(setStringPref).toHaveBeenCalledWith(
      "zen.extended-tab-shortcuts.saved-binding.pop-out-tab-key",
      JSON.stringify(retained),
    );
  });
});

describe("unregisterShortcuts", () => {
  it("removes every action and retains each user binding with one rebuild", async () => {
    const existing = SHORTCUTS.map((shortcut, index) => ({
      id: shortcut.id,
      action: shortcut.action,
      key: index === 0 ? "p" : "k",
      keycode: "",
      group: "zen-other",
      l10nId: null,
      modifiers: shortcut.defaultBinding.modifiers,
      disabled: false,
      reserved: true,
      internal: false,
    }));
    const { manager, read } = createManager({ shortcuts: existing });
    const { read: readBinding, store } = createBindingStore();

    const removed = await unregisterShortcuts(SHORTCUTS, manager, store);

    expect(removed).toBe(2);
    expect(read().shortcuts).toEqual([]);
    expect(readBinding(POP_OUT_SHORTCUT_ID)).toEqual({
      key: "p",
      keycode: "",
      modifiers: existing[0]?.modifiers,
    });
    expect(readBinding(SELECT_NEXT_SHORTCUT.id)).toEqual({
      key: "k",
      keycode: "",
      modifiers: existing[1]?.modifiers,
    });
    expect(manager.loader.save).toHaveBeenCalledOnce();
    expect(manager.init).toHaveBeenCalledOnce();
  });

  it("restores each retained binding when the mod is enabled again", async () => {
    const { manager, read } = createManager({ shortcuts: [] });
    const { store } = createBindingStore();
    store.write(POP_OUT_SHORTCUT_ID, {
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
    store.write(SELECT_NEXT_SHORTCUT.id, {
      key: "ArrowDown",
      keycode: "",
      modifiers: SELECT_NEXT_SHORTCUT.defaultBinding.modifiers,
    });

    await registerShortcuts(SHORTCUTS, manager, store);

    expect(read().shortcuts[0]).toMatchObject({
      id: POP_OUT_SHORTCUT_ID,
      key: "p",
      modifiers: {
        control: true,
        shift: true,
        meta: true,
      },
    });
    expect(read().shortcuts[1]).toMatchObject({
      id: SELECT_NEXT_SHORTCUT.id,
      key: "ArrowDown",
    });
  });
});
