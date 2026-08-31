export const POP_OUT_SHORTCUT_ID = "pop-out-tab-key";
export const POP_OUT_COMMAND_ID = "Pop Out Current Tab";
const LEGACY_POP_OUT_BINDING_PREFERENCE = "zen.pop-out-tab.saved-binding";
const BINDING_PREFERENCE_PREFIX = "zen.extended-tab-shortcuts.saved-binding.";

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
  read(id: string): ShortcutBinding | null;
  write(id: string, binding: ShortcutBinding): void;
}

export interface ShortcutDefinition {
  readonly id: string;
  readonly action: string;
  readonly defaultBinding: ShortcutBinding;
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

export const POP_OUT_SHORTCUT: ShortcutDefinition = {
  id: POP_OUT_SHORTCUT_ID,
  action: POP_OUT_COMMAND_ID,
  defaultBinding: {
    key: "n",
    keycode: "",
    modifiers: {
      control: true,
      alt: false,
      shift: false,
      meta: true,
      accel: false,
    },
  },
};

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
  read: id => {
    const current = parseBinding(
      Services.prefs.getStringPref(`${BINDING_PREFERENCE_PREFIX}${id}`, ""),
    );
    if (current || id !== POP_OUT_SHORTCUT_ID) return current;
    return parseBinding(
      Services.prefs.getStringPref(LEGACY_POP_OUT_BINDING_PREFERENCE, ""),
    );
  },
  write: (id, binding) => {
    Services.prefs.setStringPref(
      `${BINDING_PREFERENCE_PREFIX}${id}`,
      JSON.stringify(binding),
    );
  },
};

const shortcutFor = (
  definition: ShortcutDefinition,
  binding: ShortcutBinding,
): SavedShortcut => ({
  id: definition.id,
  key: binding.key,
  keycode: binding.keycode,
  group: "zen-other",
  l10nId: null,
  modifiers: binding.modifiers,
  action: definition.action,
  disabled: false,
  reserved: true,
  internal: false,
});

const validateDefinitions = (definitions: readonly ShortcutDefinition[]): void => {
  if (new Set(definitions.map(definition => definition.id)).size !== definitions.length) {
    throw new Error("shortcut IDs must be unique");
  }
};

// Zen 1.21.14b: ZenKeyboardShortcuts.mjs persists, reloads, and renders this private schema.
export const registerShortcuts = async (
  definitions: readonly ShortcutDefinition[],
  manager: ShortcutManager = gZenKeyboardShortcutsManager,
  bindingStore: ShortcutBindingStore = preferenceBindingStore,
): Promise<number> => {
  validateDefinitions(definitions);
  const saved = await manager.loader.loadObject();
  if (!saved || !Array.isArray(saved.shortcuts)) {
    throw new Error("Zen shortcut data is unavailable");
  }

  for (const definition of definitions) {
    const existing = saved.shortcuts.find(shortcut => shortcut.id === definition.id);
    if (existing && existing.action !== definition.action) {
      throw new Error(`shortcut ID is already owned by ${String(existing.action)}`);
    }
  }

  const additions = definitions
    .filter(
      definition => !saved.shortcuts.some(shortcut => shortcut.id === definition.id),
    )
    .map(definition =>
      shortcutFor(
        definition,
        bindingStore.read(definition.id) ?? definition.defaultBinding,
      ),
    );
  if (additions.length === 0) return 0;

  await manager.loader.save({
    ...saved,
    shortcuts: [...saved.shortcuts, ...additions],
  });
  await manager.init();
  return additions.length;
};

export const unregisterShortcuts = async (
  definitions: readonly ShortcutDefinition[],
  manager: ShortcutManager = gZenKeyboardShortcutsManager,
  bindingStore: ShortcutBindingStore = preferenceBindingStore,
): Promise<number> => {
  validateDefinitions(definitions);
  const saved = await manager.loader.loadObject();
  if (!saved || !Array.isArray(saved.shortcuts)) {
    throw new Error("Zen shortcut data is unavailable");
  }

  const existing = definitions.flatMap(definition => {
    const shortcut = saved.shortcuts.find(candidate => candidate.id === definition.id);
    if (!shortcut) return [];
    if (shortcut.action !== definition.action) {
      throw new Error(`shortcut ID is already owned by ${String(shortcut.action)}`);
    }
    return [shortcut];
  });
  if (existing.length === 0) return 0;

  for (const shortcut of existing) {
    bindingStore.write(shortcut.id, {
      key: shortcut.key,
      keycode: shortcut.keycode,
      modifiers: shortcut.modifiers,
    });
  }

  const ownedIds = new Set(definitions.map(definition => definition.id));
  await manager.loader.save({
    ...saved,
    shortcuts: saved.shortcuts.filter(shortcut => !ownedIds.has(shortcut.id)),
  });
  await manager.init();
  return existing.length;
};
