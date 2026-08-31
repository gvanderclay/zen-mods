#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
const PRODUCTION_PATHS = ["dist/extended-tab-shortcuts.uc.mjs"];

const REQUIRED_ASSERTIONS = [
  "exact stamped platform is running",
  "manifest declares unload support",
  "production mod starts disabled",
  "enable registers every editable action",
  "native rebind persists and rebuilds",
  "selection commands grow, reverse, cross the anchor, and clear",
  "keyboard selection does not cross the pinned boundary",
  "contiguous mouse selection continues with keyboard movement",
  "non-contiguous mouse selection starts a new keyboard range",
  "command moves selected tabs into one isolated window",
  "new window receives every registered action",
  "Sine reload replaces commands without duplicating shortcuts",
  "disable removes commands and editable actions",
  "re-enable restores user bindings",
];

const PROBE = `
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  const SHORTCUTS = {
    popOut: "pop-out-tab-key",
    nextVim: "extended-tab-shortcuts-select-next-vim-key",
    nextArrow: "extended-tab-shortcuts-select-next-arrow-key",
    previousVim: "extended-tab-shortcuts-select-previous-vim-key",
    previousArrow: "extended-tab-shortcuts-select-previous-arrow-key",
    clear: "extended-tab-shortcuts-clear-selection-key",
  };
  const COMMANDS = {
    popOut: "Pop Out Selected Tabs",
    next: "Extend Tab Selection Next",
    previous: "Extend Tab Selection Previous",
    clear: "Clear Tab Selection",
  };
  const OWNED_SHORTCUT_IDS = Object.values(SHORTCUTS);
  const OWNED_COMMAND_IDS = Object.values(COMMANDS);
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const report = { assertions: [], currentWait: null, fatal: null, platform: null };
  const check = (name, condition, detail) => {
    report.assertions.push({ name, ok: Boolean(condition), detail: String(detail ?? "") });
    return Boolean(condition);
  };
  const waitFor = async (name, read, timeout = 30000) => {
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
    throw new Error("timed out waiting for " + name + "; last value: " + String(value));
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
  const hasAllCommands = candidate =>
    OWNED_COMMAND_IDS.every(id => command(candidate, id));
  const hasAllKeys = candidate => OWNED_SHORTCUT_IDS.every(id => key(candidate, id));
  const hasNoCommands = candidate =>
    OWNED_COMMAND_IDS.every(id => command(candidate, id) === null);
  const hasNoKeys = candidate =>
    OWNED_SHORTCUT_IDS.every(id => key(candidate, id) === null);
  const savedShortcut = async manager =>
    (await manager.loader.loadObject()).shortcuts.find(
      item => item.id === SHORTCUTS.popOut
    );
  const savedOwnedShortcutCount = async manager =>
    (await manager.loader.loadObject()).shortcuts.filter(
      item => OWNED_SHORTCUT_IDS.includes(item.id)
    ).length;

  (async () => {
    let sineManager;
    let sineUtils;
    let shortcutManager;
    let enabled = false;
    let openedWindow;
    let testTab;
    const testTabs = [];
    try {
      sineManager = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/manager.sys.mjs"
      ).default;
      sineUtils = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/utils.sys.mjs"
      ).default;
      shortcutManager = gZenKeyboardShortcutsManager;
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
      check(
        "production mod starts disabled",
        initialMods[options.modId]?.enabled === false &&
          window.zenExtendedTabShortcuts === undefined &&
          hasNoCommands(window) &&
          hasNoKeys(window) &&
          (await savedOwnedShortcutCount(shortcutManager)) === 0,
        JSON.stringify({
          enabled: initialMods[options.modId]?.enabled,
          commands: OWNED_COMMAND_IDS.filter(id => command(window, id)).length,
          shortcutCount: await savedOwnedShortcutCount(shortcutManager),
        }),
      );

      const shortcutData = await shortcutManager.loader.loadObject();
      await shortcutManager.loader.save({
        ...shortcutData,
        shortcuts: [
          ...shortcutData.shortcuts,
          {
            id: SHORTCUTS.popOut,
            key: "n",
            keycode: "",
            group: "zen-other",
            l10nId: null,
            modifiers: {
              control: true,
              alt: false,
              shift: false,
              meta: true,
              accel: false,
            },
            action: "Pop Out Current Tab",
            disabled: false,
            reserved: true,
            internal: false,
          },
        ],
      });

      await sineManager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = true;
      await waitFor("registered tab actions", async () => {
        const modifiable = await shortcutManager.getModifiableShortcuts();
        return window.zenExtendedTabShortcuts?.isLive?.() === true &&
          hasAllCommands(window) && hasAllKeys(window) &&
          OWNED_SHORTCUT_IDS.every(id =>
            modifiable.find(item => item.getID() === id)
          );
      });
      const registered = new Map(
        (await shortcutManager.getModifiableShortcuts())
          .filter(item => OWNED_SHORTCUT_IDS.includes(item.getID()))
          .map(item => [item.getID(), item])
      );
      const initialCommand = command(window);
      check(
        "enable registers every editable action",
        OWNED_COMMAND_IDS.every(id => commandCount(window, id) === 1) &&
          registered.get(SHORTCUTS.popOut)?.getAction() === COMMANDS.popOut &&
          registered.get(SHORTCUTS.popOut)?.toDisplayString() === "⌃ ⌘ O" &&
          key(window)?.getAttribute("key") === "o" &&
          key(window)?.getAttribute("modifiers") === "control,meta" &&
          key(window)?.getAttribute("command") === COMMANDS.popOut &&
          key(window, SHORTCUTS.nextVim)?.getAttribute("key") === "j" &&
          key(window, SHORTCUTS.nextVim)?.getAttribute("command") === COMMANDS.next &&
          key(window, SHORTCUTS.nextArrow)?.getAttribute("keycode") === "VK_DOWN" &&
          key(window, SHORTCUTS.nextArrow)?.getAttribute("command") === COMMANDS.next &&
          key(window, SHORTCUTS.previousVim)?.getAttribute("key") === "k" &&
          key(window, SHORTCUTS.previousVim)?.getAttribute("command") ===
            COMMANDS.previous &&
          key(window, SHORTCUTS.previousArrow)?.getAttribute("keycode") === "VK_UP" &&
          key(window, SHORTCUTS.previousArrow)?.getAttribute("command") ===
            COMMANDS.previous &&
          key(window, SHORTCUTS.clear)?.getAttribute("key") ===
            String.fromCharCode(96) &&
          key(window, SHORTCUTS.clear)?.getAttribute("command") === COMMANDS.clear &&
          OWNED_SHORTCUT_IDS.every(
            id => key(window, id)?.getAttribute("modifiers") === "control,meta"
          ) &&
          (await savedOwnedShortcutCount(shortcutManager)) === 6,
        JSON.stringify({
          actions: [...registered.values()].map(item => ({
            action: item.getAction(),
            display: item.toDisplayString(),
            id: item.getID(),
          })),
          commands: OWNED_COMMAND_IDS.map(id => commandCount(window, id)),
          savedCount: await savedOwnedShortcutCount(shortcutManager),
        }),
      );

      const { nsKeyShortcutModifiers } = ChromeUtils.importESModule(
        "chrome://browser/content/zen-components/ZenKeyboardShortcuts.mjs",
        { global: "current" }
      );
      await shortcutManager.setShortcut(
        SHORTCUTS.popOut,
        "p",
        new nsKeyShortcutModifiers(true, false, true, true, false)
      );
      const persisted = await savedShortcut(shortcutManager);
      check(
        "native rebind persists and rebuilds",
        key(window)?.getAttribute("key") === "p" &&
          key(window)?.getAttribute("modifiers") === "control,shift,meta" &&
          persisted?.key === "p" &&
          persisted?.modifiers?.control === true &&
          persisted?.modifiers?.shift === true &&
          persisted?.modifiers?.meta === true,
        JSON.stringify({
          key: key(window)?.getAttribute("key"),
          modifiers: key(window)?.getAttribute("modifiers"),
          persisted,
        }),
      );

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

      gBrowser.unpinTab(pinnedBoundaryTab);
      gBrowser.removeTab(pinnedBoundaryTab, { animate: false });
      await waitFor("pinned fixture cleanup", () =>
        !gBrowser.tabs.includes(pinnedBoundaryTab)
      );
      const activeWorkspaceId = gZenWorkspaces.activeWorkspace;
      for (const candidateTab of [...gBrowser.tabs]) {
        if (
          !candidateTab.pinned &&
          !orderedTestTabs.includes(candidateTab) &&
          candidateTab.getAttribute("zen-workspace-id") === activeWorkspaceId
        ) {
          gBrowser.removeTab(candidateTab, { animate: false });
        }
      }
      gBrowser.selectedTab = testTab;
      gBrowser.clearMultiSelectedTabs();
      for (const selectedTab of orderedTestTabs) {
        gBrowser.addToMultiSelectedTabs(selectedTab);
      }
      await waitFor("complete pop-out selection", () =>
        JSON.stringify(selectedTestUrls()) === JSON.stringify(orderedTestUrls)
      );
      Services.prefs.setBoolPref("zen.tabs.dnd-open-blank-window", false);
      key(window).doCommand();
      openedWindow = await waitFor("new browser window", () =>
        windows().find(candidate => !startingWindows.includes(candidate))
      );
      await openedWindow.gZenStartup.promiseInitialized;
      await waitFor("completed pop-out adoption", () => {
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
        return JSON.stringify(movedUrls) === JSON.stringify(orderedTestUrls) &&
          JSON.stringify(movedSelectedUrls) === JSON.stringify(orderedTestUrls) &&
          JSON.stringify(sourceUrls) === JSON.stringify(["about:newtab"]) &&
          openedWindow.document.documentElement.hasAttribute("zen-unsynced-window") &&
          Services.focus.activeWindow === openedWindow;
      }, 5000);
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
        "command moves selected tabs into one isolated window",
        windows().length === startingWindows.length + 1 &&
          orderedTestTabs.every(tab => !gBrowser.tabs.includes(tab)) &&
          JSON.stringify(destinationUrls) === JSON.stringify(orderedTestUrls) &&
          JSON.stringify(destinationSelectedUrls) ===
            JSON.stringify(orderedTestUrls) &&
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

      for (const sentinelTab of [...gBrowser.tabs]) {
        if (sentinelTab.hasAttribute("zen-empty-tab")) {
          sentinelTab.remove();
        }
      }
      gBrowser.tabContainer._invalidateCachedTabs();

      await waitFor("new-window tab commands", () =>
        hasAllCommands(openedWindow) && hasAllKeys(openedWindow)
      );
      const initialOpenedCommand = command(openedWindow);
      check(
        "new window receives every registered action",
        OWNED_COMMAND_IDS.every(id => commandCount(openedWindow, id) === 1) &&
          key(openedWindow)?.getAttribute("key") === "p" &&
          key(openedWindow)?.getAttribute("command") === COMMANDS.popOut &&
          key(openedWindow, SHORTCUTS.nextVim)?.getAttribute("key") === "j" &&
          key(openedWindow, SHORTCUTS.nextArrow)?.getAttribute("keycode") ===
            "VK_DOWN",
        JSON.stringify({
          commands: OWNED_COMMAND_IDS.map(id => commandCount(openedWindow, id)),
          key: key(openedWindow)?.getAttribute("key"),
          keyCommand: key(openedWindow)?.getAttribute("command"),
        }),
      );

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
          (await savedOwnedShortcutCount(shortcutManager)) === 6,
        JSON.stringify({
          openedCommands: OWNED_COMMAND_IDS.map(id => commandCount(openedWindow, id)),
          savedCount: await savedOwnedShortcutCount(shortcutManager),
          sourceCommands: OWNED_COMMAND_IDS.map(id => commandCount(window, id)),
        }),
      );

      await sineManager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = false;
      await waitFor("shortcut cleanup", async () =>
        hasNoCommands(window) && hasNoCommands(openedWindow) &&
          hasNoKeys(window) && hasNoKeys(openedWindow) &&
          window.zenExtendedTabShortcuts === undefined &&
          openedWindow.zenExtendedTabShortcuts === undefined &&
          (await savedOwnedShortcutCount(shortcutManager)) === 0
      );
      const retained = JSON.parse(
        Services.prefs.getStringPref(
          "zen.extended-tab-shortcuts.saved-binding.pop-out-tab-key",
          "null"
        )
      );
      const retainedNext = JSON.parse(
        Services.prefs.getStringPref(
          "zen.extended-tab-shortcuts.saved-binding." + SHORTCUTS.nextVim,
          "null"
        )
      );
      check(
        "disable removes commands and editable actions",
        hasNoCommands(window) && hasNoCommands(openedWindow) &&
          hasNoKeys(window) && hasNoKeys(openedWindow) &&
          retained?.key === "p" &&
          retained?.modifiers?.control === true &&
          retained?.modifiers?.shift === true &&
          retained?.modifiers?.meta === true &&
          retainedNext?.key === "j" &&
          retainedNext?.modifiers?.control === true &&
          retainedNext?.modifiers?.meta === true,
        JSON.stringify({
          openedCommands: OWNED_COMMAND_IDS.filter(id => command(openedWindow, id)),
          openedKeys: OWNED_SHORTCUT_IDS.filter(id => key(openedWindow, id)),
          retained,
          retainedNext,
          sourceCommands: OWNED_COMMAND_IDS.filter(id => command(window, id)),
          sourceKeys: OWNED_SHORTCUT_IDS.filter(id => key(window, id)),
        }),
      );

      await sineManager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = true;
      await waitFor("restored shortcuts", async () =>
        hasAllCommands(window) && hasAllCommands(openedWindow) &&
          hasAllKeys(window) && hasAllKeys(openedWindow) &&
          key(window)?.getAttribute("key") === "p" &&
          key(openedWindow)?.getAttribute("key") === "p" &&
          key(window, SHORTCUTS.nextVim)?.getAttribute("key") === "j" &&
          key(openedWindow, SHORTCUTS.nextVim)?.getAttribute("key") === "j" &&
          (await savedOwnedShortcutCount(shortcutManager)) === 6
      );
      const restored = await savedShortcut(shortcutManager);
      check(
        "re-enable restores user bindings",
        OWNED_COMMAND_IDS.every(
          id => commandCount(window, id) === 1 && commandCount(openedWindow, id) === 1
        ) &&
          restored?.key === "p" &&
          restored?.modifiers?.control === true &&
          restored?.modifiers?.shift === true &&
          restored?.modifiers?.meta === true &&
          key(window, SHORTCUTS.nextVim)?.getAttribute("key") === "j",
        JSON.stringify({
          openedCommands: OWNED_COMMAND_IDS.map(id => commandCount(openedWindow, id)),
          restored,
          sourceCommands: OWNED_COMMAND_IDS.map(id => commandCount(window, id)),
        }),
      );
    } catch (error) {
      report.fatal = String(error) + " | " + String(error?.stack ?? "");
    } finally {
      try {
        if (enabled) {
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
        sineVersion: zen.platformStamp.sine.version,
        supportsUnload: manifest.supportsUnload,
        zenVersion: zen.platformStamp.zen.version,
      },
    ]);
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

await main();
