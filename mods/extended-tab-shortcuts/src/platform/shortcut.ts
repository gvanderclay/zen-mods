export const POP_OUT_SHORTCUT_ID = "pop-out-tab-key";
export const LEGACY_POP_OUT_COMMAND_ID = "Pop Out Current Tab";
export const POP_OUT_COMMAND_ID = "Pop Out / Merge Selected Tabs";
export const EXTEND_SELECTION_NEXT_COMMAND_ID = "Extend Tab Selection Next";
export const EXTEND_SELECTION_PREVIOUS_COMMAND_ID = "Extend Tab Selection Previous";
export const CLEAR_SELECTION_COMMAND_ID = "Clear Tab Selection";
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
  readonly legacyActions?: readonly string[];
  readonly previousDefaultBindings?: readonly ShortcutBinding[];
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

const commandControlBinding = (key: string, keycode = ""): ShortcutBinding => ({
  key,
  keycode,
  modifiers: {
    control: true,
    alt: false,
    shift: false,
    meta: true,
    accel: false,
  },
});

export const POP_OUT_SHORTCUT: ShortcutDefinition = {
  id: POP_OUT_SHORTCUT_ID,
  action: POP_OUT_COMMAND_ID,
  defaultBinding: commandControlBinding("o"),
  legacyActions: [LEGACY_POP_OUT_COMMAND_ID, "Pop Out Selected Tabs"],
  previousDefaultBindings: [commandControlBinding("n")],
};

export const TAB_SELECTION_SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    id: "extended-tab-shortcuts-select-next-vim-key",
    action: EXTEND_SELECTION_NEXT_COMMAND_ID,
    defaultBinding: commandControlBinding("j"),
  },
  {
    id: "extended-tab-shortcuts-select-next-arrow-key",
    action: EXTEND_SELECTION_NEXT_COMMAND_ID,
    defaultBinding: commandControlBinding("", "VK_DOWN"),
  },
  {
    id: "extended-tab-shortcuts-select-previous-vim-key",
    action: EXTEND_SELECTION_PREVIOUS_COMMAND_ID,
    defaultBinding: commandControlBinding("k"),
  },
  {
    id: "extended-tab-shortcuts-select-previous-arrow-key",
    action: EXTEND_SELECTION_PREVIOUS_COMMAND_ID,
    defaultBinding: commandControlBinding("", "VK_UP"),
  },
  {
    id: "extended-tab-shortcuts-clear-selection-key",
    action: CLEAR_SELECTION_COMMAND_ID,
    defaultBinding: commandControlBinding("`"),
  },
];

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

const bindingsMatch = (left: ShortcutBinding, right: ShortcutBinding): boolean =>
  left.key === right.key &&
  left.keycode === right.keycode &&
  left.modifiers.control === right.modifiers.control &&
  left.modifiers.alt === right.modifiers.alt &&
  left.modifiers.shift === right.modifiers.shift &&
  left.modifiers.meta === right.modifiers.meta &&
  left.modifiers.accel === right.modifiers.accel;

const migratePreviousDefault = (
  definition: ShortcutDefinition,
  binding: ShortcutBinding,
): ShortcutBinding =>
  definition.previousDefaultBindings?.some(previous => bindingsMatch(previous, binding))
    ? definition.defaultBinding
    : binding;

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
    if (
      existing &&
      existing.action !== definition.action &&
      !definition.legacyActions?.includes(String(existing.action))
    ) {
      throw new Error(`shortcut ID is already owned by ${String(existing.action)}`);
    }
  }

  const definitionsById = new Map(
    definitions.map(definition => [definition.id, definition]),
  );
  let migrations = 0;
  const migrated = saved.shortcuts.map(shortcut => {
    const definition = definitionsById.get(shortcut.id);
    if (!definition || shortcut.action === definition.action) return shortcut;
    migrations += 1;
    const binding = migratePreviousDefault(definition, shortcut);
    return {
      ...shortcut,
      action: definition.action,
      key: binding.key,
      keycode: binding.keycode,
      modifiers: binding.modifiers,
    };
  });
  const additions = definitions.flatMap(definition => {
    if (saved.shortcuts.some(shortcut => shortcut.id === definition.id)) return [];
    const retained = bindingStore.read(definition.id);
    return [
      shortcutFor(
        definition,
        retained
          ? migratePreviousDefault(definition, retained)
          : definition.defaultBinding,
      ),
    ];
  });
  const changes = migrations + additions.length;
  if (changes === 0) return 0;

  await manager.loader.save({
    ...saved,
    shortcuts: [...migrated, ...additions],
  });
  await manager.init();
  return changes;
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
