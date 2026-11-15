#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { collectVerdicts, validateAssertionManifest } from "@zen-mods/live-harness/core";
import { openMarionette } from "@zen-mods/live-harness/marionette";
import {
  installShutdownSignals,
  launchLiveZen,
} from "@zen-mods/live-harness/zen-launcher";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MOD_DIRECTORY = resolve(DIRECTORY, "../..");
const REPOSITORY_ROOT = resolve(MOD_DIRECTORY, "../..");
const MANIFEST_PATH = resolve(MOD_DIRECTORY, "theme.json");
const OUTPUT = resolve(
  REPOSITORY_ROOT,
  ".benchmarks/live/extended-tab-shortcuts.smoke.json",
);
const PRODUCTION_PATHS = ["dist/extended-tab-shortcuts.uc.mjs", "styles/chrome.css"];

const REQUIRED_ASSERTIONS = [
  "exact stamped platform is running",
  "manifest declares unload support",
  "production mod starts disabled",
  "enable registers every editable action",
  "Tools menu exposes the approved shortcut submenu",
  "legacy bindings migrate into native storage with current bindings winning",
  "native rebind persists and reapplies",
  "native key press runs the rebound binding",
  "shortcut screen lists every owned row after reopen",
  "shortcut screen keeps stale rows until reopened",
  "shortcut screen omits owned rows after disable and reopen",
  "selection commands grow, reverse, cross the anchor, and clear",
  "keyboard selection reveals an overflowing range edge",
  "keyboard selection does not cross the pinned boundary",
  "contiguous mouse selection continues with keyboard movement",
  "non-contiguous mouse selection starts a new keyboard range",
  "space commands move selected tabs in both directions",
  "space moves append tabs at the destination end",
  "space moves reveal the active tab in an overflowing destination",
  "space commands preserve pinned tabs",
  "space commands honor the wrap preference",
  "folder picker uses native panel anatomy",
  "folder picker supports Vim and arrow navigation",
  "folder picker moves a selection by number",
  "folder picker creates a named folder",
  "toggle creates one isolated window",
  "toggle reuses the existing isolated window",
  "toggle merges only selected tabs into the shared window",
  "toggle closes an emptied isolated window",
  "new window receives every registered action",
  "Sine reload replaces commands without duplicating shortcuts",
  "disable removes commands and editable actions",
  "re-enable restores user bindings",
  "cleared native bindings survive disable and re-enable",
  "foreign same-id nodes are rejected without mutation",
];

// Shared by both browser scripts; cap diagnostic text, not assertion data. Escape
// non-ASCII so the final limit is also a byte limit for saved JSON/log evidence.
export const boundedSnapshot = value =>
  JSON.stringify(value, (_key, item) =>
    typeof item === "string"
      ? item.slice(0, 180)
      : Array.isArray(item)
        ? item.slice(0, 12)
        : item,
  )
    .replace(
      /[^\x20-\x7e]/g,
      character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
    )
    .slice(0, 3600);

export const PROBE = `
  const boundedSnapshot = (${boundedSnapshot.toString()});
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  const SHORTCUTS = {
    popOut: "pop-out-tab-key",
    nextVim: "extended-tab-shortcuts-select-next-vim-key",
    nextArrow: "extended-tab-shortcuts-select-next-arrow-key",
    previousVim: "extended-tab-shortcuts-select-previous-vim-key",
    previousArrow: "extended-tab-shortcuts-select-previous-arrow-key",
    clear: "extended-tab-shortcuts-clear-selection-key",
    moveNextVim: "extended-tab-shortcuts-move-next-space-vim-key",
    moveNextArrow: "extended-tab-shortcuts-move-next-space-arrow-key",
    movePreviousVim: "extended-tab-shortcuts-move-previous-space-vim-key",
    movePreviousArrow: "extended-tab-shortcuts-move-previous-space-arrow-key",
    moveToFolder: "extended-tab-shortcuts-move-to-folder-key",
  };
  const COMMANDS = {
    popOut: "Pop Out / Merge Selected Tabs",
    next: "Extend Tab Selection Next",
    previous: "Extend Tab Selection Previous",
    clear: "Clear Tab Selection",
    moveNext: "Move Selected Tabs to Next Space",
    movePrevious: "Move Selected Tabs to Previous Space",
    moveToFolder: "Move Selected Tabs to Folder",
  };
  const OWNED_SHORTCUT_IDS = Object.values(SHORTCUTS);
  const OWNED_COMMAND_IDS = Object.values(COMMANDS);
  const MENU_LABEL = "Extended Tab Shortcuts";
  const MENU_IDS = {
    keyset: "extended-tab-shortcuts-keyset",
    menu: "extended-tab-shortcuts-menu",
    popup: "extended-tab-shortcuts-menu-popup",
    separator: "extended-tab-shortcuts-menu-separator",
  };
  const MENU_ORDER = [
    [SHORTCUTS.nextVim, "Extend Tab Selection Next"],
    [SHORTCUTS.nextArrow, "Extend Tab Selection Next (Alternate)"],
    [SHORTCUTS.previousVim, "Extend Tab Selection Previous"],
    [SHORTCUTS.previousArrow, "Extend Tab Selection Previous (Alternate)"],
    [SHORTCUTS.clear, "Clear Tab Selection"],
    [SHORTCUTS.popOut, "Pop Out / Merge Selected Tabs"],
    [SHORTCUTS.moveNextVim, "Move Selected Tabs to Next Space"],
    [SHORTCUTS.moveNextArrow, "Move Selected Tabs to Next Space (Alternate)"],
    [SHORTCUTS.movePreviousVim, "Move Selected Tabs to Previous Space"],
    [SHORTCUTS.movePreviousArrow, "Move Selected Tabs to Previous Space (Alternate)"],
    [SHORTCUTS.moveToFolder, "Move Selected Tabs to Folder"],
  ];
  const COMMAND_FOR_SHORTCUT = {
    [SHORTCUTS.popOut]: COMMANDS.popOut,
    [SHORTCUTS.nextVim]: COMMANDS.next,
    [SHORTCUTS.nextArrow]: COMMANDS.next,
    [SHORTCUTS.previousVim]: COMMANDS.previous,
    [SHORTCUTS.previousArrow]: COMMANDS.previous,
    [SHORTCUTS.clear]: COMMANDS.clear,
    [SHORTCUTS.moveNextVim]: COMMANDS.moveNext,
    [SHORTCUTS.moveNextArrow]: COMMANDS.moveNext,
    [SHORTCUTS.movePreviousVim]: COMMANDS.movePrevious,
    [SHORTCUTS.movePreviousArrow]: COMMANDS.movePrevious,
    [SHORTCUTS.moveToFolder]: COMMANDS.moveToFolder,
  };
  const MIGRATION_PREFERENCE = "zen.extended-tab-shortcuts.native-migration";
  const BINDING_PREFERENCE_PREFIX = "zen.extended-tab-shortcuts.saved-binding.";
  const LEGACY_POP_OUT_BINDING_PREFERENCE = "zen.pop-out-tab.saved-binding";
  const LEGACY_SHORTCUT_FILE = "zen-keyboard-shortcuts.json";
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const report = {
    assertions: [],
    currentWait: null,
    diagnostics: {},
    fatal: null,
    platform: null,
  };
  const check = (name, condition, detail) => {
    report.assertions.push({ name, ok: Boolean(condition), detail: String(detail ?? "") });
    return Boolean(condition);
  };
  // Console diagnostics stay in ordinary report fields so a timed-out wait reports the
  // observed state instead of only "false".
  const relevantConsole = (limit = 40) => {
    try {
      const messages = Services.console.getMessageArray() ?? [];
      return messages
        .map(message => String(message?.message ?? message))
        .filter(
          message =>
            message.includes("[extended-tab-shortcuts]") || message.includes("[Sine]")
        )
        .slice(-limit);
    } catch (error) {
      return ["<console unavailable: " + String(error) + ">"];
    }
  };
  const waitFor = async (name, read, timeout = 30000, describe = null) => {
    report.currentWait = name;
    const deadline = Date.now() + timeout;
    let value;
    while (Date.now() < deadline) {
      value = await read();
      if (value) {
        report.currentWait = null;
        return value;
      }
      await wait(25);
    }
    let observed = "";
    if (describe) {
      try {
        observed = "; snapshot: " + boundedSnapshot(await describe());
      } catch (error) {
        observed = "; observed: <describe failed: " + String(error) + ">";
      }
    }
    throw new Error(
      "timed out waiting for " + name + "; last value: " + String(value) + observed
    );
  };
  const windows = () => [...Services.wm.getEnumerator("navigator:browser")]
    .filter(candidate => !candidate.closed);
  const command = (candidate, id = COMMANDS.popOut) =>
    candidate.document.getElementById(id);
  const key = (candidate, id = SHORTCUTS.popOut) =>
    candidate.document.getElementById(id);
  const commandCount = (candidate, id = COMMANDS.popOut) =>
    [...candidate.document.getElementsByTagName("command")]
      .filter(node => node.id === id).length;
  const folderPanel = candidate =>
    candidate.document.getElementById("extended-tab-shortcuts-folder-panel");
  const hasAllCommands = candidate =>
    OWNED_COMMAND_IDS.every(id => command(candidate, id));
  const hasAllKeys = candidate => OWNED_SHORTCUT_IDS.every(id => key(candidate, id));
  const hasNoCommands = candidate =>
    OWNED_COMMAND_IDS.every(id => command(candidate, id) === null);
  const hasNoKeys = candidate =>
    OWNED_SHORTCUT_IDS.every(id => key(candidate, id) === null);
  const customKeys = () =>
    ChromeUtils.importESModule(
      "moz-src:///browser/components/customkeys/CustomKeys.sys.mjs"
    ).CustomKeys;
  const customKeysPath = () =>
    PathUtils.join(PathUtils.profileDir, "customKeys.json");
  const readCustomKeys = async () => {
    try {
      return (await IOUtils.readJSON(customKeysPath())) ?? {};
    } catch (error) {
      if (error?.name === "NotFoundError") return {};
      throw error;
    }
  };
  const ownedCustomKeys = async () => {
    const data = await readCustomKeys();
    return Object.fromEntries(
      Object.entries(data).filter(([id]) => OWNED_SHORTCUT_IDS.includes(id))
    );
  };
  const ownedKeyset = candidate =>
    candidate.document.getElementById(MENU_IDS.keyset);
  const ownedMenu = candidate =>
    candidate.document.getElementById(MENU_IDS.menu);
  const hasOwnedSurface = candidate => !!ownedKeyset(candidate) && !!ownedMenu(candidate);
  const hasNoOwnedSurface = candidate =>
    !ownedKeyset(candidate) && !ownedMenu(candidate);
  const ownedKeysetCount = candidate =>
    [...candidate.document.querySelectorAll("keyset")].filter(
      node => node.id === MENU_IDS.keyset
    ).length;
  const ownedKeyCount = candidate =>
    [...candidate.document.getElementsByTagName("key")].filter(node =>
      OWNED_SHORTCUT_IDS.includes(node.id)
    ).length;
  const keyAttributes = (candidate, id) => {
    const element = key(candidate, id);
    return element
      ? {
          command: element.getAttribute("command"),
          key: element.getAttribute("key"),
          keycode: element.getAttribute("keycode"),
          modifiers: element.getAttribute("modifiers"),
        }
      : null;
  };
  const legacyBinding = (keyName, modifiers) => ({
    key: keyName,
    keycode: "",
    modifiers: {
      accel: false,
      alt: modifiers.includes("alt"),
      control: modifiers.includes("control"),
      meta: modifiers.includes("meta"),
      shift: modifiers.includes("shift"),
    },
  });

  (async () => {
    let sineManager;
    let sineUtils;
    let enabled = false;
    let openedWindow;
    let testTab;
    let popOutObserver;
    let observingPopOut = false;
    const popOutWatches = new Map();
    const testTabs = [];
    let failureState = null;
    const disableToggles = [];
    const generationIds = new WeakMap();
    let nextGeneration = 0;
    const disableSnapshot = () => ({
      at: Date.now(),
      enabled,
      toggles: disableToggles,
      windows: windows().map(candidate => {
        const generation = candidate.zenExtendedTabShortcuts;
        if (generation && !generationIds.has(generation)) {
          generationIds.set(generation, ++nextGeneration);
        }
        return {
          live: generation?.isLive?.() === true,
          generation: generation ? generationIds.get(generation) : null,
          stopReason: generation?.stopReason ?? null,
        };
      }),
    });
    try {
      sineManager = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/manager.sys.mjs"
      ).default;
      sineUtils = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/utils.sys.mjs"
      ).default;
      await waitFor("primary Sine interface", () =>
        typeof window.addUnloadListener === "function" && window.gBrowser
      );
      report.platform = {
        buildId: Services.appinfo.appBuildID,
        geckoVersion: Services.appinfo.platformVersion,
        sineVersion: options.sineVersion,
        zenVersion: Services.appinfo.version,
      };
      check(
        "exact stamped platform is running",
        Services.appinfo.version === options.zenVersion &&
          Services.appinfo.appBuildID === options.buildId &&
          Services.appinfo.platformVersion === options.geckoVersion,
        JSON.stringify(report.platform),
      );
      check(
        "manifest declares unload support",
        options.supportsUnload === true,
        "supportsUnload=" + String(options.supportsUnload),
      );

      const initialMods = await sineUtils.getMods();
      const initialNative = await ownedCustomKeys();
      check(
        "production mod starts disabled",
        initialMods[options.modId]?.enabled === false &&
          window.zenExtendedTabShortcuts === undefined &&
          hasNoCommands(window) &&
          hasNoKeys(window) &&
          hasNoOwnedSurface(window) &&
          Object.keys(initialNative).length === 0,
        JSON.stringify({
          commands: OWNED_COMMAND_IDS.filter(id => command(window, id)).length,
          enabled: initialMods[options.modId]?.enabled,
          native: initialNative,
          surface: hasOwnedSurface(window),
        }),
      );

      // Legacy fixtures for the approved D02 precedence: a legacy file entry that must be
      // carried, a preference backup that must be carried, a legacy entry equal to the
      // current default, the previous Pop Out default, and one current native
      // customization that must win over a conflicting legacy entry.
      await IOUtils.writeJSON(
        PathUtils.join(PathUtils.profileDir, LEGACY_SHORTCUT_FILE),
        {
          shortcuts: [
            {
              action: COMMANDS.next,
              disabled: false,
              group: "zen-other",
              id: SHORTCUTS.nextVim,
              internal: false,
              l10nId: null,
              reserved: true,
              ...legacyBinding("u", "control,meta"),
            },
            {
              action: COMMANDS.clear,
              disabled: false,
              group: "zen-other",
              id: SHORTCUTS.clear,
              internal: false,
              l10nId: null,
              reserved: true,
              ...legacyBinding("l", "control,alt"),
            },
            {
              action: COMMANDS.moveToFolder,
              disabled: false,
              group: "zen-other",
              id: SHORTCUTS.moveToFolder,
              internal: false,
              l10nId: null,
              reserved: true,
              ...legacyBinding("m", "control,meta"),
            },
            {
              action: "zenToggleSidebar",
              disabled: false,
              group: "zen-other",
              id: "zen-toggle-sidebar",
              internal: false,
              l10nId: null,
              reserved: true,
              ...legacyBinding("q", "control,alt"),
            },
          ],
        }
      );
      Services.prefs.setStringPref(
        BINDING_PREFERENCE_PREFIX + SHORTCUTS.previousVim,
        JSON.stringify(legacyBinding("i", "control,alt"))
      );
      Services.prefs.setStringPref(
        LEGACY_POP_OUT_BINDING_PREFERENCE,
        JSON.stringify(legacyBinding("n", "control,meta"))
      );
      customKeys().changeKey(SHORTCUTS.clear, {
        key: "K",
        modifiers: "alt,control",
      });
      await wait(100);

      await sineManager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = true;
      await waitFor("registered tab actions", () =>
        window.zenExtendedTabShortcuts?.isLive?.() === true &&
          hasAllCommands(window) && hasAllKeys(window) &&
          hasOwnedSurface(window) && ownedKeysetCount(window) === 1
      );
      await waitFor("migrated native bindings", async () => {
        const native = await ownedCustomKeys();
        return native[SHORTCUTS.nextVim]?.key === "u" &&
          native[SHORTCUTS.previousVim]?.key === "i" &&
          native[SHORTCUTS.clear]?.key === "K" &&
          !(SHORTCUTS.popOut in native) &&
          !(SHORTCUTS.moveToFolder in native);
      });
      const initialCommand = command(window);
      const defaultKeyAttributes = {
        [SHORTCUTS.nextArrow]: { keycode: "VK_DOWN", modifiers: "control,meta" },
        [SHORTCUTS.previousArrow]: { keycode: "VK_UP", modifiers: "control,meta" },
        [SHORTCUTS.popOut]: { key: "o", modifiers: "control,meta" },
        [SHORTCUTS.moveNextVim]: { key: "n", modifiers: "control,meta" },
        [SHORTCUTS.moveNextArrow]: {
          keycode: "VK_RIGHT",
          modifiers: "control,meta,shift",
        },
        [SHORTCUTS.movePreviousVim]: { key: "p", modifiers: "control,meta" },
        [SHORTCUTS.movePreviousArrow]: {
          keycode: "VK_LEFT",
          modifiers: "control,meta,shift",
        },
        [SHORTCUTS.moveToFolder]: { key: "m", modifiers: "control,meta" },
      };
      check(
        "enable registers every editable action",
        OWNED_COMMAND_IDS.every(id => commandCount(window, id) === 1) &&
          OWNED_SHORTCUT_IDS.every(id => key(window, id)?.tagName === "key") &&
          ownedKeyset(window)?.parentElement === window.document.body &&
          ownedKeysetCount(window) === 1 &&
          ownedKeyCount(window) === 11 &&
          Object.entries(defaultKeyAttributes).every(([id, expected]) =>
            Object.entries(expected).every(
              ([name, value]) => key(window, id)?.getAttribute(name) === value
            )
          ) &&
          OWNED_SHORTCUT_IDS.every(
            id => keyAttributes(window, id)?.command === COMMAND_FOR_SHORTCUT[id]
          ) &&
          folderPanel(window),
        JSON.stringify({
          commands: OWNED_COMMAND_IDS.map(id => commandCount(window, id)),
          defaults: Object.fromEntries(
            Object.keys(defaultKeyAttributes).map(id => [
              id,
              keyAttributes(window, id),
            ])
          ),
          keysetCount: ownedKeysetCount(window),
        }),
      );

      const menuNode = ownedMenu(window);
      const menuItems = menuNode ? [...menuNode.querySelectorAll("menuitem")] : [];
      const toolsPopup = window.document.getElementById("menu_ToolsPopup");
      check(
        "Tools menu exposes the approved shortcut submenu",
        menuNode?.parentElement === toolsPopup &&
          menuNode?.getAttribute("label") === MENU_LABEL &&
          menuNode?.closest("#main-menubar") ===
            window.document.getElementById("main-menubar") &&
          window.document.getElementById(MENU_IDS.separator)?.parentElement ===
            toolsPopup &&
          toolsPopup?.children[toolsPopup.children.length - 1]?.id ===
            MENU_IDS.menu &&
          toolsPopup?.children[toolsPopup.children.length - 2]?.id ===
            MENU_IDS.separator &&
          window.document.getElementById(MENU_IDS.popup)?.parentElement ===
            menuNode &&
          menuItems.length === 11 &&
          menuItems.every(item => !item.hidden && !item.disabled) &&
          JSON.stringify(
            menuItems.map(item => [
              item.getAttribute("key"),
              item.label,
              item.getAttribute("command"),
            ])
          ) ===
            JSON.stringify(
              MENU_ORDER.map(([id, label]) => [
                id,
                label,
                COMMAND_FOR_SHORTCUT[id],
              ])
            ) &&
          menuItems.every(
            item =>
              window.document.getElementById(item.getAttribute("key"))
                ?.tagName === "key"
          ),
        JSON.stringify({
          items: menuItems.map(item => ({
            command: item.getAttribute("command"),
            id: item.getAttribute("key"),
            label: item.label,
          })),
          label: menuNode?.getAttribute("label"),
          placement: menuNode?.parentElement?.id,
        }),
      );

      const migratedNative = await ownedCustomKeys();
      check(
        "legacy bindings migrate into native storage with current bindings winning",
        migratedNative[SHORTCUTS.nextVim]?.key === "u" &&
          migratedNative[SHORTCUTS.nextVim]?.modifiers === "control,meta" &&
          migratedNative[SHORTCUTS.previousVim]?.key === "i" &&
          migratedNative[SHORTCUTS.previousVim]?.modifiers === "alt,control" &&
          migratedNative[SHORTCUTS.clear]?.key === "K" &&
          migratedNative[SHORTCUTS.clear]?.modifiers === "alt,control" &&
          !(SHORTCUTS.popOut in migratedNative) &&
          !(SHORTCUTS.moveToFolder in migratedNative) &&
          !("zen-toggle-sidebar" in migratedNative) &&
          keyAttributes(window, SHORTCUTS.nextVim)?.key === "u" &&
          keyAttributes(window, SHORTCUTS.previousVim)?.key === "i" &&
          keyAttributes(window, SHORTCUTS.clear)?.key === "K" &&
          keyAttributes(window, SHORTCUTS.popOut)?.key === "o" &&
          keyAttributes(window, SHORTCUTS.moveToFolder)?.key === "m" &&
          Services.prefs.getStringPref(MIGRATION_PREFERENCE, "") === "1" &&
          Services.prefs.getStringPref(
            BINDING_PREFERENCE_PREFIX + SHORTCUTS.previousVim,
            "cleared"
          ) === "cleared" &&
          Services.prefs.getStringPref(
            LEGACY_POP_OUT_BINDING_PREFERENCE,
            "cleared"
          ) === "cleared",
        JSON.stringify({
          keys: {
            clear: keyAttributes(window, SHORTCUTS.clear),
            nextVim: keyAttributes(window, SHORTCUTS.nextVim),
            popOut: keyAttributes(window, SHORTCUTS.popOut),
            previousVim: keyAttributes(window, SHORTCUTS.previousVim),
          },
          migratedNative,
          migration: Services.prefs.getStringPref(MIGRATION_PREFERENCE, ""),
        }),
      );

      customKeys().changeKey(SHORTCUTS.popOut, {
        key: "P",
        modifiers: "control,shift",
      });
      await waitFor("native rebind", async () => {
        const native = await ownedCustomKeys();
        return (
          keyAttributes(window, SHORTCUTS.popOut)?.key === "P" &&
          native[SHORTCUTS.popOut]?.key === "P"
        );
      });
      const reboundNative = await ownedCustomKeys();
      const reboundDefault = customKeys().getDefaultKey(SHORTCUTS.popOut);
      check(
        "native rebind persists and reapplies",
        keyAttributes(window, SHORTCUTS.popOut)?.key === "P" &&
          keyAttributes(window, SHORTCUTS.popOut)?.modifiers === "control,shift" &&
          reboundNative[SHORTCUTS.popOut]?.key === "P" &&
          reboundNative[SHORTCUTS.popOut]?.modifiers === "control,shift" &&
          reboundDefault?.key === "o" &&
          reboundDefault?.modifiers === "control,meta",
        JSON.stringify({
          key: keyAttributes(window, SHORTCUTS.popOut),
          reboundDefault,
          reboundNative: reboundNative[SHORTCUTS.popOut],
        }),
      );

      customKeys().clearKey(SHORTCUTS.movePreviousArrow);
      await waitFor("cleared native binding", async () => {
        const native = await ownedCustomKeys();
        return (
          Object.hasOwn(native, SHORTCUTS.movePreviousArrow) &&
          !keyAttributes(window, SHORTCUTS.movePreviousArrow)?.key &&
          !keyAttributes(window, SHORTCUTS.movePreviousArrow)?.keycode
        );
      });

      const startingWindows = windows();
      const principal = Services.scriptSecurityManager.getSystemPrincipal();
      const testUrls = ["a", "b", "c", "d"].map(
        suffix => "https://extended-tab-shortcuts.invalid/" + suffix
      );
      for (const url of testUrls) {
        testTabs.push(gBrowser.addTab(url, {
          skipAnimation: true,
          triggeringPrincipal: principal,
        }));
      }
      await waitFor("selection test tabs", () =>
        testTabs.every((tab, index) =>
          tab.linkedBrowser.currentURI.spec === testUrls[index]
        )
      );
      const orderedTestTabs = gBrowser.visibleTabs.filter(tab => testTabs.includes(tab));
      if (orderedTestTabs.length !== 4) {
        throw new Error("selection test tabs are not all visible");
      }
      const orderedTestUrls = orderedTestTabs.map(
        tab => tab.linkedBrowser.currentURI.spec
      );
      const [beforeUrl, anchorUrl, nextUrl, lastUrl] = orderedTestUrls;
      const pinnedBoundaryTab = gBrowser.addTab(
        "https://extended-tab-shortcuts.invalid/pinned",
        { skipAnimation: true, triggeringPrincipal: principal }
      );
      testTabs.push(pinnedBoundaryTab);
      gBrowser.pinTab(pinnedBoundaryTab);
      await waitFor("pinned boundary tab", () =>
        pinnedBoundaryTab.pinned &&
          pinnedBoundaryTab.linkedBrowser.currentURI.spec ===
            "https://extended-tab-shortcuts.invalid/pinned"
      );
      gBrowser.selectedTab = orderedTestTabs[0];
      gBrowser.clearMultiSelectedTabs();
      key(window, SHORTCUTS.previousVim).doCommand();
      await wait(0);
      const ordinaryBoundaryHeld =
        gBrowser.selectedTab === orderedTestTabs[0] &&
        gBrowser.multiSelectedTabsCount === 0 &&
        !pinnedBoundaryTab.multiselected;
      gBrowser.selectedTab = pinnedBoundaryTab;
      gBrowser.clearMultiSelectedTabs();
      key(window, SHORTCUTS.nextVim).doCommand();
      await wait(0);
      const pinnedBoundaryHeld =
        gBrowser.selectedTab === pinnedBoundaryTab &&
        gBrowser.multiSelectedTabsCount === 0 &&
        !orderedTestTabs[0].multiselected;
      check(
        "keyboard selection does not cross the pinned boundary",
        ordinaryBoundaryHeld && pinnedBoundaryHeld,
        JSON.stringify({ ordinaryBoundaryHeld, pinnedBoundaryHeld }),
      );
      testTab = orderedTestTabs[1];
      gBrowser.selectedTab = testTab;
      gBrowser.clearMultiSelectedTabs();
      const selectedTestUrls = () =>
        gBrowser.selectedTabs
          .map(tab => tab.linkedBrowser.currentURI.spec)
          .filter(url => testUrls.includes(url));
      const selectionMatches = expected => {
        const selected = selectedTestUrls();
        return JSON.stringify(selected) === JSON.stringify(expected) &&
          (expected.length > 1 || gBrowser.multiSelectedTabsCount === 0);
      };
      const runSelectionCommand = async (shortcutId, expected) => {
        key(window, shortcutId).doCommand();
        await waitFor("selection " + expected.join(","), () =>
          selectionMatches(expected)
        , 5000);
        return selectedTestUrls();
      };
      const selectionStates = [];
      selectionStates.push(
        await runSelectionCommand(SHORTCUTS.nextVim, [anchorUrl, nextUrl])
      );
      selectionStates.push(
        await runSelectionCommand(SHORTCUTS.nextArrow, [anchorUrl, nextUrl, lastUrl])
      );
      selectionStates.push(
        await runSelectionCommand(SHORTCUTS.previousVim, [anchorUrl, nextUrl])
      );
      selectionStates.push(
        await runSelectionCommand(SHORTCUTS.previousArrow, [anchorUrl])
      );
      selectionStates.push(
        await runSelectionCommand(SHORTCUTS.previousVim, [beforeUrl, anchorUrl])
      );
      selectionStates.push(
        await runSelectionCommand(SHORTCUTS.clear, [anchorUrl])
      );
      const expectedSelectionStates = [
        [anchorUrl, nextUrl],
        [anchorUrl, nextUrl, lastUrl],
        [anchorUrl, nextUrl],
        [anchorUrl],
        [beforeUrl, anchorUrl],
        [anchorUrl],
      ];
      check(
        "selection commands grow, reverse, cross the anchor, and clear",
        JSON.stringify(selectionStates) === JSON.stringify(expectedSelectionStates),
        JSON.stringify({ expectedSelectionStates, selectionStates }),
      );

      gBrowser.addToMultiSelectedTabs(orderedTestTabs[0]);
      gBrowser.addToMultiSelectedTabs(orderedTestTabs[2]);
      await waitFor("contiguous mouse selection", () =>
        selectionMatches([beforeUrl, anchorUrl, nextUrl])
      );
      const continuedMouseSelection = await runSelectionCommand(
        SHORTCUTS.nextVim,
        [beforeUrl, anchorUrl, nextUrl, lastUrl]
      );
      check(
        "contiguous mouse selection continues with keyboard movement",
        JSON.stringify(continuedMouseSelection) ===
          JSON.stringify([beforeUrl, anchorUrl, nextUrl, lastUrl]),
        JSON.stringify({ continuedMouseSelection }),
      );
      await runSelectionCommand(SHORTCUTS.clear, [anchorUrl]);

      gBrowser.addToMultiSelectedTabs(orderedTestTabs[0]);
      gBrowser.addToMultiSelectedTabs(orderedTestTabs[3]);
      await waitFor("non-contiguous mouse selection", () =>
        selectionMatches([beforeUrl, anchorUrl, lastUrl])
      );
      const externalResetSelection = await runSelectionCommand(
        SHORTCUTS.nextVim,
        [anchorUrl, nextUrl]
      );
      check(
        "non-contiguous mouse selection starts a new keyboard range",
        JSON.stringify(externalResetSelection) ===
          JSON.stringify([anchorUrl, nextUrl]),
        JSON.stringify({ externalResetSelection }),
      );
      await runSelectionCommand(SHORTCUTS.clear, [anchorUrl]);

      const overflowSelectionUrls = Array.from(
        { length: 40 },
        (_, index) =>
          "https://extended-tab-shortcuts.invalid/selection-overflow-" + String(index)
      );
      const overflowSelectionTabs = overflowSelectionUrls.map(url => {
        const tab = gBrowser.addTab(url, {
          skipAnimation: true,
          triggeringPrincipal: principal,
        });
        testTabs.push(tab);
        return tab;
      });
      await waitFor("overflow selection tabs", () =>
        overflowSelectionTabs.every((tab, index) =>
          tab.linkedBrowser.currentURI.spec === overflowSelectionUrls[index]
        )
      );
      const orderedOverflowSelectionTabs = gBrowser.visibleTabs.filter(tab =>
        overflowSelectionTabs.includes(tab)
      );
      if (orderedOverflowSelectionTabs.length !== overflowSelectionTabs.length) {
        throw new Error("overflow selection tabs are not all visible");
      }
      const overflowSelectionAnchor = orderedOverflowSelectionTabs[0];
      const overflowSelectionEdge = orderedOverflowSelectionTabs.at(-1);
      if (!overflowSelectionAnchor || !overflowSelectionEdge) {
        throw new Error("missing overflow selection edge tabs");
      }
      const selectionEdgeIsVisible = tab => {
        const scrollbox = gBrowser.tabContainer.arrowScrollbox;
        const viewport = scrollbox.scrollbox ?? scrollbox;
        const viewportRect = viewport.getBoundingClientRect();
        const tabRect = tab.getBoundingClientRect();
        return scrollbox.overflowing &&
          tabRect.height > 0 &&
          tabRect.top >= viewportRect.top - 1 &&
          tabRect.bottom <= viewportRect.bottom + 1;
      };
      gBrowser.selectedTab = overflowSelectionAnchor;
      gBrowser.clearMultiSelectedTabs();
      overflowSelectionAnchor.scrollIntoView({
        behavior: "instant",
        block: "center",
      });
      await waitFor("overflow selection anchor visibility", () =>
        selectionEdgeIsVisible(overflowSelectionAnchor)
      );
      const overflowEdgeStartedHidden = !selectionEdgeIsVisible(overflowSelectionEdge);
      for (let index = 1; index < orderedOverflowSelectionTabs.length; index += 1) {
        key(window, SHORTCUTS.nextVim).doCommand();
      }
      const lowerEdgeVisibility = await waitFor(
        "lower overflow selection edge visibility",
        () =>
          selectionEdgeIsVisible(overflowSelectionEdge) &&
          orderedOverflowSelectionTabs.every(tab =>
            gBrowser.selectedTabs.includes(tab)
          ),
        5000
      );
      for (
        let index = orderedOverflowSelectionTabs.length - 2;
        index >= 0;
        index -= 1
      ) {
        key(window, SHORTCUTS.previousArrow).doCommand();
      }
      const upperEdgeVisibility = await waitFor(
        "upper overflow selection edge visibility",
        () =>
          selectionEdgeIsVisible(overflowSelectionAnchor) &&
          gBrowser.multiSelectedTabsCount === 0,
        5000
      );
      check(
        "keyboard selection reveals an overflowing range edge",
        overflowEdgeStartedHidden &&
          Boolean(lowerEdgeVisibility) &&
          Boolean(upperEdgeVisibility) &&
          gBrowser.selectedTab === overflowSelectionAnchor &&
          gBrowser.multiSelectedTabsCount === 0,
        JSON.stringify({
          activePreserved: gBrowser.selectedTab === overflowSelectionAnchor,
          lowerEdgeVisible: Boolean(lowerEdgeVisibility),
          overflowEdgeStartedHidden,
          upperEdgeVisible: Boolean(upperEdgeVisibility),
        }),
      );
      gBrowser.selectedTab = testTab;
      gBrowser.clearMultiSelectedTabs();
      for (const overflowSelectionTab of overflowSelectionTabs) {
        gBrowser.removeTab(overflowSelectionTab, { animate: false });
      }
      await waitFor("overflow selection cleanup", () =>
        overflowSelectionTabs.every(tab => !gBrowser.tabs.includes(tab))
      );

      gBrowser.unpinTab(pinnedBoundaryTab);
      gBrowser.removeTab(pinnedBoundaryTab, { animate: false });
      await waitFor("pinned fixture cleanup", () =>
        !gBrowser.tabs.includes(pinnedBoundaryTab)
      );
      const activeWorkspaceId = gZenWorkspaces.activeWorkspace;
      const popOutTestTabs = gBrowser.tabs.filter(
        tab =>
          orderedTestTabs.includes(tab) &&
          tab.getAttribute("zen-workspace-id") === activeWorkspaceId
      );
      const popOutTestUrls = popOutTestTabs.map(
        tab => tab.linkedBrowser.currentURI.spec
      );
      for (const candidateTab of [...gBrowser.tabs]) {
        if (
          !candidateTab.pinned &&
          !popOutTestTabs.includes(candidateTab) &&
          candidateTab.getAttribute("zen-workspace-id") === activeWorkspaceId
        ) {
          gBrowser.removeTab(candidateTab, { animate: false });
        }
      }
      gBrowser.selectedTab = testTab;
      gBrowser.clearMultiSelectedTabs();
      for (const selectedTab of popOutTestTabs) {
        gBrowser.addToMultiSelectedTabs(selectedTab);
      }
      const tabSnapshot = candidate => (candidate?.gBrowser?.tabs ?? []).map(tab => ({
        url: tab.linkedBrowser?.currentURI?.spec ?? "<detached>",
        selected: candidate.gBrowser.selectedTab === tab,
        multiselected: tab.multiselected === true || tab.hasAttribute("multiselected"),
        placeholder: tab.hasAttribute("zen-empty-tab"),
      }));
      const observeStartup = candidate => {
        const milestone = popOutWatches.get(candidate);
        const initialized = candidate.gZenStartup?.promiseInitialized;
        if (!milestone || !initialized || milestone.promiseObservedAt) return;
        milestone.promiseObservedAt = Date.now();
        initialized.then(
          () => { milestone.promiseSettled = "fulfilled"; milestone.promiseSettledAt = Date.now(); },
          () => { milestone.promiseSettled = "rejected"; milestone.promiseSettledAt = Date.now(); },
        );
      };
      // browser/omni.ja browser-init.js:364-367 emits the bubbling adoption event;
      // ZenStartup.mjs:25-26,95-112 exposes and settles promiseInitialized.
      // Observe before dispatch, without wrapping or changing the production methods.
      popOutObserver = candidate => {
        if (popOutWatches.has(candidate) || popOutWatches.size >= 3) return;
        const milestone = {
          openedAt: Date.now(), adoptionAt: null, promiseObservedAt: null,
          promiseSettled: "pending", promiseSettledAt: null,
        };
        const adoption = () => {
          milestone.adoptionAt = Date.now();
          observeStartup(candidate);
        };
        popOutWatches.set(candidate, milestone);
        milestone.adoption = adoption;
        candidate.addEventListener("before-initial-tab-adopted", adoption, { once: true });
        observeStartup(candidate);
      };
      const popOutSnapshot = () => {
        const destination = openedWindow ?? [...popOutWatches.keys()][0];
        return {
          at: Date.now(), stage: report.currentWait,
          startup: destination ? {
            ...popOutWatches.get(destination),
            promiseAvailable: Boolean(destination.gZenStartup?.promiseInitialized),
          } : null,
          windowCount: windows().length,
          expectedUrls: popOutTestUrls,
          expectedSourceUrls: ["about:newtab"],
          destination: tabSnapshot(destination),
          source: tabSnapshot(window),
          focused: destination && Services.focus.activeWindow === destination,
          markedUnsynced: destination?.document.documentElement.hasAttribute("zen-unsynced-window"),
        };
      };
      failureState = popOutSnapshot;
      await waitFor("complete pop-out selection", () =>
        JSON.stringify(selectedTestUrls()) === JSON.stringify(popOutTestUrls)
      , 30000, popOutSnapshot);
      Services.prefs.setBoolPref("zen.tabs.dnd-open-blank-window", false);
      Services.obs.addObserver(popOutObserver, "domwindowopened");
      observingPopOut = true;
      key(window).doCommand();
      for (const candidate of windows()) {
        if (!startingWindows.includes(candidate)) popOutObserver(candidate);
      }
      openedWindow = await waitFor("new browser window", () =>
        windows().find(
          candidate =>
            !startingWindows.includes(candidate) &&
            candidate.gZenStartup?.promiseInitialized
        )
      , 30000, popOutSnapshot);
      observeStartup(openedWindow);
      const readPopOutAdoption = () => {
        const movedUrls = openedWindow.gBrowser.tabs
          .filter(tab => !tab.hasAttribute("zen-empty-tab"))
          .map(tab => tab.linkedBrowser.currentURI.spec);
        const movedSelectedUrls = openedWindow.gBrowser.selectedTabs
          .map(tab => tab.linkedBrowser.currentURI.spec);
        const sourceUrls = gBrowser.tabs
          .filter(
            tab =>
              !tab.pinned &&
              !tab.hasAttribute("zen-empty-tab") &&
              tab.getAttribute("zen-workspace-id") === activeWorkspaceId
          )
          .map(tab => tab.linkedBrowser.currentURI.spec);
        return JSON.stringify(movedUrls) === JSON.stringify(popOutTestUrls) &&
          JSON.stringify(movedSelectedUrls) === JSON.stringify(popOutTestUrls) &&
          JSON.stringify(sourceUrls) === JSON.stringify(["about:newtab"]) &&
          openedWindow.document.documentElement.hasAttribute("zen-unsynced-window") &&
          Services.focus.activeWindow === openedWindow;
      };
      await waitFor("completed pop-out adoption", readPopOutAdoption, 5000, popOutSnapshot);
      failureState = null;
      const destinationUrls = openedWindow.gBrowser.tabs
        .filter(tab => !tab.hasAttribute("zen-empty-tab"))
        .map(tab => tab.linkedBrowser.currentURI.spec);
      const destinationSelectedUrls = openedWindow.gBrowser.selectedTabs
        .map(tab => tab.linkedBrowser.currentURI.spec);
      const sourceCurrentTabs = gBrowser.tabs.filter(tab =>
        !tab.pinned &&
          !tab.hasAttribute("zen-empty-tab") &&
          tab.getAttribute("zen-workspace-id") === activeWorkspaceId
      );
      const sourceCurrentUrls = sourceCurrentTabs.map(
        tab => tab.linkedBrowser?.currentURI?.spec ?? "<detached>"
      );
      check(
        "toggle creates one isolated window",
        windows().length === startingWindows.length + 1 &&
          popOutTestTabs.every(tab => !gBrowser.tabs.includes(tab)) &&
          JSON.stringify(destinationUrls) === JSON.stringify(popOutTestUrls) &&
          JSON.stringify(destinationSelectedUrls) ===
            JSON.stringify(popOutTestUrls) &&
          openedWindow.gBrowser.selectedTab.linkedBrowser.currentURI.spec ===
            anchorUrl &&
          sourceCurrentTabs.length === 1 &&
          sourceCurrentUrls[0] === "about:newtab" &&
          !openedWindow.gZenWindowSync &&
          openedWindow.document.documentElement.hasAttribute("zen-unsynced-window") &&
          !PrivateBrowsingUtils.isWindowPrivate(openedWindow) &&
          Services.focus.activeWindow === openedWindow,
        JSON.stringify({
          destinationActive:
            openedWindow.gBrowser.selectedTab.linkedBrowser.currentURI.spec,
          destinationSelectedUrls,
          destinationUrls,
          focused: Services.focus.activeWindow === openedWindow,
          markedUnsynced:
            openedWindow.document.documentElement.hasAttribute("zen-unsynced-window"),
          privateWindow: PrivateBrowsingUtils.isWindowPrivate(openedWindow),
          sourceCurrentUrls,
          synced: Boolean(openedWindow.gZenWindowSync),
          windowDelta: windows().length - startingWindows.length,
        }),
      );

      for (const candidateWindow of windows()) {
        for (const sentinelTab of [...candidateWindow.gBrowser.tabs]) {
          if (!sentinelTab.linkedBrowser) {
            sentinelTab.remove();
          }
        }
        candidateWindow.gBrowser.tabContainer._invalidateCachedTabs();
      }

      await waitFor("new-window tab commands", () =>
        hasAllCommands(openedWindow) &&
          hasAllKeys(openedWindow) &&
          hasOwnedSurface(openedWindow)
      );
      const initialOpenedCommand = command(openedWindow);
      check(
        "new window receives every registered action",
        OWNED_COMMAND_IDS.every(id => commandCount(openedWindow, id) === 1) &&
          key(openedWindow)?.getAttribute("key") === "P" &&
          key(openedWindow)?.getAttribute("modifiers") === "control,shift" &&
          key(openedWindow)?.getAttribute("command") === COMMANDS.popOut &&
          key(openedWindow, SHORTCUTS.nextVim)?.getAttribute("key") === "u" &&
          key(openedWindow, SHORTCUTS.nextArrow)?.getAttribute("keycode") ===
            "VK_DOWN" &&
          ownedKeysetCount(openedWindow) === 1 &&
          ownedMenu(openedWindow)?.parentElement ===
            openedWindow.document.getElementById("menu_ToolsPopup"),
        JSON.stringify({
          commands: OWNED_COMMAND_IDS.map(id => commandCount(openedWindow, id)),
          key: key(openedWindow)?.getAttribute("key"),
          keyCommand: key(openedWindow)?.getAttribute("command"),
          keysetCount: ownedKeysetCount(openedWindow),
          menu: ownedMenu(openedWindow)?.getAttribute("label"),
        }),
      );

      const reuseTestUrls = ["reuse-a", "reuse-b"].map(
        suffix => "https://extended-tab-shortcuts.invalid/" + suffix
      );
      const reuseSourceTabs = reuseTestUrls.map(url =>
        gBrowser.addTab(url, {
          skipAnimation: true,
          triggeringPrincipal: principal,
        })
      );
      await waitFor("isolated reuse source tabs", () =>
        reuseSourceTabs.every((tab, index) =>
          tab.linkedBrowser.currentURI.spec === reuseTestUrls[index]
        )
      );
      const orderedReuseTabs = gBrowser.tabs.filter(tab =>
        reuseSourceTabs.includes(tab)
      );
      const orderedReuseUrls = orderedReuseTabs.map(
        tab => tab.linkedBrowser.currentURI.spec
      );
      const reuseActiveTab = orderedReuseTabs[1];
      if (!reuseActiveTab) throw new Error("missing isolated reuse active tab");
      gBrowser.selectedTab = reuseActiveTab;
      gBrowser.clearMultiSelectedTabs();
      for (const tab of orderedReuseTabs) gBrowser.addToMultiSelectedTabs(tab);
      const windowCountBeforeReuse = windows().length;
      const originalReusePlacement = Services.prefs.getBoolPref(
        "zen.view.show-newtab-button-top",
        false
      );
      Services.prefs.setBoolPref("zen.view.show-newtab-button-top", true);
      key(window).doCommand();
      await waitFor("existing isolated window reuse", () => {
        const relevantUrls = openedWindow.gBrowser.tabs
          .map(tab => tab.linkedBrowser?.currentURI?.spec)
          .filter(url => popOutTestUrls.includes(url) || reuseTestUrls.includes(url));
        const selectedUrls = openedWindow.gBrowser.selectedTabs
          .map(tab => tab.linkedBrowser.currentURI.spec)
          .filter(url => reuseTestUrls.includes(url));
        return windows().length === windowCountBeforeReuse &&
          JSON.stringify(relevantUrls) ===
            JSON.stringify([...popOutTestUrls, ...orderedReuseUrls]) &&
          JSON.stringify(selectedUrls) === JSON.stringify(orderedReuseUrls) &&
          openedWindow.gBrowser.selectedTab.linkedBrowser.currentURI.spec ===
            orderedReuseUrls[1] &&
          Services.focus.activeWindow === openedWindow;
      }, 5000);
      check(
        "toggle reuses the existing isolated window",
        windows().length === windowCountBeforeReuse &&
          openedWindow.gBrowser.tabs.filter(tab =>
            reuseTestUrls.includes(tab.linkedBrowser?.currentURI?.spec)
          ).length === reuseTestUrls.length &&
          reuseSourceTabs.every(tab => !gBrowser.tabs.includes(tab)) &&
          Services.focus.activeWindow === openedWindow,
        JSON.stringify({
          destinationUrls: openedWindow.gBrowser.tabs
            .map(tab => tab.linkedBrowser?.currentURI?.spec)
            .filter(url => popOutTestUrls.includes(url) || reuseTestUrls.includes(url)),
          focused: Services.focus.activeWindow === openedWindow,
          windowCount: windows().length,
        }),
      );

      key(openedWindow).doCommand();
      await waitFor("selected merge into shared window", () => {
        const sharedReuseUrls = gBrowser.tabs
          .map(tab => tab.linkedBrowser?.currentURI?.spec)
          .filter(url => reuseTestUrls.includes(url));
        const isolatedOriginalUrls = openedWindow.gBrowser.tabs
          .map(tab => tab.linkedBrowser?.currentURI?.spec)
          .filter(url => popOutTestUrls.includes(url));
        const sharedSelectedUrls = gBrowser.selectedTabs
          .map(tab => tab.linkedBrowser.currentURI.spec)
          .filter(url => reuseTestUrls.includes(url));
        return !openedWindow.closed &&
          JSON.stringify(sharedReuseUrls) === JSON.stringify(orderedReuseUrls) &&
          JSON.stringify(isolatedOriginalUrls) === JSON.stringify(popOutTestUrls) &&
          JSON.stringify(sharedSelectedUrls) === JSON.stringify(orderedReuseUrls) &&
          gBrowser.selectedTab.linkedBrowser.currentURI.spec === orderedReuseUrls[1] &&
          gZenWorkspaces.activeWorkspace === activeWorkspaceId &&
          Services.focus.activeWindow === window;
      }, 5000);
      Services.prefs.setBoolPref(
        "zen.view.show-newtab-button-top",
        originalReusePlacement
      );
      check(
        "toggle merges only selected tabs into the shared window",
        !openedWindow.closed &&
          openedWindow.gBrowser.tabs.filter(tab =>
            popOutTestUrls.includes(tab.linkedBrowser?.currentURI?.spec)
          ).length === popOutTestUrls.length &&
          openedWindow.gBrowser.tabs.every(tab =>
            !reuseTestUrls.includes(tab.linkedBrowser?.currentURI?.spec)
          ) &&
          gBrowser.selectedTabs.filter(tab =>
            reuseTestUrls.includes(tab.linkedBrowser.currentURI.spec)
          ).length === reuseTestUrls.length &&
          Services.focus.activeWindow === window,
        JSON.stringify({
          isolatedClosed: openedWindow.closed,
          isolatedUrls: openedWindow.gBrowser.tabs
            .map(tab => tab.linkedBrowser?.currentURI?.spec)
            .filter(url => popOutTestUrls.includes(url)),
          sharedSelectedUrls: gBrowser.selectedTabs
            .map(tab => tab.linkedBrowser.currentURI.spec)
            .filter(url => reuseTestUrls.includes(url)),
        }),
      );
      for (const candidateWindow of windows()) {
        for (const browserlessTab of [...candidateWindow.gBrowser.tabs]) {
          if (!browserlessTab.linkedBrowser) browserlessTab.remove();
        }
        candidateWindow.gBrowser.tabContainer._invalidateCachedTabs();
      }

      await sineManager.rebuildMods(true, false);
      await waitFor("replacement commands", () =>
        window.zenExtendedTabShortcuts?.isLive?.() === true &&
          openedWindow.zenExtendedTabShortcuts?.isLive?.() === true &&
          command(window) && command(window) !== initialCommand &&
          command(openedWindow) && command(openedWindow) !== initialOpenedCommand
      );
      check(
        "Sine reload replaces commands without duplicating shortcuts",
        OWNED_COMMAND_IDS.every(
          id => commandCount(window, id) === 1 && commandCount(openedWindow, id) === 1
        ) &&
          ownedKeysetCount(window) === 1 &&
          ownedKeysetCount(openedWindow) === 1 &&
          ownedKeyCount(window) === 11 &&
          ownedKeyCount(openedWindow) === 11 &&
          window.document.querySelectorAll("#" + MENU_IDS.menu).length === 1 &&
          openedWindow.document.querySelectorAll("#" + MENU_IDS.menu).length === 1 &&
          keyAttributes(window, SHORTCUTS.popOut)?.key === "P" &&
          keyAttributes(openedWindow, SHORTCUTS.popOut)?.key === "P",
        JSON.stringify({
          openedCommands: OWNED_COMMAND_IDS.map(id => commandCount(openedWindow, id)),
          openedKeysets: ownedKeysetCount(openedWindow),
          sourceCommands: OWNED_COMMAND_IDS.map(id => commandCount(window, id)),
          sourceKeysets: ownedKeysetCount(window),
        }),
      );

      failureState = disableSnapshot;
      disableToggles.push({ at: Date.now(), phase: "begin", windows: disableSnapshot().windows });
      await sineManager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = false;
      disableToggles.push({ at: Date.now(), phase: "returned" });
      await waitFor("shortcut cleanup", () =>
        hasNoCommands(window) && hasNoCommands(openedWindow) &&
          hasNoKeys(window) && hasNoKeys(openedWindow) &&
          hasNoOwnedSurface(window) && hasNoOwnedSurface(openedWindow) &&
          !folderPanel(window) && !folderPanel(openedWindow) &&
          window.zenExtendedTabShortcuts === undefined &&
          openedWindow.zenExtendedTabShortcuts === undefined
      , 30000, disableSnapshot);
      failureState = null;
      const retainedNative = await ownedCustomKeys();
      check(
        "disable removes commands and editable actions",
        hasNoCommands(window) && hasNoCommands(openedWindow) &&
          hasNoKeys(window) && hasNoKeys(openedWindow) &&
          hasNoOwnedSurface(window) && hasNoOwnedSurface(openedWindow) &&
          !folderPanel(window) && !folderPanel(openedWindow) &&
          retainedNative[SHORTCUTS.popOut]?.key === "P" &&
          retainedNative[SHORTCUTS.popOut]?.modifiers === "control,shift" &&
          retainedNative[SHORTCUTS.nextVim]?.key === "u" &&
          Object.hasOwn(retainedNative, SHORTCUTS.movePreviousArrow) &&
          Object.keys(retainedNative[SHORTCUTS.movePreviousArrow] ?? {}).length === 0,
        JSON.stringify({
          openedCommands: OWNED_COMMAND_IDS.filter(id => command(openedWindow, id)),
          openedKeys: OWNED_SHORTCUT_IDS.filter(id => key(openedWindow, id)),
          retainedNative,
          sourceCommands: OWNED_COMMAND_IDS.filter(id => command(window, id)),
          sourceKeys: OWNED_SHORTCUT_IDS.filter(id => key(window, id)),
        }),
      );

      await sineManager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = true;
      await waitFor("restored shortcuts", () =>
        hasAllCommands(window) && hasAllCommands(openedWindow) &&
          hasAllKeys(window) && hasAllKeys(openedWindow) &&
          hasOwnedSurface(window) && hasOwnedSurface(openedWindow) &&
          keyAttributes(window, SHORTCUTS.popOut)?.key === "P" &&
          keyAttributes(openedWindow, SHORTCUTS.popOut)?.key === "P" &&
          keyAttributes(window, SHORTCUTS.nextVim)?.key === "u" &&
          keyAttributes(openedWindow, SHORTCUTS.nextVim)?.key === "u"
      );
      const restoredNative = await ownedCustomKeys();
      check(
        "re-enable restores user bindings",
        OWNED_COMMAND_IDS.every(
          id => commandCount(window, id) === 1 && commandCount(openedWindow, id) === 1
        ) &&
          keyAttributes(window, SHORTCUTS.popOut)?.modifiers === "control,shift" &&
          keyAttributes(openedWindow, SHORTCUTS.popOut)?.modifiers ===
            "control,shift" &&
          keyAttributes(window, SHORTCUTS.nextVim)?.key === "u" &&
          restoredNative[SHORTCUTS.popOut]?.key === "P",
        JSON.stringify({
          openedCommands: OWNED_COMMAND_IDS.map(id => commandCount(openedWindow, id)),
          restoredNative,
          sourceCommands: OWNED_COMMAND_IDS.map(id => commandCount(window, id)),
        }),
      );
      check(
        "cleared native bindings survive disable and re-enable",
        Object.hasOwn(restoredNative, SHORTCUTS.movePreviousArrow) &&
          Object.keys(restoredNative[SHORTCUTS.movePreviousArrow] ?? {}).length === 0 &&
          !keyAttributes(window, SHORTCUTS.movePreviousArrow)?.key &&
          !keyAttributes(window, SHORTCUTS.movePreviousArrow)?.keycode &&
          !keyAttributes(openedWindow, SHORTCUTS.movePreviousArrow)?.key &&
          !keyAttributes(openedWindow, SHORTCUTS.movePreviousArrow)?.keycode &&
          keyAttributes(window, SHORTCUTS.movePreviousArrow)?.command ===
            COMMANDS.movePrevious,
        JSON.stringify({
          cleared: restoredNative[SHORTCUTS.movePreviousArrow],
          opened: keyAttributes(openedWindow, SHORTCUTS.movePreviousArrow),
          source: keyAttributes(window, SHORTCUTS.movePreviousArrow),
        }),
      );

      // A foreign same-id node must reject the whole registration without being removed.
      await sineManager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = false;
      await waitFor("surface removal before foreign check", () =>
        hasNoOwnedSurface(window) && hasNoKeys(window)
      );
      const foreignKey = window.document.createXULElement("key");
      foreignKey.id = SHORTCUTS.popOut;
      foreignKey.setAttribute("key", "z");
      foreignKey.setAttribute("modifiers", "control,alt");
      window.document.body.append(foreignKey);
      let foreignEnableError = null;
      try {
        await sineManager.toggleTheme(await sineUtils.getMods(), options.modId);
      } catch (error) {
        foreignEnableError = String(error);
      }
      await wait(500);
      const foreignRejected =
        window.zenExtendedTabShortcuts === undefined &&
        hasNoOwnedSurface(window) &&
        hasNoCommands(window) &&
        foreignKey.isConnected &&
        foreignKey.getAttribute("key") === "z" &&
        foreignKey.getAttribute("modifiers") === "control,alt";
      const foreignEvidence = {
        commands: OWNED_COMMAND_IDS.filter(id => command(window, id)),
        error: foreignEnableError,
        foreign: {
          key: foreignKey.getAttribute("key"),
          modifiers: foreignKey.getAttribute("modifiers"),
        },
        live: window.zenExtendedTabShortcuts !== undefined,
        surface: hasOwnedSurface(window),
      };
      foreignKey.remove();
      check(
        "foreign same-id nodes are rejected without mutation",
        foreignRejected,
        JSON.stringify(foreignEvidence),
      );

      if ((await sineUtils.getMods())[options.modId]?.enabled) {
        await sineManager.toggleTheme(await sineUtils.getMods(), options.modId);
      }
      await sineManager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = true;
      await waitFor("restored after foreign check", () =>
        window.zenExtendedTabShortcuts?.isLive?.() === true &&
          hasAllCommands(window) && hasAllKeys(window) &&
          hasOwnedSurface(window) &&
          keyAttributes(window, SHORTCUTS.popOut)?.key === "P"
      );

      const remainingIsolatedTabs = openedWindow.gBrowser.tabs.filter(
        tab => popOutTestUrls.includes(tab.linkedBrowser?.currentURI?.spec)
      );
      const remainingActiveTab = remainingIsolatedTabs.find(
        tab => tab.linkedBrowser.currentURI.spec === anchorUrl
      );
      if (!remainingActiveTab) throw new Error("missing remaining isolated active tab");
      openedWindow.gBrowser.selectedTab = remainingActiveTab;
      openedWindow.gBrowser.clearMultiSelectedTabs();
      for (const tab of remainingIsolatedTabs) {
        openedWindow.gBrowser.addToMultiSelectedTabs(tab);
      }
      key(openedWindow).doCommand();
      await waitFor("emptied isolated window close", () => {
        const sharedOriginalUrls = gBrowser.tabs
          .map(tab => tab.linkedBrowser?.currentURI?.spec)
          .filter(url => popOutTestUrls.includes(url));
        const sharedSelectedUrls = gBrowser.selectedTabs
          .map(tab => tab.linkedBrowser.currentURI.spec)
          .filter(url => popOutTestUrls.includes(url));
        return openedWindow.closed &&
          JSON.stringify(sharedOriginalUrls) === JSON.stringify(popOutTestUrls) &&
          JSON.stringify(sharedSelectedUrls) === JSON.stringify(popOutTestUrls) &&
          gBrowser.selectedTab.linkedBrowser.currentURI.spec === anchorUrl &&
          Services.focus.activeWindow === window;
      }, 5000);
      check(
        "toggle closes an emptied isolated window",
        openedWindow.closed &&
          gBrowser.tabs.filter(tab =>
            popOutTestUrls.includes(tab.linkedBrowser?.currentURI?.spec)
          ).length === popOutTestUrls.length &&
          gBrowser.selectedTabs.filter(tab =>
            popOutTestUrls.includes(tab.linkedBrowser.currentURI.spec)
          ).length === popOutTestUrls.length &&
          Services.focus.activeWindow === window,
        JSON.stringify({
          focused: Services.focus.activeWindow === window,
          isolatedClosed: openedWindow.closed,
          sharedSelectedUrls: gBrowser.selectedTabs
            .map(tab => tab.linkedBrowser.currentURI.spec)
            .filter(url => popOutTestUrls.includes(url)),
        }),
      );
      for (const tab of [...gBrowser.tabs]) {
        const url = tab.linkedBrowser?.currentURI?.spec;
        if (popOutTestUrls.includes(url) || reuseTestUrls.includes(url)) {
          gBrowser.removeTab(tab, { animate: false });
        }
      }

      const spaceTestUrls = ["space-a", "space-b", "space-c", "space-d"].map(
        suffix => "https://extended-tab-shortcuts.invalid/" + suffix
      );
      const spaceTestTabs = [];
      for (const url of spaceTestUrls) {
        const tab = gBrowser.addTab(url, {
          skipAnimation: true,
          triggeringPrincipal: principal,
        });
        spaceTestTabs.push(tab);
        testTabs.push(tab);
      }
      await waitFor("space test tabs", () =>
        spaceTestTabs.every((tab, index) =>
          tab.linkedBrowser.currentURI.spec === spaceTestUrls[index]
        )
      );
      const orderedSpaceTabs = gBrowser.tabs.filter(tab =>
        spaceTestTabs.includes(tab)
      );
      const orderedSpaceUrls = orderedSpaceTabs.map(
        tab => tab.linkedBrowser.currentURI.spec
      );
      const spaceActiveTab = orderedSpaceTabs[1];
      if (!spaceActiveTab) throw new Error("missing active space test tab");
      const spacePinnedTab = gBrowser.addTab(
        "https://extended-tab-shortcuts.invalid/space-pinned",
        { skipAnimation: true, triggeringPrincipal: principal }
      );
      testTabs.push(spacePinnedTab);
      gBrowser.pinTab(spacePinnedTab);
      await waitFor("space pinned test tab", () =>
        spacePinnedTab.pinned &&
          spacePinnedTab.linkedBrowser.currentURI.spec ===
            "https://extended-tab-shortcuts.invalid/space-pinned"
      );
      const destinationAnchorTab = gBrowser.addTab(
        "https://extended-tab-shortcuts.invalid/space-destination-anchor",
        { skipAnimation: true, triggeringPrincipal: principal }
      );
      if (!destinationAnchorTab) {
        throw new Error("failed to create destination anchor tab");
      }
      testTabs.push(destinationAnchorTab);
      await waitFor("space destination anchor", () =>
        destinationAnchorTab.linkedBrowser.currentURI.spec ===
          "https://extended-tab-shortcuts.invalid/space-destination-anchor"
      );
      const overflowTabs = [];
      for (let index = 0; index < 40; index += 1) {
        const overflowTab = gBrowser.addTab(
          "https://extended-tab-shortcuts.invalid/space-overflow-" + String(index),
          { skipAnimation: true, triggeringPrincipal: principal }
        );
        if (!overflowTab) {
          throw new Error("failed to create overflow tab " + String(index));
        }
        overflowTabs.push(overflowTab);
        testTabs.push(overflowTab);
      }

      const originalSpaceId = gZenWorkspaces.activeWorkspace;
      const secondSpace = await gZenWorkspaces.createAndSaveWorkspace(
        "Shortcut Probe Two"
      );
      const thirdSpace = await gZenWorkspaces.createAndSaveWorkspace(
        "Shortcut Probe Three"
      );
      if (!secondSpace || !thirdSpace) {
        throw new Error("failed to create space fixtures");
      }
      const originalNewTabPlacement = Services.prefs.getBoolPref(
        "zen.view.show-newtab-button-top",
        false
      );
      Services.prefs.setBoolPref("zen.view.show-newtab-button-top", true);
      gZenWorkspaces.moveTabsToWorkspace(
        [destinationAnchorTab],
        secondSpace.uuid
      );
      for (const overflowTab of overflowTabs) {
        gZenWorkspaces.moveTabsToWorkspace([overflowTab], secondSpace.uuid);
      }
      await waitFor("space destination anchor", () =>
        destinationAnchorTab.getAttribute("zen-workspace-id") ===
          secondSpace.uuid
      );
      await gZenWorkspaces.changeWorkspaceWithID(originalSpaceId);
      const movedSpaceUrlsIn = spaceId =>
        gBrowser.tabs
          .filter(tab =>
            orderedSpaceTabs.includes(tab) &&
              tab.getAttribute("zen-workspace-id") === spaceId
          )
          .map(tab => tab.linkedBrowser.currentURI.spec);
      const selectedSpaceUrls = () =>
        gBrowser.selectedTabs
          .map(tab => tab.linkedBrowser.currentURI.spec)
          .filter(url => spaceTestUrls.includes(url));
      const waitForMovedSpaceSelection = async (name, spaceId) =>
        waitFor(name, () =>
          gZenWorkspaces.activeWorkspace === spaceId &&
            gBrowser.selectedTab === spaceActiveTab &&
            JSON.stringify(movedSpaceUrlsIn(spaceId)) ===
              JSON.stringify(orderedSpaceUrls) &&
            JSON.stringify(selectedSpaceUrls()) ===
              JSON.stringify(orderedSpaceUrls)
        , 5000);

      gBrowser.selectedTab = spaceActiveTab;
      gBrowser.clearMultiSelectedTabs();
      for (const selectedTab of orderedSpaceTabs) {
        gBrowser.addToMultiSelectedTabs(selectedTab);
      }
      await waitFor("space move multiselection", () =>
        JSON.stringify(selectedSpaceUrls()) === JSON.stringify(orderedSpaceUrls)
      );
      key(window, SHORTCUTS.moveNextVim).doCommand();
      await waitForMovedSpaceSelection(
        "next-space multiselection",
        secondSpace.uuid
      );
      const movedNext = movedSpaceUrlsIn(secondSpace.uuid);
      const destinationEndUrls = gBrowser.tabs
        .filter(tab =>
          tab === destinationAnchorTab || orderedSpaceTabs.includes(tab)
        )
        .filter(
          tab => tab.getAttribute("zen-workspace-id") === secondSpace.uuid
        )
        .map(tab => tab.linkedBrowser.currentURI.spec);
      check(
        "space moves append tabs at the destination end",
        JSON.stringify(destinationEndUrls) ===
          JSON.stringify([
            "https://extended-tab-shortcuts.invalid/space-destination-anchor",
            ...orderedSpaceUrls,
          ]),
        JSON.stringify({ destinationEndUrls }),
      );
      const activeMovedTabVisibility = await waitFor(
        "active moved tab visibility",
        () => {
          const scrollbox = gBrowser.tabContainer.arrowScrollbox;
          const viewport = scrollbox.scrollbox ?? scrollbox;
          const viewportRect = viewport.getBoundingClientRect();
          const scrollboxRect = scrollbox.getBoundingClientRect();
          const tabRect = spaceActiveTab.getBoundingClientRect();
          const visibility = {
            overflowing: scrollbox.overflowing,
            scrollboxBottom: scrollboxRect.bottom,
            scrollboxTop: scrollboxRect.top,
            tabBottom: tabRect.bottom,
            tabHeight: tabRect.height,
            tabTop: tabRect.top,
            viewportBottom: viewportRect.bottom,
            viewportTop: viewportRect.top,
          };
          report.activeMovedTabVisibility = visibility;
          return scrollbox.overflowing &&
            tabRect.height > 0 &&
            tabRect.top >= viewportRect.top - 1 &&
            tabRect.bottom <= viewportRect.bottom + 1
            ? visibility
            : null;
        },
        5000
      );
      check(
        "space moves reveal the active tab in an overflowing destination",
        Boolean(activeMovedTabVisibility),
        JSON.stringify(activeMovedTabVisibility),
      );
      key(window, SHORTCUTS.movePreviousArrow).doCommand();
      await waitForMovedSpaceSelection(
        "previous-space multiselection",
        originalSpaceId
      );
      const movedPrevious = movedSpaceUrlsIn(originalSpaceId);
      check(
        "space commands move selected tabs in both directions",
        JSON.stringify(movedNext) === JSON.stringify(orderedSpaceUrls) &&
          JSON.stringify(movedPrevious) === JSON.stringify(orderedSpaceUrls) &&
          gBrowser.selectedTab === spaceActiveTab &&
          JSON.stringify(selectedSpaceUrls()) === JSON.stringify(orderedSpaceUrls),
        JSON.stringify({ movedNext, movedPrevious, selected: selectedSpaceUrls() }),
      );

      gBrowser.clearMultiSelectedTabs();
      gBrowser.selectedTab = spacePinnedTab;
      key(window, SHORTCUTS.moveNextArrow).doCommand();
      await waitFor("next-space pinned tab", () =>
        gZenWorkspaces.activeWorkspace === secondSpace.uuid &&
          spacePinnedTab.pinned &&
          spacePinnedTab.getAttribute("zen-workspace-id") === secondSpace.uuid &&
          gBrowser.selectedTab === spacePinnedTab
      , 5000);
      const pinnedMovedNext = spacePinnedTab.pinned;
      key(window, SHORTCUTS.movePreviousVim).doCommand();
      await waitFor("previous-space pinned tab", () =>
        gZenWorkspaces.activeWorkspace === originalSpaceId &&
          spacePinnedTab.pinned &&
          spacePinnedTab.getAttribute("zen-workspace-id") === originalSpaceId &&
          gBrowser.selectedTab === spacePinnedTab
      , 5000);
      check(
        "space commands preserve pinned tabs",
        pinnedMovedNext && spacePinnedTab.pinned,
        JSON.stringify({
          activeSpace: gZenWorkspaces.activeWorkspace,
          pinned: spacePinnedTab.pinned,
          workspace: spacePinnedTab.getAttribute("zen-workspace-id"),
        }),
      );

      gBrowser.clearMultiSelectedTabs();
      gBrowser.selectedTab = spaceActiveTab;
      Services.prefs.setBoolPref("zen.workspaces.wrap-around-navigation", false);
      await waitFor("disabled space wrapping", () =>
        gZenWorkspaces.shouldWrapAroundNavigation === false
      );
      key(window, SHORTCUTS.movePreviousVim).doCommand();
      await wait(100);
      const noWrapHeld =
        gZenWorkspaces.activeWorkspace === originalSpaceId &&
        spaceActiveTab.getAttribute("zen-workspace-id") === originalSpaceId;
      Services.prefs.setBoolPref("zen.workspaces.wrap-around-navigation", true);
      await waitFor("enabled space wrapping", () =>
        gZenWorkspaces.shouldWrapAroundNavigation === true
      );
      key(window, SHORTCUTS.movePreviousVim).doCommand();
      await waitFor("wrapped previous-space tab", () =>
        gZenWorkspaces.activeWorkspace === thirdSpace.uuid &&
          spaceActiveTab.getAttribute("zen-workspace-id") === thirdSpace.uuid &&
          gBrowser.selectedTab === spaceActiveTab
      , 5000);
      const wrappedPrevious = gZenWorkspaces.activeWorkspace === thirdSpace.uuid;
      key(window, SHORTCUTS.moveNextArrow).doCommand();
      await waitFor("wrapped next-space tab", () =>
        gZenWorkspaces.activeWorkspace === originalSpaceId &&
          spaceActiveTab.getAttribute("zen-workspace-id") === originalSpaceId &&
          gBrowser.selectedTab === spaceActiveTab
      , 5000);
      check(
        "space commands honor the wrap preference",
        noWrapHeld && wrappedPrevious,
        JSON.stringify({
          activeSpace: gZenWorkspaces.activeWorkspace,
          noWrapHeld,
          wrappedPrevious,
        }),
      );

      gBrowser.unpinTab(spacePinnedTab);
      gBrowser.removeTab(spacePinnedTab, { animate: false });
      for (const tab of spaceTestTabs) {
        gBrowser.removeTab(tab, { animate: false });
      }
      for (const tab of overflowTabs) {
        gBrowser.removeTab(tab, { animate: false });
      }
      gBrowser.removeTab(destinationAnchorTab, { animate: false });
      Services.prefs.setBoolPref(
        "zen.view.show-newtab-button-top",
        originalNewTabPlacement
      );
      await gZenWorkspaces.removeWorkspace(thirdSpace.uuid);
      await gZenWorkspaces.removeWorkspace(secondSpace.uuid);
      await waitFor("space fixture cleanup", () =>
        gZenWorkspaces.activeWorkspace === originalSpaceId &&
          gZenWorkspaces.getWorkspaces().length === 1
      );
      await wait(500);
      for (const candidateWindow of windows()) {
        for (const browserlessTab of [...candidateWindow.gBrowser.tabs]) {
          if (!browserlessTab.linkedBrowser) browserlessTab.remove();
        }
        candidateWindow.gBrowser.tabContainer._invalidateCachedTabs();
      }

      const folderUrls = ["folder-anchor", "folder-a", "folder-b", "new-a", "new-b"]
        .map(suffix => "https://extended-tab-shortcuts.invalid/" + suffix);
      const folderTabs = folderUrls.map(url => {
        const tab = gBrowser.addTab(url, {
          skipAnimation: true,
          triggeringPrincipal: principal,
        });
        testTabs.push(tab);
        return tab;
      });
      await waitFor("folder fixture tabs", () =>
        folderTabs.every((tab, index) =>
          tab.linkedBrowser.currentURI.spec === folderUrls[index]
        )
      );
      const [folderAnchorTab, folderMoveA, folderMoveB, newFolderA, newFolderB] =
        folderTabs;
      const existingFolder = gZenFolders.createFolder([folderAnchorTab], {
        label: "Existing Folder",
        renameFolder: false,
      });
      const existingFolderSourceUrls = gBrowser.tabs
        .filter(tab => tab === folderMoveA || tab === folderMoveB)
        .map(tab => tab.linkedBrowser.currentURI.spec);
      const newFolderSourceUrls = gBrowser.tabs
        .filter(tab => tab === newFolderA || tab === newFolderB)
        .map(tab => tab.linkedBrowser.currentURI.spec);
      gBrowser.selectedTab = folderMoveB;
      gBrowser.clearMultiSelectedTabs();
      gBrowser.addToMultiSelectedTabs(folderMoveA);
      gBrowser.addToMultiSelectedTabs(folderMoveB);
      key(window, SHORTCUTS.moveToFolder).doCommand();
      const picker = await waitFor("folder picker", () => {
        const candidate = folderPanel(window);
        return candidate?.state === "open" ? candidate : null;
      }, 5000);
      const pickerRow = [...picker.querySelectorAll("[data-folder-id]")]
        .find(row => row.getAttribute("data-folder-id") === existingFolder.id);
      check(
        "folder picker uses native panel anatomy",
        picker.getAttribute("type") === "arrow" &&
          picker.querySelector("panelmultiview") &&
          picker.querySelector("panelview.PanelUI-subView") &&
          picker.querySelector(".panel-header") &&
          picker.querySelector(".panel-subview-body") &&
          pickerRow?.getAttribute("shortcut") === "1" &&
          picker.querySelector("#extended-tab-shortcuts-folder-panel-title")
            ?.textContent === "Move 2 Tabs to Folder",
        JSON.stringify({
          rowShortcut: pickerRow?.getAttribute("shortcut"),
          title: picker.querySelector(
            "#extended-tab-shortcuts-folder-panel-title"
          )?.textContent,
        }),
      );
      const newFolderButton = document.getElementById(
        "extended-tab-shortcuts-folder-panel-new-folder"
      );
      document.documentElement.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "KeyJ", key: "j" })
      );
      await wait(100);
      const pickerFocus = () => ({
        newFolder: Services.focus.focusedElement === newFolderButton,
        row: Services.focus.focusedElement === pickerRow,
      });
      const vimDownFocus = pickerFocus();
      document.documentElement.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "KeyK", key: "k" })
      );
      await wait(100);
      const vimUpFocus = pickerFocus();
      document.documentElement.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "ArrowDown",
          key: "ArrowDown",
        })
      );
      await wait(100);
      const arrowDownFocus = pickerFocus();
      check(
        "folder picker supports Vim and arrow navigation",
        vimDownFocus.row && vimUpFocus.newFolder && arrowDownFocus.row,
        JSON.stringify({ arrowDownFocus, vimDownFocus, vimUpFocus }),
      );
      document.documentElement.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "Digit1",
          key: "1",
        })
      );
      await waitFor("numbered folder move", () =>
        folderMoveA.group === existingFolder &&
          folderMoveB.group === existingFolder &&
          picker.state === "closed"
      , 5000);
      const existingMovedUrls = existingFolder.tabs
        .map(tab => tab.linkedBrowser?.currentURI?.spec)
        .filter(url => folderUrls.includes(url));
      const existingSelectedUrls = gBrowser.selectedTabs
        .map(tab => tab.linkedBrowser?.currentURI?.spec)
        .filter(url => folderUrls.includes(url));
      check(
        "folder picker moves a selection by number",
        JSON.stringify(existingMovedUrls) ===
          JSON.stringify([folderUrls[0], ...existingFolderSourceUrls]) &&
          JSON.stringify(existingSelectedUrls) ===
            JSON.stringify(existingFolderSourceUrls) &&
          gBrowser.selectedTab === folderMoveB &&
          existingFolder.collapsed === false,
        JSON.stringify({
          active: gBrowser.selectedTab?.linkedBrowser?.currentURI?.spec,
          collapsed: existingFolder.collapsed,
          expectedSourceUrls: existingFolderSourceUrls,
          folderUrls: existingMovedUrls,
          selectedUrls: existingSelectedUrls,
        }),
      );

      gBrowser.selectedTab = newFolderB;
      gBrowser.clearMultiSelectedTabs();
      gBrowser.addToMultiSelectedTabs(newFolderA);
      gBrowser.addToMultiSelectedTabs(newFolderB);
      key(window, SHORTCUTS.moveToFolder).doCommand();
      const newPicker = await waitFor("new-folder picker", () => {
        const candidate = folderPanel(window);
        return candidate?.state === "open" ? candidate : null;
      }, 5000);
      document.documentElement.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "KeyN",
          key: "n",
        })
      );
      const nameInput = await waitFor("new-folder name view", () => {
        const input = document.getElementById(
          "extended-tab-shortcuts-folder-panel-name"
        );
        return document
          .getElementById("extended-tab-shortcuts-folder-panel-new-view")
          ?.hasAttribute("visible") && input
          ? input
          : null;
      }, 5000);
      nameInput.value = "Created by Shortcut";
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      nameInput.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "Enter",
          key: "Enter",
        })
      );
      const createdFolder = await waitFor("named folder creation", () =>
        gBrowser.tabGroups.find(group => group.label === "Created by Shortcut")
      , 5000);
      const createdMovedUrls = createdFolder.tabs
        .map(tab => tab.linkedBrowser?.currentURI?.spec)
        .filter(url => folderUrls.includes(url));
      const createdSelectedUrls = gBrowser.selectedTabs
        .map(tab => tab.linkedBrowser?.currentURI?.spec)
        .filter(url => folderUrls.includes(url));
      check(
        "folder picker creates a named folder",
        newPicker.state === "closed" &&
          createdFolder.getAttribute("zen-workspace-id") ===
            gZenWorkspaces.activeWorkspace &&
          createdFolder.isZenFolder && !createdFolder.isLiveFolder &&
          JSON.stringify(createdMovedUrls) === JSON.stringify(newFolderSourceUrls) &&
          JSON.stringify(createdSelectedUrls) ===
            JSON.stringify(newFolderSourceUrls) &&
          gBrowser.selectedTab === newFolderB,
        JSON.stringify({
          active: gBrowser.selectedTab?.linkedBrowser?.currentURI?.spec,
          expectedSourceUrls: newFolderSourceUrls,
          folderUrls: createdMovedUrls,
          panelState: newPicker.state,
          selectedUrls: createdSelectedUrls,
          workspace: createdFolder.getAttribute("zen-workspace-id"),
        }),
      );
    } catch (error) {
      const snapshot = failureState && !String(error).includes("; snapshot:")
        ? "; snapshot: " + boundedSnapshot(failureState()) : "";
      report.fatal = String(error) + snapshot + " | " + String(error?.stack ?? "");
    } finally {
      if (observingPopOut) Services.obs.removeObserver(popOutObserver, "domwindowopened");
      for (const [candidate, milestone] of popOutWatches) {
        candidate.removeEventListener("before-initial-tab-adopted", milestone.adoption);
      }
      report.diagnostics.console = relevantConsole();
      try {
        if (enabled && !options.leaveEnabled) {
          await sineManager.toggleTheme(await sineUtils.getMods(), options.modId);
        }
      } catch (error) {
        report.disableError = String(error?.stack ?? error);
      }
      try {
        if (openedWindow && !openedWindow.closed) openedWindow.close();
      } catch (error) {
        report.closeError = String(error?.stack ?? error);
      }
      try {
        for (const candidateTab of testTabs) {
          const owner = windows().find(candidate =>
            candidate.gBrowser.tabs.includes(candidateTab)
          );
          owner?.gBrowser.removeTab(candidateTab, { animate: false });
        }
      } catch (error) {
        report.cleanupError = String(error?.stack ?? error);
      }
      done(report);
    }
  })();
`;

const OWNED_SCREEN_IDS = [
  "extended-tab-shortcuts-select-next-vim-key",
  "extended-tab-shortcuts-select-next-arrow-key",
  "extended-tab-shortcuts-select-previous-vim-key",
  "extended-tab-shortcuts-select-previous-arrow-key",
  "extended-tab-shortcuts-clear-selection-key",
  "pop-out-tab-key",
  "extended-tab-shortcuts-move-next-space-vim-key",
  "extended-tab-shortcuts-move-next-space-arrow-key",
  "extended-tab-shortcuts-move-previous-space-vim-key",
  "extended-tab-shortcuts-move-previous-space-arrow-key",
  "extended-tab-shortcuts-move-to-folder-key",
];

const OWNED_SCREEN_LABELS = [
  "Extend Tab Selection Next",
  "Extend Tab Selection Next (Alternate)",
  "Extend Tab Selection Previous",
  "Extend Tab Selection Previous (Alternate)",
  "Clear Tab Selection",
  "Pop Out / Merge Selected Tabs",
  "Move Selected Tabs to Next Space",
  "Move Selected Tabs to Next Space (Alternate)",
  "Move Selected Tabs to Previous Space",
  "Move Selected Tabs to Previous Space (Alternate)",
  "Move Selected Tabs to Folder",
];

const PREPARE_KEY_PRESS = `
  const done = arguments[arguments.length - 1];
  (async () => {
    try {
      const urls = ["key-a", "key-b"].map(
        suffix => "https://extended-tab-shortcuts.invalid/" + suffix
      );
      const principal = Services.scriptSecurityManager.getSystemPrincipal();
      const tabs = urls.map(url =>
        gBrowser.addTab(url, { skipAnimation: true, triggeringPrincipal: principal })
      );
      await new Promise(resolve => {
        const check = () => {
          if (tabs.every((tab, index) => tab.linkedBrowser?.currentURI?.spec === urls[index])) {
            return resolve();
          }
          setTimeout(check, 50);
        };
        check();
      });
      const ordered = gBrowser.visibleTabs.filter(tab => tabs.includes(tab));
      gBrowser.selectedTab = ordered[0];
      gBrowser.clearMultiSelectedTabs();
      const keyEl = document.getElementById("extended-tab-shortcuts-select-next-vim-key");
      done({
        binding: {
          key: keyEl?.getAttribute("key") ?? null,
          modifiers: keyEl?.getAttribute("modifiers") ?? null,
        },
        focused: Services.focus.activeWindow === window,
        live: window.zenExtendedTabShortcuts?.isLive?.() === true,
        ok: true,
        urls: ordered.map(tab => tab.linkedBrowser.currentURI.spec),
      });
    } catch (error) {
      done({ error: String(error) + " | " + String(error?.stack ?? "") });
    }
  })();
`;

const READ_KEY_PRESS = `
  const [urls] = arguments;
  const done = arguments[arguments.length - 1];
  try {
    const keyEl = document.getElementById("extended-tab-shortcuts-select-next-vim-key");
    done({
      binding: {
        key: keyEl?.getAttribute("key") ?? null,
        modifiers: keyEl?.getAttribute("modifiers") ?? null,
      },
      multiSelected: gBrowser.multiSelectedTabsCount,
      selection: gBrowser.selectedTabs
        .map(tab => tab.linkedBrowser?.currentURI?.spec ?? "")
        .filter(url => urls.includes(url)),
    });
  } catch (error) {
    done({ error: String(error) });
  }
`;

const READ_SHORTCUT_BINDINGS = `
  const [ids] = arguments;
  const done = arguments[arguments.length - 1];
  try {
    const { ShortcutUtils } = ChromeUtils.importESModule(
      "resource://gre/modules/ShortcutUtils.sys.mjs"
    );
    done(
      Object.fromEntries(
        ids.map(id => {
          const keyEl = document.getElementById(id);
          return [id, keyEl ? ShortcutUtils.prettifyShortcut(keyEl) : null];
        })
      )
    );
  } catch (error) {
    done({ error: String(error) });
  }
`;

const OPEN_SHORTCUT_SCREEN = `
  const done = arguments[arguments.length - 1];
  (async () => {
    try {
      for (const tab of [...gBrowser.tabs]) {
        if (tab.linkedBrowser?.currentURI?.spec === "about:keyboard") {
          gBrowser.removeTab(tab, { animate: false });
        }
      }
      const tab = gBrowser.addTab("about:keyboard", {
        skipAnimation: true,
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
      await new Promise(resolve => {
        const check = () => {
          const browser = tab.linkedBrowser;
          if (
            browser &&
            browser.currentURI.spec === "about:keyboard" &&
            !browser.webProgress?.isLoadingDocument
          ) {
            return resolve();
          }
          setTimeout(check, 50);
        };
        check();
      });
      await new Promise(resolve => setTimeout(resolve, 2000));
      done({ ok: true });
    } catch (error) {
      done({ error: String(error) + " | " + String(error?.stack ?? "") });
    }
  })();
`;

const READ_SHORTCUT_SCREEN = `
  const done = arguments[arguments.length - 1];
  try {
    const rows = [...document.querySelectorAll("moz-box-item.key")].map(row => ({
      customized: row.classList.contains("customized"),
      id: row.dataset.id,
      label: row.dataset.label,
      shortcut: row.querySelector(".currentShortcut")?.value ?? null,
    }));
    const categories = [...document.querySelectorAll("moz-card.category")].map(
      card => card.heading ?? card.getAttribute("data-l10n-id")
    );
    done({ categories, ok: true, rows, url: location.href });
  } catch (error) {
    done({ error: String(error), ok: false });
  }
`;

const CLOSE_SHORTCUT_SCREEN = `
  const done = arguments[arguments.length - 1];
  for (const tab of [...gBrowser.tabs]) {
    if (tab.linkedBrowser?.currentURI?.spec === "about:keyboard") {
      gBrowser.removeTab(tab, { animate: false });
    }
  }
  done({ ok: true });
`;

export const SET_MOD_ENABLED = `
  const boundedSnapshot = (${boundedSnapshot.toString()});
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  (async () => {
    try {
      const manager = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/manager.sys.mjs"
      ).default;
      const utils = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/utils.sys.mjs"
      ).default;
      // Sine's toggleTheme does not await removeUnloadListeners() or rebuildMods(), so a
      // rapid toggle sequence can drop the new generation's unload listener. Toggle until
      // both Sine's enabled flag and the generation liveness reach the requested state.
      // The generation identity and the mod's own console lines discriminate "the unload
      // hook never ran" from "a later import replaced the stopped generation".
      const generations = (window.__etsProbeGenerations ??= {
        ids: new WeakMap(),
        next: 0,
      });
      const generationId = () => {
        const generation = window.zenExtendedTabShortcuts;
        if (!generation) return null;
        if (!generations.ids.has(generation)) {
          generations.next += 1;
          generations.ids.set(generation, generations.next);
        }
        return generations.ids.get(generation);
      };
      const consoleTail = () => {
        try {
          return (Services.console.getMessageArray() ?? [])
            .map(message => String(message?.message ?? message))
            .filter(
              message =>
                message.includes("[extended-tab-shortcuts]") ||
                message.includes("[Sine]")
            )
            .slice(-40);
        } catch (error) {
          return ["<console unavailable: " + String(error) + ">"];
        }
      };
      let lastEnabled = null;
      let toggles = 0;
      const steps = (window.__etsProbeSteps = []);
      const generationState = () => ({
        generation: generationId(),
        live: window.zenExtendedTabShortcuts?.isLive?.() === true,
        stopReason: window.zenExtendedTabShortcuts?.stopReason ?? null,
        unloadHook: typeof window.addUnloadListener,
      });
      const snapshot = () => ({
        at: Date.now(), enabled: lastEnabled, ...generationState(), toggles,
        steps: steps.slice(-12),
      });
      const remember = () => { window.__etsProbeDisableSnapshot = snapshot(); };
      const step = name => { steps.push({ at: Date.now(), name }); remember(); };
      const readState = async () => {
        lastEnabled = Boolean((await utils.getMods())[options.modId]?.enabled);
        remember();
        return { enabled: lastEnabled, ...generationState() };
      };
      const settle = async () => {
        const deadline = Date.now() + 5000;
        let state = await readState();
        while (
          Date.now() < deadline &&
          (state.enabled !== options.enabled || state.live !== options.enabled)
        ) {
          await new Promise(resolve => setTimeout(resolve, 50));
          state = await readState();
        }
        return state;
      };
      step("start");
      const before = await readState();
      step("read-before");
      let state = before;
      while (
        toggles < 3 &&
        (state.enabled !== options.enabled || state.live !== options.enabled)
      ) {
        toggles += 1;
        step("toggle-" + String(toggles) + "-begin");
        await manager.toggleTheme(await utils.getMods(), options.modId);
        step("toggle-" + String(toggles) + "-returned");
        state = await settle();
        step("toggle-" + String(toggles) + "-settled");
      }
      const themeData = (await utils.getMods())[options.modId] ?? {};
      if (state.enabled !== options.enabled || state.live !== options.enabled) {
        throw new Error("timed out waiting for mod enable/liveness; snapshot: " + boundedSnapshot(snapshot()));
      }
      done({
        before,
        console: consoleTail(),
        enabled: state.enabled,
        live: window.zenExtendedTabShortcuts !== undefined,
        ok: true,
        state,
        steps,
        stopReason: state.stopReason,
        surface: Boolean(document.getElementById("extended-tab-shortcuts-keyset")),
        themeDataHasScripts: Object.hasOwn(themeData, "scripts"),
        toggles,
      });
    } catch (error) {
      done({ error: String(error) + " | " + String(error?.stack ?? "") });
    }
  })();
`;

const summarizeScreen = screen => ({
  categories: screen?.categories ?? null,
  error: screen?.error ?? null,
  rowCount: screen?.rows?.length ?? null,
  rows: (screen?.rows ?? []).filter(row => OWNED_SCREEN_IDS.includes(row.id)),
  url: screen?.url ?? null,
});

const readShortcutScreen = async client => {
  await client.command("Marionette:SetContext", { value: "content" });
  try {
    const handles = await client.command("WebDriver:GetWindowHandles", {});
    for (const handle of handles) {
      await client.command("WebDriver:SwitchToWindow", { handle, focus: true });
      const info = await client.executeAsync(
        "const done = arguments[arguments.length - 1]; done({ href: location.href });",
        [],
      );
      if (typeof info?.href === "string" && info.href.startsWith("about:keyboard")) {
        return await client.executeAsync(READ_SHORTCUT_SCREEN, []);
      }
    }
    throw new Error("about:keyboard was not found among the content window handles");
  } finally {
    await client.command("Marionette:SetContext", { value: "chrome" }).catch(() => {});
  }
};

/** Prove native key dispatch, native screen rows and the approved reopen refresh. */
export const runNativePhases = async (client, result, modId) => {
  const evidence = { errors: [], keyPress: null, screen: {} };
  const assertions = [];
  const push = (name, ok, detail) => {
    assertions.push({ detail: String(detail ?? ""), name, ok: Boolean(ok) });
  };
  if (!result || result.fatal) {
    evidence.errors.push("main probe did not complete");
    return { assertions, evidence };
  }

  try {
    const prepared = await client.executeAsync(PREPARE_KEY_PRESS, []);
    evidence.keyPress = { prepared };
    if (!prepared?.ok) throw new Error(JSON.stringify(prepared));
    // Synthesized chrome key events are delivered asynchronously and can be dropped by
    // the widget while the window settles, so send the real sequence and poll the result.
    const sendShortcut = async () => {
      await client.command("WebDriver:PerformActions", {
        actions: [
          {
            actions: [
              { type: "keyDown", value: "\uE009" },
              { type: "keyDown", value: "\uE03D" },
              { type: "keyDown", value: "u" },
              { type: "keyUp", value: "u" },
              { type: "keyUp", value: "\uE03D" },
              { type: "keyUp", value: "\uE009" },
            ],
            id: "keyboard",
            type: "key",
          },
        ],
      });
      await client.command("WebDriver:ReleaseActions", {});
    };
    let pressed = null;
    let attempts = 0;
    while (attempts < 3) {
      attempts += 1;
      await sendShortcut();
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        pressed = await client.executeAsync(READ_KEY_PRESS, [prepared.urls]);
        if (pressed?.multiSelected === 2) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (pressed?.multiSelected === 2) break;
    }
    evidence.keyPress.attempts = attempts;
    evidence.keyPress.result = pressed;
    push(
      "native key press runs the rebound binding",
      prepared.binding?.key === "u" &&
        prepared.binding?.modifiers === "control,meta" &&
        pressed?.binding?.key === "u" &&
        pressed?.multiSelected === 2 &&
        JSON.stringify(pressed?.selection) === JSON.stringify(prepared.urls),
      JSON.stringify({ attempts, prepared, pressed }),
    );
  } catch (error) {
    evidence.errors.push(String(error));
    push("native key press runs the rebound binding", false, String(error));
  }

  try {
    const opened = await client.executeAsync(OPEN_SHORTCUT_SCREEN, []);
    if (!opened?.ok) throw new Error(JSON.stringify(opened));
    const bindings = await client.executeAsync(READ_SHORTCUT_BINDINGS, [
      OWNED_SCREEN_IDS,
    ]);
    const screen = await readShortcutScreen(client);
    evidence.screen.enabled = { bindings, screen: summarizeScreen(screen) };
    const rows = screen.rows.filter(row => OWNED_SCREEN_IDS.includes(row.id));
    push(
      "shortcut screen lists every owned row after reopen",
      screen.categories.includes("Extended Tab Shortcuts") &&
        rows.length === 11 &&
        JSON.stringify(rows.map(row => row.id)) === JSON.stringify(OWNED_SCREEN_IDS) &&
        JSON.stringify(rows.map(row => row.label)) ===
          JSON.stringify(OWNED_SCREEN_LABELS) &&
        rows.every(row => row.shortcut === bindings[row.id]) &&
        rows
          .filter(
            row => row.id !== "extended-tab-shortcuts-move-previous-space-arrow-key",
          )
          .every(row => row.shortcut) &&
        rows.find(
          row => row.id === "extended-tab-shortcuts-move-previous-space-arrow-key",
        )?.shortcut === "" &&
        rows.find(
          row => row.id === "extended-tab-shortcuts-move-previous-space-arrow-key",
        )?.customized === true &&
        rows.find(row => row.id === "pop-out-tab-key")?.customized === true &&
        rows.find(row => row.id === "extended-tab-shortcuts-clear-selection-key")
          ?.customized === true,
      JSON.stringify({ bindings, categories: screen.categories, rows }),
    );
  } catch (error) {
    evidence.errors.push(String(error));
    push("shortcut screen lists every owned row after reopen", false, String(error));
  }

  try {
    const disabled = await client.executeAsync(SET_MOD_ENABLED, [
      { enabled: false, modId },
    ]);
    if (!disabled?.ok) throw new Error(JSON.stringify(disabled));
    const stale = await readShortcutScreen(client);
    evidence.screen.disabledStale = { disabled, screen: summarizeScreen(stale) };
    const rows = stale.rows.filter(row => OWNED_SCREEN_IDS.includes(row.id));
    push(
      "shortcut screen keeps stale rows until reopened",
      disabled.enabled === false &&
        disabled.live === false &&
        rows.length === 11 &&
        stale.categories.includes("Extended Tab Shortcuts"),
      JSON.stringify({ disabled, rows: rows.length }),
    );
  } catch (error) {
    // A Marionette timeout cannot return the browser script's error. Recover the
    // last pre-await state and read liveness now, before constructing the failure.
    let snapshot;
    try {
      snapshot = await client.executeAsync(
        `const done = arguments[arguments.length - 1];
         const generation = window.zenExtendedTabShortcuts;
         done({
           ...window.__etsProbeDisableSnapshot,
           at: Date.now(),
           live: generation?.isLive?.() === true,
           stopReason: generation?.stopReason ?? null,
           steps: (window.__etsProbeSteps ?? []).slice(-12),
         });`,
        [],
      );
      evidence.disableSteps = snapshot.steps;
    } catch (stepError) {
      snapshot = { unavailable: String(stepError) };
      evidence.disableSteps = String(stepError);
    }
    const failure = `${String(error)}; snapshot: ${boundedSnapshot(snapshot)}`;
    evidence.errors.push(failure);
    push("shortcut screen keeps stale rows until reopened", false, failure);
  }

  try {
    const opened = await client.executeAsync(OPEN_SHORTCUT_SCREEN, []);
    if (!opened?.ok) throw new Error(JSON.stringify(opened));
    const screen = await readShortcutScreen(client);
    evidence.screen.disabledReopened = summarizeScreen(screen);
    const rows = screen.rows.filter(row => OWNED_SCREEN_IDS.includes(row.id));
    push(
      "shortcut screen omits owned rows after disable and reopen",
      rows.length === 0 && !screen.categories.includes("Extended Tab Shortcuts"),
      JSON.stringify({ categories: screen.categories, rows: rows.length }),
    );
  } catch (error) {
    evidence.errors.push(String(error));
    push(
      "shortcut screen omits owned rows after disable and reopen",
      false,
      String(error),
    );
  }

  try {
    await client.executeAsync(CLOSE_SHORTCUT_SCREEN, []);
  } catch (error) {
    evidence.errors.push(String(error));
  }

  return { assertions, evidence };
};

const atomicWriteJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
};

const main = async () => {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const zen = await launchLiveZen({
    stagedMod: {
      enabled: false,
      manifest,
      relativePaths: PRODUCTION_PATHS,
      sourceDirectory: MOD_DIRECTORY,
    },
  });
  let client;
  let shutdownPromise;
  const shutdown = () => {
    shutdownPromise ??= (async () => {
      try {
        await client?.quit();
      } finally {
        await zen.stop();
      }
    })();
    return shutdownPromise;
  };
  const removeSignals = installShutdownSignals({
    label: "Extended Tab Shortcuts lifecycle",
    shutdown,
  });

  try {
    client = await openMarionette({ port: zen.port });
    await client.setScriptTimeout(120_000);
    const result = await client.executeAsync(PROBE, [
      {
        buildId: zen.platformStamp.zen.buildId,
        geckoVersion: zen.platformStamp.zen.geckoVersion,
        modId: manifest.id,
        leaveEnabled: true,
        sineVersion: zen.platformStamp.sine.version,
        supportsUnload: manifest.supportsUnload,
        zenVersion: zen.platformStamp.zen.version,
      },
    ]);
    const nativePhases = await runNativePhases(client, result, manifest.id);
    if (Array.isArray(result?.assertions)) {
      result.assertions.push(...nativePhases.assertions);
    }
    if (result) result.nativePhases = nativePhases.evidence;
    let validationError = null;
    let verdicts = null;
    try {
      verdicts = collectVerdicts(validateAssertionManifest(result, REQUIRED_ASSERTIONS));
    } catch (error) {
      validationError = String(error?.stack ?? error);
    }
    const artifact = {
      recordedAt: new Date().toISOString(),
      stagedProduction: zen.stagedMod,
      stamp: zen.platformStamp,
      marionette: client.hello,
      runner: {
        node: process.version,
        v8: process.versions.v8,
        os: { arch: arch(), platform: platform(), release: release() },
      },
      contract: { requiredAssertions: REQUIRED_ASSERTIONS },
      validation: { error: validationError, verdicts },
      result,
    };
    await atomicWriteJson(OUTPUT, artifact);
    for (const assertion of result?.assertions ?? []) {
      console.log(`  ${assertion.ok ? "PASS" : "FAIL"}  ${assertion.name}`);
      if (!assertion.ok) console.log(`        ${assertion.detail}`);
    }
    console.log(`Raw lifecycle evidence: ${OUTPUT}`);
    if (validationError) {
      console.error(validationError);
      process.exitCode = 1;
    } else {
      console.log(`${verdicts.counts.passed}/${verdicts.counts.total} assertions passed`);
      if (!verdicts.ok || result?.fatal) process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      `Extended Tab Shortcuts lifecycle probe failed: ${error.stack ?? error.message}`,
    );
    console.error(zen.output.join("").slice(-4000));
    process.exitCode = 1;
  } finally {
    try {
      await shutdown();
    } finally {
      removeSignals();
    }
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
