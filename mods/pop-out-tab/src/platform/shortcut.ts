export const POP_OUT_SHORTCUT_ID = "pop-out-tab-key";
export const POP_OUT_COMMAND_ID = "Pop Out Current Tab";
const BINDING_PREFERENCE = "zen.pop-out-tab.saved-binding";

export interface ShortcutModifiers {
  readonly control: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
  readonly accel: boolean;
}

export interface SavedShortcut {
  readonly id: string;
  readonly key: string;
  readonly keycode: string;
  readonly group: string;
  readonly l10nId: string | null;
  readonly modifiers: ShortcutModifiers;
  readonly action: string | null;
  readonly disabled: boolean;
  readonly reserved: boolean;
  readonly internal: boolean;
}

export interface ShortcutBinding {
  readonly key: string;
  readonly keycode: string;
  readonly modifiers: ShortcutModifiers;
}

export interface ShortcutBindingStore {
  read(): ShortcutBinding | null;
  write(binding: ShortcutBinding): void;
}

export interface ShortcutFile {
  readonly shortcuts: SavedShortcut[];
  readonly [key: string]: unknown;
}

export interface ShortcutManager {
  readonly loader: {
    loadObject(): Promise<ShortcutFile | null>;
    save(value: ShortcutFile): Promise<void>;
  };
  init(): Promise<void>;
}

const defaultBinding = (): ShortcutBinding => ({
  key: "n",
  keycode: "",
  modifiers: {
    control: true,
    alt: false,
    shift: false,
    meta: true,
    accel: false,
  },
});

const validModifiers = (value: unknown): value is ShortcutModifiers => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ShortcutModifiers>;
  return [
    candidate.control,
    candidate.alt,
    candidate.shift,
    candidate.meta,
    candidate.accel,
  ].every(modifier => typeof modifier === "boolean");
};

const parseBinding = (raw: string): ShortcutBinding | null => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ShortcutBinding>;
    if (
      typeof value.key !== "string" ||
      typeof value.keycode !== "string" ||
      !validModifiers(value.modifiers)
    ) {
      return null;
    }
    return {
      key: value.key,
      keycode: value.keycode,
      modifiers: value.modifiers,
    };
  } catch {
    return null;
  }
};

const preferenceBindingStore: ShortcutBindingStore = {
  read: () => parseBinding(Services.prefs.getStringPref(BINDING_PREFERENCE, "")),
  write: binding => {
    Services.prefs.setStringPref(BINDING_PREFERENCE, JSON.stringify(binding));
  },
};

const shortcutFor = (binding: ShortcutBinding): SavedShortcut => ({
  id: POP_OUT_SHORTCUT_ID,
  key: binding.key,
  keycode: binding.keycode,
  group: "zen-other",
  l10nId: null,
  modifiers: binding.modifiers,
  action: POP_OUT_COMMAND_ID,
  disabled: false,
  reserved: true,
  internal: false,
});

// Zen 1.21.14b: ZenKeyboardShortcuts.mjs persists, reloads, and renders this private schema.
export const registerPopOutTabShortcut = async (
  manager: ShortcutManager = gZenKeyboardShortcutsManager,
  bindingStore: ShortcutBindingStore = preferenceBindingStore,
): Promise<boolean> => {
  const saved = await manager.loader.loadObject();
  if (!saved || !Array.isArray(saved.shortcuts)) {
    throw new Error("Zen shortcut data is unavailable");
  }

  const existing = saved.shortcuts.find(shortcut => shortcut.id === POP_OUT_SHORTCUT_ID);
  if (existing) {
    if (existing.action !== POP_OUT_COMMAND_ID) {
      throw new Error(`shortcut ID is already owned by ${String(existing.action)}`);
    }
    return false;
  }

  await manager.loader.save({
    ...saved,
    shortcuts: [...saved.shortcuts, shortcutFor(bindingStore.read() ?? defaultBinding())],
  });
  await manager.init();
  return true;
};

export const unregisterPopOutTabShortcut = async (
  manager: ShortcutManager = gZenKeyboardShortcutsManager,
  bindingStore: ShortcutBindingStore = preferenceBindingStore,
): Promise<boolean> => {
  const saved = await manager.loader.loadObject();
  if (!saved || !Array.isArray(saved.shortcuts)) {
    throw new Error("Zen shortcut data is unavailable");
  }
  const existing = saved.shortcuts.find(shortcut => shortcut.id === POP_OUT_SHORTCUT_ID);
  if (!existing) return false;
  if (existing.action !== POP_OUT_COMMAND_ID) {
    throw new Error(`shortcut ID is already owned by ${String(existing.action)}`);
  }

  bindingStore.write({
    key: existing.key,
    keycode: existing.keycode,
    modifiers: existing.modifiers,
  });
  await manager.loader.save({
    ...saved,
    shortcuts: saved.shortcuts.filter(shortcut => shortcut.id !== POP_OUT_SHORTCUT_ID),
  });
  await manager.init();
  return true;
};
