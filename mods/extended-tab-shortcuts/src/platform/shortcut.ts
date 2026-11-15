/**
 * Shortcut definitions, native CustomKeys storage and legacy binding migration.
 *
 * Installed platform evidence (Zen 1.24.1b, build 20261106124806, Gecko 159.0.1,
 * source b12eaefbca65b376950e1eb7ae84d3574022ba66):
 * - `moz-src/browser/components/customkeys/CustomKeys.sys.mjs` (gre omni.ja) keeps
 *   rebinding in `customKeys.json` in the profile directory, keyed by key-element id.
 *   An empty object means the binding was deliberately cleared (CustomKeys.sys.mjs:28-39);
 *   `changeKey` writes the entry and reapplies it to every tracked window
 *   (CustomKeys.sys.mjs:162-198). `resetKey` deletes the entry (CustomKeys.sys.mjs:205-217).
 * - `moz-src/browser/components/customkeys/CustomKeysParent.sys.mjs:85-121` builds the
 *   about:keyboard rows from `main-menubar menuitem[key]`, using the enclosing menu label
 *   as the category and the item label as the row title.
 * - Zen's legacy migrator skips a key that is absent from the window unless its group is
 *   devTools, then deletes `zen-keyboard-shortcuts.json`
 *   (ZenKeyboardShortcuts.sys.mjs:291-326, 357-360). Old mod rows were `zen-other`, so
 *   those customizations are usually gone before this mod can read them.
 */

export const POP_OUT_SHORTCUT_ID = "pop-out-tab-key";
export const POP_OUT_COMMAND_ID = "Pop Out / Merge Selected Tabs";
export const EXTEND_SELECTION_NEXT_COMMAND_ID = "Extend Tab Selection Next";
export const EXTEND_SELECTION_PREVIOUS_COMMAND_ID = "Extend Tab Selection Previous";
export const CLEAR_SELECTION_COMMAND_ID = "Clear Tab Selection";

/** Legacy sources owned by the replaced Zen manager and the former Pop Out Tab mod. */
export const LEGACY_SHORTCUT_FILE = "zen-keyboard-shortcuts.json";
export const LEGACY_POP_OUT_BINDING_PREFERENCE = "zen.pop-out-tab.saved-binding";
export const BINDING_PREFERENCE_PREFIX = "zen.extended-tab-shortcuts.saved-binding.";
/** One-time marker so consumed legacy data cannot resurrect a binding the user reset. */
export const NATIVE_MIGRATION_PREFERENCE = "zen.extended-tab-shortcuts.native-migration";
export const NATIVE_MIGRATION_VERSION = 1;

export interface ShortcutModifiers {
  readonly control: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
  readonly accel: boolean;
}

export interface ShortcutBinding {
  readonly key: string;
  readonly keycode: string;
  readonly modifiers: ShortcutModifiers;
}

export interface ShortcutDefinition {
  /** Key-element id. Kept stable so native customizations keep their identity. */
  readonly id: string;
  /** Plain-English menu and about:keyboard row label. */
  readonly label: string;
  /** Command id the key and menu item run. */
  readonly action: string;
  readonly defaultBinding: ShortcutBinding;
  readonly previousDefaultBindings?: readonly ShortcutBinding[];
}

/** Attribute form CustomKeys stores and reapplies (CustomKeys.sys.mjs:28-39, 41-67). */
export interface NativeBindingAttributes {
  readonly modifiers: string;
  readonly key?: string;
  readonly keycode?: string;
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
  label: "Pop Out / Merge Selected Tabs",
  action: POP_OUT_COMMAND_ID,
  defaultBinding: commandControlBinding("o"),
  previousDefaultBindings: [commandControlBinding("n")],
};

export const SELECT_NEXT_VIM_SHORTCUT: ShortcutDefinition = {
  id: "extended-tab-shortcuts-select-next-vim-key",
  label: "Extend Tab Selection Next",
  action: EXTEND_SELECTION_NEXT_COMMAND_ID,
  defaultBinding: commandControlBinding("j"),
};

export const SELECT_NEXT_ARROW_SHORTCUT: ShortcutDefinition = {
  id: "extended-tab-shortcuts-select-next-arrow-key",
  label: "Extend Tab Selection Next (Alternate)",
  action: EXTEND_SELECTION_NEXT_COMMAND_ID,
  defaultBinding: commandControlBinding("", "VK_DOWN"),
};

export const SELECT_PREVIOUS_VIM_SHORTCUT: ShortcutDefinition = {
  id: "extended-tab-shortcuts-select-previous-vim-key",
  label: "Extend Tab Selection Previous",
  action: EXTEND_SELECTION_PREVIOUS_COMMAND_ID,
  defaultBinding: commandControlBinding("k"),
};

export const SELECT_PREVIOUS_ARROW_SHORTCUT: ShortcutDefinition = {
  id: "extended-tab-shortcuts-select-previous-arrow-key",
  label: "Extend Tab Selection Previous (Alternate)",
  action: EXTEND_SELECTION_PREVIOUS_COMMAND_ID,
  defaultBinding: commandControlBinding("", "VK_UP"),
};

export const CLEAR_SELECTION_SHORTCUT: ShortcutDefinition = {
  id: "extended-tab-shortcuts-clear-selection-key",
  label: "Clear Tab Selection",
  action: CLEAR_SELECTION_COMMAND_ID,
  defaultBinding: commandControlBinding("`"),
};

export const TAB_SELECTION_SHORTCUTS: readonly ShortcutDefinition[] = [
  SELECT_NEXT_VIM_SHORTCUT,
  SELECT_NEXT_ARROW_SHORTCUT,
  SELECT_PREVIOUS_VIM_SHORTCUT,
  SELECT_PREVIOUS_ARROW_SHORTCUT,
  CLEAR_SELECTION_SHORTCUT,
];

const MODIFIER_NAMES = ["accel", "alt", "control", "meta", "shift"] as const;

/** Canonical CustomKeys modifier string; Zen normalizes the same way (ZenKeyboardShortcuts.sys.mjs:81-105). */
export const nativeModifierString = (modifiers: ShortcutModifiers): string =>
  MODIFIER_NAMES.filter(name => modifiers[name]).join(",");

export const nativeBindingAttributes = (
  binding: ShortcutBinding,
): NativeBindingAttributes => ({
  modifiers: nativeModifierString(binding.modifiers),
  ...(binding.key ? { key: binding.key } : {}),
  ...(binding.keycode ? { keycode: binding.keycode } : {}),
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

/** Parse one legacy binding object (old manager row, preference backup, Pop Out Tab pref). */
export const bindingFromLegacyEntry = (value: unknown): ShortcutBinding | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { key?: unknown; keycode?: unknown; modifiers?: unknown };
  const key = typeof candidate.key === "string" ? candidate.key : "";
  const keycode = typeof candidate.keycode === "string" ? candidate.keycode : "";
  if ((!key && !keycode) || !validModifiers(candidate.modifiers)) return null;
  return { key, keycode, modifiers: candidate.modifiers };
};

export const parseBinding = (raw: string): ShortcutBinding | null => {
  if (!raw) return null;
  try {
    return bindingFromLegacyEntry(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const bindingsMatch = (left: ShortcutBinding, right: ShortcutBinding): boolean => {
  const a = nativeBindingAttributes(left);
  const b = nativeBindingAttributes(right);
  return (
    a.modifiers === b.modifiers &&
    (a.key ?? "") === (b.key ?? "") &&
    (a.keycode ?? "") === (b.keycode ?? "")
  );
};

const migratePreviousDefault = (
  definition: ShortcutDefinition,
  binding: ShortcutBinding,
): ShortcutBinding =>
  definition.previousDefaultBindings?.some(previous => bindingsMatch(previous, binding))
    ? definition.defaultBinding
    : binding;

export type LegacyShortcutFile =
  | { readonly state: "absent" }
  | { readonly state: "unreadable" }
  | {
      readonly state: "read";
      readonly bindings: ReadonlyMap<string, ShortcutBinding>;
      readonly invalidIds: readonly string[];
    };

export interface LegacyShortcutData {
  readonly file: LegacyShortcutFile;
  /** `zen.extended-tab-shortcuts.saved-binding.*` backups written by the replaced mod. */
  readonly preferences: ReadonlyMap<string, ShortcutBinding>;
  /** `zen.pop-out-tab.saved-binding` left by the former Pop Out Tab mod. */
  readonly popOutPreference: ShortcutBinding | null;
}

export type LegacyBindingSource =
  | "legacy-file"
  | "preference-backup"
  | "pop-out-preference";

export interface ShortcutMigrationWrite {
  readonly id: string;
  readonly binding: ShortcutBinding;
  readonly source: LegacyBindingSource;
}

export interface ShortcutMigrationPlan {
  readonly writes: readonly ShortcutMigrationWrite[];
  readonly problems: readonly string[];
  readonly consumedPreferences: readonly string[];
  readonly consumedPopOutPreference: boolean;
}

/**
 * Approved D02 precedence: a current native customization, including a deliberately
 * cleared binding, always wins. Otherwise the newest surviving legacy value is carried
 * over only where it differs from the current default; previous defaults become the
 * current default and are not written. Unreadable legacy data is reported, never guessed.
 */
export const planShortcutMigration = ({
  definitions,
  current,
  legacy,
}: {
  readonly definitions: readonly ShortcutDefinition[];
  /** Key ids the browser already customizes, including deliberately cleared bindings. */
  readonly current: ReadonlySet<string>;
  readonly legacy: LegacyShortcutData;
}): ShortcutMigrationPlan => {
  const problems: string[] = [];
  if (legacy.file.state === "unreadable") {
    problems.push("legacy shortcut data is unreadable");
  }
  if (legacy.file.state === "read" && legacy.file.invalidIds.length > 0) {
    problems.push(
      `legacy shortcut data is unreadable for ${legacy.file.invalidIds.join(", ")}`,
    );
  }

  const writes: ShortcutMigrationWrite[] = [];
  const consumedPreferences: string[] = [];
  let consumedPopOutPreference = false;

  for (const definition of definitions) {
    const preference = legacy.preferences.get(definition.id) ?? null;
    if (preference) consumedPreferences.push(definition.id);
    const popOutPreference =
      definition.id === POP_OUT_SHORTCUT_ID ? legacy.popOutPreference : null;
    if (popOutPreference) consumedPopOutPreference = true;
    if (current.has(definition.id)) continue;

    const fileBinding =
      legacy.file.state === "read"
        ? (legacy.file.bindings.get(definition.id) ?? null)
        : null;
    const candidate = fileBinding
      ? { binding: fileBinding, source: "legacy-file" as const }
      : preference
        ? { binding: preference, source: "preference-backup" as const }
        : popOutPreference
          ? { binding: popOutPreference, source: "pop-out-preference" as const }
          : null;
    if (!candidate) continue;
    if (bindingsMatch(candidate.binding, definition.defaultBinding)) continue;
    if (
      bindingsMatch(
        migratePreviousDefault(definition, candidate.binding),
        definition.defaultBinding,
      )
    ) {
      continue;
    }
    writes.push({
      binding: candidate.binding,
      id: definition.id,
      source: candidate.source,
    });
  }

  return { consumedPopOutPreference, consumedPreferences, problems, writes };
};
