/**
 * One-time legacy shortcut migration into native CustomKeys storage.
 *
 * Approved contract: notes/extended-tab-shortcuts/DECISIONS.md (D02, 2026-11-14).
 *
 * Installed platform evidence (Zen 1.24.1b, build 20261106124806, Gecko 159.0.1):
 * - `moz-src/browser/components/customkeys/CustomKeys.sys.mjs:28-39` keeps rebinding in
 *   `customKeys.json` in the profile directory, keyed by key-element id; an empty object
 *   means the binding was deliberately cleared. `changeKey` writes the entry and reapplies
 *   it to every tracked window (CustomKeys.sys.mjs:162-198).
 * - `CustomKeys.sys.mjs:41-67` snapshots the original attributes the first time a
 *   customized key element is applied, which is what `getDefaultKey` reports.
 * - Zen's legacy migrator skips a key that is absent from the window unless its group is
 *   devTools, then deletes `zen-keyboard-shortcuts.json`
 *   (ZenKeyboardShortcuts.sys.mjs:291-326, 357-360). Old mod rows were `zen-other`, so
 *   those customizations are usually gone before this mod can read them.
 */
import {
  BINDING_PREFERENCE_PREFIX,
  bindingFromLegacyEntry,
  LEGACY_POP_OUT_BINDING_PREFERENCE,
  LEGACY_SHORTCUT_FILE,
  type LegacyShortcutData,
  NATIVE_MIGRATION_PREFERENCE,
  NATIVE_MIGRATION_VERSION,
  nativeBindingAttributes,
  parseBinding,
  planShortcutMigration,
  type ShortcutBinding,
  type ShortcutDefinition,
  type ShortcutMigrationWrite,
} from "./shortcut.ts";

export interface CustomKeysApi {
  changeKey(
    id: string,
    data: { modifiers?: string; key?: string; keycode?: string },
  ): void;
  getDefaultKey(
    id: string,
  ): { modifiers?: string; key?: string; keycode?: string } | null;
}

export interface NativeShortcutStore {
  /**
   * Key ids the browser already customizes, including deliberately cleared bindings.
   * `null` means the current native state could not be read, so nothing may be written.
   */
  readCustomizations(ids: readonly string[]): Promise<ReadonlySet<string> | null>;
  write(id: string, binding: ShortcutBinding): void;
}

const CUSTOM_KEYS_MODULE = "moz-src:///browser/components/customkeys/CustomKeys.sys.mjs";

let customKeysApi: CustomKeysApi | null = null;

export const customKeys = (): CustomKeysApi => {
  customKeysApi ??= (
    ChromeUtils.importESModule(CUSTOM_KEYS_MODULE) as { CustomKeys: CustomKeysApi }
  ).CustomKeys;
  return customKeysApi;
};

export const customKeysPath = (): string =>
  PathUtils.join(PathUtils.profileDir, "customKeys.json");

export const createNativeShortcutStore = (): NativeShortcutStore => ({
  readCustomizations: async ids => {
    const customized = new Set<string>();
    try {
      // The in-memory snapshot covers a customization the browser already applied,
      // including one changed moments ago (CustomKeys.sys.mjs:41-67, 162-198).
      for (const id of ids) {
        if (customKeys().getDefaultKey(id)) customized.add(id);
      }
      // The persisted file also covers a customization loaded after this window
      // started, before CustomKeys applies it to the owned keyset.
      let data: unknown;
      try {
        data = await IOUtils.readJSON(customKeysPath());
      } catch (error) {
        if ((error as { name?: string } | null)?.name === "NotFoundError") {
          data = {};
        } else {
          return null;
        }
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) return null;
      for (const id of ids) {
        if (Object.hasOwn(data, id)) customized.add(id);
      }
    } catch {
      return null;
    }
    return customized;
  },
  write: (id, binding) => {
    const attributes = nativeBindingAttributes(binding);
    customKeys().changeKey(id, {
      modifiers: attributes.modifiers,
      ...(attributes.key ? { key: attributes.key } : {}),
      ...(attributes.keycode ? { keycode: attributes.keycode } : {}),
    });
  },
});

export interface LegacyShortcutSource {
  isMigrated(): boolean;
  markMigrated(): void;
  read(definitions: readonly ShortcutDefinition[]): Promise<LegacyShortcutData>;
  clearPreference(id: string): void;
  clearPopOutPreference(): void;
}

const parseLegacyFile = (
  data: unknown,
  definitions: readonly ShortcutDefinition[],
): LegacyShortcutData["file"] => {
  const bindings = new Map<string, ShortcutBinding>();
  const invalidIds: string[] = [];
  const owned = new Set(definitions.map(definition => definition.id));
  const shortcuts = (data as { shortcuts?: unknown } | null)?.shortcuts;
  if (Array.isArray(shortcuts)) {
    for (const entry of shortcuts) {
      const id = (entry as { id?: unknown } | null)?.id;
      if (typeof id !== "string" || !owned.has(id)) continue;
      const binding = bindingFromLegacyEntry(entry);
      if (binding) {
        bindings.set(id, binding);
      } else {
        invalidIds.push(id);
      }
    }
  }
  return { bindings, invalidIds, state: "read" };
};

export const createLegacyShortcutSource = (): LegacyShortcutSource => ({
  clearPopOutPreference: () => {
    Services.prefs.clearUserPref(LEGACY_POP_OUT_BINDING_PREFERENCE);
  },
  clearPreference: id => {
    Services.prefs.clearUserPref(`${BINDING_PREFERENCE_PREFIX}${id}`);
  },
  isMigrated: () =>
    Services.prefs.getStringPref(NATIVE_MIGRATION_PREFERENCE, "") ===
    String(NATIVE_MIGRATION_VERSION),
  markMigrated: () => {
    Services.prefs.setStringPref(
      NATIVE_MIGRATION_PREFERENCE,
      String(NATIVE_MIGRATION_VERSION),
    );
  },
  read: async definitions => {
    const preferences = new Map<string, ShortcutBinding>();
    for (const definition of definitions) {
      const binding = parseBinding(
        Services.prefs.getStringPref(`${BINDING_PREFERENCE_PREFIX}${definition.id}`, ""),
      );
      if (binding) preferences.set(definition.id, binding);
    }
    const popOutPreference = parseBinding(
      Services.prefs.getStringPref(LEGACY_POP_OUT_BINDING_PREFERENCE, ""),
    );
    let file: LegacyShortcutData["file"];
    try {
      file = parseLegacyFile(
        await IOUtils.readJSON(
          PathUtils.join(PathUtils.profileDir, LEGACY_SHORTCUT_FILE),
        ),
        definitions,
      );
    } catch (error) {
      file =
        (error as { name?: string } | null)?.name === "NotFoundError"
          ? { state: "absent" }
          : { state: "unreadable" };
    }
    return { file, popOutPreference, preferences };
  },
});

export interface ShortcutMigrationDependencies {
  readonly definitions: readonly ShortcutDefinition[];
  readonly isLive: () => boolean;
  readonly report: (message: string) => void;
  readonly store?: NativeShortcutStore;
  readonly legacy?: LegacyShortcutSource;
}

export type ShortcutMigrationStatus =
  | "already-migrated"
  | "unreadable-current"
  | "cancelled"
  | "migrated";

export interface ShortcutMigrationResult {
  readonly status: ShortcutMigrationStatus;
  readonly writes: readonly ShortcutMigrationWrite[];
  readonly problems: readonly string[];
}

/**
 * Carry surviving legacy bindings into native CustomKeys storage once. Current native
 * customizations (including cleared ones) always win; unreadable data is reported and
 * never replaced with a guessed binding.
 */
export const migrateShortcutBindings = async ({
  definitions,
  isLive,
  report,
  store = createNativeShortcutStore(),
  legacy = createLegacyShortcutSource(),
}: ShortcutMigrationDependencies): Promise<ShortcutMigrationResult> => {
  if (legacy.isMigrated()) {
    return { problems: [], status: "already-migrated", writes: [] };
  }
  // biome-ignore lint/plugin/timing-readiness: yield one task for CustomKeys' mutation observer to apply stored bindings to the newly inserted owned keyset before reading customizations.
  await new Promise(resolve => setTimeout(resolve, 0));
  const current = await store.readCustomizations(
    definitions.map(definition => definition.id),
  );
  if (!current) {
    const problems = ["current shortcut customizations are unreadable; keeping defaults"];
    for (const problem of problems) report(problem);
    return { problems, status: "unreadable-current", writes: [] };
  }
  const plan = planShortcutMigration({
    current,
    definitions,
    legacy: await legacy.read(definitions),
  });
  if (!isLive()) {
    return { problems: plan.problems, status: "cancelled", writes: [] };
  }

  const problems = [...plan.problems];
  const writes: ShortcutMigrationWrite[] = [];
  for (const write of plan.writes) {
    try {
      store.write(write.id, write.binding);
      writes.push(write);
    } catch (error) {
      problems.push(`could not migrate ${write.id}: ${String(error)}`);
    }
  }
  for (const problem of problems) report(problem);
  if (problems.length > 0) {
    return { problems, status: "migrated", writes };
  }
  for (const id of plan.consumedPreferences) legacy.clearPreference(id);
  if (plan.consumedPopOutPreference) legacy.clearPopOutPreference();
  legacy.markMigrated();
  return { problems: [], status: "migrated", writes };
};
