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
const PRODUCTION_PATHS = ["dist/extended-tab-shortcuts.uc.mjs", "styles/chrome.css"];

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
  const folderPanel = candidate =>
    candidate.document.getElementById("extended-tab-shortcuts-folder-panel");
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
          key(window, SHORTCUTS.moveNextVim)?.getAttribute("key") === "n" &&
          key(window, SHORTCUTS.moveNextVim)?.getAttribute("command") ===
            COMMANDS.moveNext &&
          key(window, SHORTCUTS.moveNextArrow)?.getAttribute("keycode") ===
            "VK_RIGHT" &&
          key(window, SHORTCUTS.moveNextArrow)?.getAttribute("modifiers") ===
            "control,shift,meta" &&
          key(window, SHORTCUTS.moveNextArrow)?.getAttribute("command") ===
            COMMANDS.moveNext &&
          key(window, SHORTCUTS.movePreviousVim)?.getAttribute("key") === "p" &&
          key(window, SHORTCUTS.movePreviousVim)?.getAttribute("command") ===
            COMMANDS.movePrevious &&
          key(window, SHORTCUTS.movePreviousArrow)?.getAttribute("keycode") ===
            "VK_LEFT" &&
          key(window, SHORTCUTS.movePreviousArrow)?.getAttribute("modifiers") ===
            "control,shift,meta" &&
          key(window, SHORTCUTS.movePreviousArrow)?.getAttribute("command") ===
            COMMANDS.movePrevious &&
          OWNED_SHORTCUT_IDS.every(
            id => key(window, id)?.getAttribute("modifiers") === "control,meta"
              || key(window, id)?.getAttribute("modifiers") ===
                "control,shift,meta"
          ) &&
          key(window, SHORTCUTS.moveToFolder)?.getAttribute("key") === "m" &&
          key(window, SHORTCUTS.moveToFolder)?.getAttribute("command") ===
            COMMANDS.moveToFolder &&
          folderPanel(window) &&
          (await savedOwnedShortcutCount(shortcutManager)) === 11,
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
      await waitFor("complete pop-out selection", () =>
        JSON.stringify(selectedTestUrls()) === JSON.stringify(popOutTestUrls)
      );
      Services.prefs.setBoolPref("zen.tabs.dnd-open-blank-window", false);
      key(window).doCommand();
      openedWindow = await waitFor("new browser window", () =>
        windows().find(
          candidate =>
            !startingWindows.includes(candidate) &&
            candidate.gZenStartup?.promiseInitialized
        )
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
        return JSON.stringify(movedUrls) === JSON.stringify(popOutTestUrls) &&
          JSON.stringify(movedSelectedUrls) === JSON.stringify(popOutTestUrls) &&
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
          (await savedOwnedShortcutCount(shortcutManager)) === 11,
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
          !folderPanel(window) && !folderPanel(openedWindow) &&
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
          !folderPanel(window) && !folderPanel(openedWindow) &&
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
          (await savedOwnedShortcutCount(shortcutManager)) === 11
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
