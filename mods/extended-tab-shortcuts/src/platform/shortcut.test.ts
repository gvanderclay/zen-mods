import { describe, expect, it, vi } from "vitest";
import { FOLDER_MOVE_SHORTCUT } from "./folder-shortcuts.ts";
import {
  bindingFromLegacyEntry,
  bindingsMatch,
  CLEAR_SELECTION_COMMAND_ID,
  CLEAR_SELECTION_SHORTCUT,
  EXTEND_SELECTION_NEXT_COMMAND_ID,
  EXTEND_SELECTION_PREVIOUS_COMMAND_ID,
  type LegacyShortcutData,
  nativeBindingAttributes,
  nativeModifierString,
  POP_OUT_COMMAND_ID,
  POP_OUT_SHORTCUT,
  POP_OUT_SHORTCUT_ID,
  parseBinding,
  planShortcutMigration,
  SELECT_NEXT_ARROW_SHORTCUT,
  SELECT_NEXT_VIM_SHORTCUT,
  SELECT_PREVIOUS_ARROW_SHORTCUT,
  SELECT_PREVIOUS_VIM_SHORTCUT,
  type ShortcutBinding,
  type ShortcutDefinition,
  TAB_SELECTION_SHORTCUTS,
} from "./shortcut.ts";
import {
  type LegacyShortcutSource,
  migrateShortcutBindings,
  type NativeShortcutStore,
} from "./shortcut-migration.ts";
import {
  MOVE_NEXT_SPACE_ARROW_SHORTCUT,
  MOVE_NEXT_SPACE_VIM_SHORTCUT,
  MOVE_PREVIOUS_SPACE_ARROW_SHORTCUT,
  MOVE_PREVIOUS_SPACE_VIM_SHORTCUT,
} from "./space-shortcuts.ts";

const DEFINITIONS: readonly ShortcutDefinition[] = [
  SELECT_NEXT_VIM_SHORTCUT,
  SELECT_NEXT_ARROW_SHORTCUT,
  SELECT_PREVIOUS_VIM_SHORTCUT,
  SELECT_PREVIOUS_ARROW_SHORTCUT,
  CLEAR_SELECTION_SHORTCUT,
  POP_OUT_SHORTCUT,
  MOVE_NEXT_SPACE_VIM_SHORTCUT,
  MOVE_NEXT_SPACE_ARROW_SHORTCUT,
  MOVE_PREVIOUS_SPACE_VIM_SHORTCUT,
  MOVE_PREVIOUS_SPACE_ARROW_SHORTCUT,
  FOLDER_MOVE_SHORTCUT,
];

const binding = (
  key: string,
  keycode = "",
  overrides: Partial<ShortcutBinding["modifiers"]> = {},
): ShortcutBinding => ({
  key,
  keycode,
  modifiers: {
    accel: false,
    alt: false,
    control: true,
    meta: true,
    shift: false,
    ...overrides,
  },
});

const legacyData = (overrides: Partial<LegacyShortcutData> = {}): LegacyShortcutData => ({
  file: { bindings: new Map(), invalidIds: [], state: "read" },
  popOutPreference: null,
  preferences: new Map(),
  ...overrides,
});

const readFile = (
  bindings: ReadonlyMap<string, ShortcutBinding>,
): LegacyShortcutData["file"] => ({
  bindings,
  invalidIds: [],
  state: "read",
});

describe("shortcut definitions", () => {
  it("keeps the eleven approved menu entries in README table order", () => {
    expect(
      DEFINITIONS.map(definition => ({
        action: definition.action,
        id: definition.id,
        label: definition.label,
      })),
    ).toEqual([
      {
        action: EXTEND_SELECTION_NEXT_COMMAND_ID,
        id: "extended-tab-shortcuts-select-next-vim-key",
        label: "Extend Tab Selection Next",
      },
      {
        action: EXTEND_SELECTION_NEXT_COMMAND_ID,
        id: "extended-tab-shortcuts-select-next-arrow-key",
        label: "Extend Tab Selection Next (Alternate)",
      },
      {
        action: EXTEND_SELECTION_PREVIOUS_COMMAND_ID,
        id: "extended-tab-shortcuts-select-previous-vim-key",
        label: "Extend Tab Selection Previous",
      },
      {
        action: EXTEND_SELECTION_PREVIOUS_COMMAND_ID,
        id: "extended-tab-shortcuts-select-previous-arrow-key",
        label: "Extend Tab Selection Previous (Alternate)",
      },
      {
        action: CLEAR_SELECTION_COMMAND_ID,
        id: "extended-tab-shortcuts-clear-selection-key",
        label: "Clear Tab Selection",
      },
      {
        action: POP_OUT_COMMAND_ID,
        id: POP_OUT_SHORTCUT_ID,
        label: "Pop Out / Merge Selected Tabs",
      },
      {
        action: "Move Selected Tabs to Next Space",
        id: "extended-tab-shortcuts-move-next-space-vim-key",
        label: "Move Selected Tabs to Next Space",
      },
      {
        action: "Move Selected Tabs to Next Space",
        id: "extended-tab-shortcuts-move-next-space-arrow-key",
        label: "Move Selected Tabs to Next Space (Alternate)",
      },
      {
        action: "Move Selected Tabs to Previous Space",
        id: "extended-tab-shortcuts-move-previous-space-vim-key",
        label: "Move Selected Tabs to Previous Space",
      },
      {
        action: "Move Selected Tabs to Previous Space",
        id: "extended-tab-shortcuts-move-previous-space-arrow-key",
        label: "Move Selected Tabs to Previous Space (Alternate)",
      },
      {
        action: "Move Selected Tabs to Folder",
        id: "extended-tab-shortcuts-move-to-folder-key",
        label: "Move Selected Tabs to Folder",
      },
    ]);
  });

  it("keeps every existing default and alternative binding", () => {
    expect(
      DEFINITIONS.map(definition => ({
        key: definition.defaultBinding.key,
        keycode: definition.defaultBinding.keycode,
        modifiers: nativeModifierString(definition.defaultBinding.modifiers),
      })),
    ).toEqual([
      { key: "j", keycode: "", modifiers: "control,meta" },
      { key: "", keycode: "VK_DOWN", modifiers: "control,meta" },
      { key: "k", keycode: "", modifiers: "control,meta" },
      { key: "", keycode: "VK_UP", modifiers: "control,meta" },
      { key: "`", keycode: "", modifiers: "control,meta" },
      { key: "o", keycode: "", modifiers: "control,meta" },
      { key: "n", keycode: "", modifiers: "control,meta" },
      { key: "", keycode: "VK_RIGHT", modifiers: "control,meta,shift" },
      { key: "p", keycode: "", modifiers: "control,meta" },
      { key: "", keycode: "VK_LEFT", modifiers: "control,meta,shift" },
      { key: "m", keycode: "", modifiers: "control,meta" },
    ]);
    expect(TAB_SELECTION_SHORTCUTS).toHaveLength(5);
  });

  it("formats native attributes the way CustomKeys stores them", () => {
    expect(nativeBindingAttributes(binding("j"))).toEqual({
      key: "j",
      modifiers: "control,meta",
    });
    expect(nativeBindingAttributes(binding("", "VK_DOWN"))).toEqual({
      keycode: "VK_DOWN",
      modifiers: "control,meta",
    });
    expect(
      nativeModifierString({
        accel: true,
        alt: true,
        control: false,
        meta: false,
        shift: true,
      }),
    ).toBe("accel,alt,shift");
  });

  it("parses legacy binding objects and preference strings", () => {
    expect(
      bindingFromLegacyEntry({
        key: "p",
        keycode: "",
        modifiers: binding("p").modifiers,
      }),
    ).toEqual(binding("p"));
    expect(
      bindingFromLegacyEntry({ keycode: "VK_UP", modifiers: binding("").modifiers }),
    ).toEqual(binding("", "VK_UP"));
    expect(
      bindingFromLegacyEntry({ key: "", keycode: "", modifiers: binding("").modifiers }),
    ).toBeNull();
    expect(bindingFromLegacyEntry({ key: "p" })).toBeNull();
    expect(parseBinding(JSON.stringify(binding("p")))).toEqual(binding("p"));
    expect(parseBinding("{not json")).toBeNull();
    expect(parseBinding("")).toBeNull();
  });

  it("compares bindings by their native attributes", () => {
    expect(bindingsMatch(binding("j"), binding("j"))).toBe(true);
    expect(bindingsMatch(binding("j"), binding("J"))).toBe(false);
    expect(bindingsMatch(binding("", "VK_DOWN"), binding("j"))).toBe(false);
  });
});

describe("planShortcutMigration", () => {
  it("keeps a current native customization", () => {
    const plan = planShortcutMigration({
      current: new Set([POP_OUT_SHORTCUT_ID]),
      definitions: DEFINITIONS,
      legacy: legacyData({
        file: readFile(new Map([[POP_OUT_SHORTCUT_ID, binding("y")]])),
      }),
    });

    expect(plan.writes).toEqual([]);
    expect(plan.problems).toEqual([]);
  });

  it("keeps a deliberately cleared native binding", () => {
    const plan = planShortcutMigration({
      current: new Set([POP_OUT_SHORTCUT_ID]),
      definitions: DEFINITIONS,
      legacy: legacyData({
        file: readFile(new Map([[POP_OUT_SHORTCUT_ID, binding("y")]])),
      }),
    });

    expect(plan.writes).toEqual([]);
  });

  it("carries a legacy-only binding that differs from the default", () => {
    const plan = planShortcutMigration({
      current: new Set(),
      definitions: DEFINITIONS,
      legacy: legacyData({
        file: readFile(new Map([[POP_OUT_SHORTCUT_ID, binding("y")]])),
      }),
    });

    expect(plan.writes).toEqual([
      { binding: binding("y"), id: POP_OUT_SHORTCUT_ID, source: "legacy-file" },
    ]);
    expect(plan.problems).toEqual([]);
  });

  it("does not write a legacy binding that equals the current default", () => {
    const plan = planShortcutMigration({
      current: new Set(),
      definitions: DEFINITIONS,
      legacy: legacyData({
        file: readFile(new Map([[POP_OUT_SHORTCUT_ID, binding("o")]])),
      }),
    });

    expect(plan.writes).toEqual([]);
  });

  it("migrates a previous default binding to the current default without writing", () => {
    const plan = planShortcutMigration({
      current: new Set(),
      definitions: DEFINITIONS,
      legacy: legacyData({
        preferences: new Map([[POP_OUT_SHORTCUT_ID, binding("n")]]),
      }),
    });

    expect(plan.writes).toEqual([]);
    expect(plan.consumedPreferences).toEqual([POP_OUT_SHORTCUT_ID]);
  });

  it("prefers a preference backup over the older Pop Out Tab preference", () => {
    const plan = planShortcutMigration({
      current: new Set(),
      definitions: DEFINITIONS,
      legacy: legacyData({
        popOutPreference: binding("y"),
        preferences: new Map([[POP_OUT_SHORTCUT_ID, binding("p")]]),
      }),
    });

    expect(plan.writes).toEqual([
      { binding: binding("p"), id: POP_OUT_SHORTCUT_ID, source: "preference-backup" },
    ]);
    expect(plan.consumedPopOutPreference).toBe(true);
  });

  it("uses the legacy Pop Out Tab preference when nothing newer survives", () => {
    const plan = planShortcutMigration({
      current: new Set(),
      definitions: DEFINITIONS,
      legacy: legacyData({ popOutPreference: binding("y") }),
    });

    expect(plan.writes).toEqual([
      { binding: binding("y"), id: POP_OUT_SHORTCUT_ID, source: "pop-out-preference" },
    ]);
  });

  it("prefers the legacy shortcut file over a preference backup", () => {
    const plan = planShortcutMigration({
      current: new Set(),
      definitions: DEFINITIONS,
      legacy: legacyData({
        file: readFile(new Map([[POP_OUT_SHORTCUT_ID, binding("y")]])),
        preferences: new Map([[POP_OUT_SHORTCUT_ID, binding("p")]]),
      }),
    });

    expect(plan.writes[0]?.source).toBe("legacy-file");
    expect(plan.writes[0]?.binding).toEqual(binding("y"));
  });

  it("reports unreadable legacy data without guessing a binding", () => {
    const plan = planShortcutMigration({
      current: new Set(),
      definitions: DEFINITIONS,
      legacy: legacyData({
        file: { state: "unreadable" },
        preferences: new Map([[POP_OUT_SHORTCUT_ID, binding("p")]]),
      }),
    });

    expect(plan.problems).toEqual(["legacy shortcut data is unreadable"]);
    expect(plan.writes).toEqual([
      { binding: binding("p"), id: POP_OUT_SHORTCUT_ID, source: "preference-backup" },
    ]);
  });

  it("reports an unreadable entry for an owned id", () => {
    const plan = planShortcutMigration({
      current: new Set(),
      definitions: DEFINITIONS,
      legacy: legacyData({
        file: { bindings: new Map(), invalidIds: [POP_OUT_SHORTCUT_ID], state: "read" },
      }),
    });

    expect(plan.problems).toEqual([
      `legacy shortcut data is unreadable for ${POP_OUT_SHORTCUT_ID}`,
    ]);
    expect(plan.writes).toEqual([]);
  });

  it("keeps defaults when no legacy data survives", () => {
    const plan = planShortcutMigration({
      current: new Set(),
      definitions: DEFINITIONS,
      legacy: legacyData({ file: { state: "absent" } }),
    });

    expect(plan).toEqual({
      consumedPopOutPreference: false,
      consumedPreferences: [],
      problems: [],
      writes: [],
    });
  });
});

const createStore = (current: ReadonlySet<string> | null) => {
  const writes: { id: string; binding: ShortcutBinding }[] = [];
  const store: NativeShortcutStore = {
    readCustomizations: async () => current,
    write: (id, value) => {
      writes.push({ binding: value, id });
    },
  };
  return { store, writes };
};

const createLegacy = (
  overrides: Partial<LegacyShortcutData>,
  options: { migrated?: boolean } = {},
) => {
  const data = legacyData(overrides);
  const cleared: string[] = [];
  let migrated = options.migrated ?? false;
  let popOutCleared = false;
  const legacy: LegacyShortcutSource = {
    clearPopOutPreference: () => {
      popOutCleared = true;
    },
    clearPreference: id => {
      cleared.push(id);
    },
    isMigrated: () => migrated,
    markMigrated: () => {
      migrated = true;
    },
    read: async () => data,
  };
  return {
    cleared,
    legacy,
    isMigrated: () => migrated,
    isPopOutCleared: () => popOutCleared,
  };
};

describe("migrateShortcutBindings", () => {
  it("writes only the planned bindings, consumes their sources and marks the migration", async () => {
    const { store, writes } = createStore(new Set());
    const { cleared, legacy, isMigrated, isPopOutCleared } = createLegacy({
      file: readFile(new Map([[POP_OUT_SHORTCUT_ID, binding("y")]])),
      popOutPreference: binding("y"),
      preferences: new Map([[SELECT_NEXT_VIM_SHORTCUT.id, binding("u")]]),
    });
    const report = vi.fn();

    const result = await migrateShortcutBindings({
      definitions: DEFINITIONS,
      isLive: () => true,
      legacy,
      report,
      store,
    });

    expect(result.status).toBe("migrated");
    expect(writes).toEqual([
      { binding: binding("u"), id: SELECT_NEXT_VIM_SHORTCUT.id },
      { binding: binding("y"), id: POP_OUT_SHORTCUT_ID },
    ]);
    expect(cleared).toEqual([SELECT_NEXT_VIM_SHORTCUT.id]);
    expect(isPopOutCleared()).toBe(true);
    expect(isMigrated()).toBe(true);
    expect(report).not.toHaveBeenCalled();
  });

  it("does nothing after a completed migration", async () => {
    const { store, writes } = createStore(new Set());
    const { legacy, isMigrated } = createLegacy(
      { file: readFile(new Map([[POP_OUT_SHORTCUT_ID, binding("y")]])) },
      { migrated: true },
    );

    const result = await migrateShortcutBindings({
      definitions: DEFINITIONS,
      isLive: () => true,
      legacy,
      report: vi.fn(),
      store,
    });

    expect(result.status).toBe("already-migrated");
    expect(writes).toEqual([]);
    expect(isMigrated()).toBe(true);
  });

  it("keeps defaults and reports when current native data is unreadable", async () => {
    const { store, writes } = createStore(null);
    const { legacy, isMigrated } = createLegacy({
      file: readFile(new Map([[POP_OUT_SHORTCUT_ID, binding("y")]])),
    });
    const report = vi.fn();

    const result = await migrateShortcutBindings({
      definitions: DEFINITIONS,
      isLive: () => true,
      legacy,
      report,
      store,
    });

    expect(result.status).toBe("unreadable-current");
    expect(writes).toEqual([]);
    expect(isMigrated()).toBe(false);
    expect(report).toHaveBeenCalledWith(
      "current shortcut customizations are unreadable; keeping defaults",
    );
  });

  it("stops without writing when the generation is no longer live", async () => {
    const { store, writes } = createStore(new Set());
    const { legacy, isMigrated } = createLegacy({
      file: readFile(new Map([[POP_OUT_SHORTCUT_ID, binding("y")]])),
    });

    const result = await migrateShortcutBindings({
      definitions: DEFINITIONS,
      isLive: () => false,
      legacy,
      report: vi.fn(),
      store,
    });

    expect(result.status).toBe("cancelled");
    expect(writes).toEqual([]);
    expect(isMigrated()).toBe(false);
  });

  it("reports a failed native write and leaves the migration open", async () => {
    const store: NativeShortcutStore = {
      readCustomizations: async () => new Set(),
      write: () => {
        throw new Error("CustomKeys unavailable");
      },
    };
    const { legacy, isMigrated } = createLegacy({
      file: readFile(new Map([[POP_OUT_SHORTCUT_ID, binding("y")]])),
    });
    const report = vi.fn();

    const result = await migrateShortcutBindings({
      definitions: DEFINITIONS,
      isLive: () => true,
      legacy,
      report,
      store,
    });

    expect(result.problems).toEqual([
      `could not migrate ${POP_OUT_SHORTCUT_ID}: Error: CustomKeys unavailable`,
    ]);
    expect(isMigrated()).toBe(false);
    expect(report).toHaveBeenCalledOnce();
  });

  it("leaves the migration open when legacy data is unreadable", async () => {
    const { store, writes } = createStore(new Set());
    const { cleared, legacy, isMigrated } = createLegacy({
      file: { state: "unreadable" },
      preferences: new Map([[POP_OUT_SHORTCUT_ID, binding("p")]]),
    });
    const report = vi.fn();

    const result = await migrateShortcutBindings({
      definitions: DEFINITIONS,
      isLive: () => true,
      legacy,
      report,
      store,
    });

    expect(result.problems).toEqual(["legacy shortcut data is unreadable"]);
    expect(writes).toHaveLength(1);
    expect(cleared).toEqual([]);
    expect(isMigrated()).toBe(false);
    expect(report).toHaveBeenCalledWith("legacy shortcut data is unreadable");
  });
});
