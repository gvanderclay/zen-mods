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
const OUTPUT = resolve(REPOSITORY_ROOT, ".benchmarks/live/pop-out-tab.smoke.json");
const PRODUCTION_PATHS = ["dist/pop-out-tab.uc.mjs"];

const REQUIRED_ASSERTIONS = [
  "exact stamped platform is running",
  "manifest declares unload support",
  "production mod starts disabled",
  "enable registers one editable action",
  "native rebind persists and rebuilds",
  "command moves the live tab into one synced window",
  "new window receives the registered action",
  "Sine reload replaces commands without duplicating the shortcut",
  "disable removes commands and the editable action",
  "re-enable restores the user binding",
];

const PROBE = `
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  const SHORTCUT_ID = "pop-out-tab-key";
  const COMMAND_ID = "Pop Out Current Tab";
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const report = { assertions: [], fatal: null, platform: null };
  const check = (name, condition, detail) => {
    report.assertions.push({ name, ok: Boolean(condition), detail: String(detail ?? "") });
    return Boolean(condition);
  };
  const waitFor = async (name, read, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    let value;
    while (Date.now() < deadline) {
      value = await read();
      if (value) return value;
      await wait(25);
    }
    throw new Error("timed out waiting for " + name + "; last value: " + String(value));
  };
  const windows = () => [...Services.wm.getEnumerator("navigator:browser")]
    .filter(candidate => !candidate.closed);
  const command = candidate => candidate.document.getElementById(COMMAND_ID);
  const key = candidate => candidate.document.getElementById(SHORTCUT_ID);
  const commandCount = candidate => [...candidate.document.getElementsByTagName("command")]
    .filter(node => node.id === COMMAND_ID).length;
  const savedShortcut = async manager =>
    (await manager.loader.loadObject()).shortcuts.find(item => item.id === SHORTCUT_ID);
  const savedShortcutCount = async manager =>
    (await manager.loader.loadObject()).shortcuts.filter(item => item.id === SHORTCUT_ID).length;

  (async () => {
    let sineManager;
    let sineUtils;
    let shortcutManager;
    let enabled = false;
    let openedWindow;
    let testTab;
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
          window.zenPopOutTab === undefined &&
          command(window) === null &&
          (await savedShortcutCount(shortcutManager)) === 0,
        JSON.stringify({
          enabled: initialMods[options.modId]?.enabled,
          command: Boolean(command(window)),
          shortcutCount: await savedShortcutCount(shortcutManager),
        }),
      );

      await sineManager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = true;
      await waitFor("registered pop-out action", async () => {
        const modifiable = await shortcutManager.getModifiableShortcuts();
        return window.zenPopOutTab?.isLive?.() === true &&
          command(window) && key(window) &&
          modifiable.find(item => item.getID() === SHORTCUT_ID);
      });
      const registered = (await shortcutManager.getModifiableShortcuts())
        .find(item => item.getID() === SHORTCUT_ID);
      const initialCommand = command(window);
      check(
        "enable registers one editable action",
        commandCount(window) === 1 &&
          registered?.getAction() === COMMAND_ID &&
          registered?.toDisplayString() === "⌃ ⌘ N" &&
          key(window)?.getAttribute("key") === "n" &&
          key(window)?.getAttribute("modifiers") === "control,meta" &&
          key(window)?.getAttribute("command") === COMMAND_ID &&
          (await savedShortcutCount(shortcutManager)) === 1,
        JSON.stringify({
          action: registered?.getAction(),
          commands: commandCount(window),
          display: registered?.toDisplayString(),
          key: key(window)?.getAttribute("key"),
          modifiers: key(window)?.getAttribute("modifiers"),
          savedCount: await savedShortcutCount(shortcutManager),
        }),
      );

      const { nsKeyShortcutModifiers } = ChromeUtils.importESModule(
        "chrome://browser/content/zen-components/ZenKeyboardShortcuts.mjs",
        { global: "current" }
      );
      await shortcutManager.setShortcut(
        SHORTCUT_ID,
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
      testTab = gBrowser.addTab("https://pop-out-tab.invalid/current", {
        skipAnimation: true,
        triggeringPrincipal: principal,
      });
      gBrowser.selectedTab = testTab;
      await waitFor("test tab URI", () =>
        testTab.linkedBrowser.currentURI.spec === "https://pop-out-tab.invalid/current"
      );
      key(window).doCommand();
      openedWindow = await waitFor("new browser window", () =>
        windows().find(candidate => !startingWindows.includes(candidate))
      );
      await openedWindow.gZenStartup.promiseInitialized;
      await waitFor("moved tab", () =>
        openedWindow.gBrowser.tabs.find(tab =>
          tab.linkedBrowser.currentURI.spec === "https://pop-out-tab.invalid/current"
        )
      );
      const movedTab = openedWindow.gBrowser.tabs.find(tab =>
        tab.linkedBrowser.currentURI.spec === "https://pop-out-tab.invalid/current"
      );
      check(
        "command moves the live tab into one synced window",
        windows().length === startingWindows.length + 1 &&
          !gBrowser.tabs.includes(testTab) &&
          openedWindow.gBrowser.selectedTab === movedTab &&
          Boolean(openedWindow.gZenWindowSync) &&
          !openedWindow.document.documentElement.hasAttribute("zen-unsynced-window"),
        JSON.stringify({
          destinationSelected: openedWindow.gBrowser.selectedTab === movedTab,
          markedUnsynced:
            openedWindow.document.documentElement.hasAttribute("zen-unsynced-window"),
          sourceContainsTab: gBrowser.tabs.includes(testTab),
          synced: Boolean(openedWindow.gZenWindowSync),
          windowDelta: windows().length - startingWindows.length,
        }),
      );

      await waitFor("new-window pop-out command", () =>
        command(openedWindow) && key(openedWindow)
      );
      const initialOpenedCommand = command(openedWindow);
      check(
        "new window receives the registered action",
        commandCount(openedWindow) === 1 &&
          key(openedWindow)?.getAttribute("key") === "p" &&
          key(openedWindow)?.getAttribute("command") === COMMAND_ID,
        JSON.stringify({
          commands: commandCount(openedWindow),
          key: key(openedWindow)?.getAttribute("key"),
          keyCommand: key(openedWindow)?.getAttribute("command"),
        }),
      );

      await sineManager.rebuildMods(true, false);
      await waitFor("replacement commands", () =>
        window.zenPopOutTab?.isLive?.() === true &&
          openedWindow.zenPopOutTab?.isLive?.() === true &&
          command(window) && command(window) !== initialCommand &&
          command(openedWindow) && command(openedWindow) !== initialOpenedCommand
      );
      check(
        "Sine reload replaces commands without duplicating the shortcut",
        commandCount(window) === 1 &&
          commandCount(openedWindow) === 1 &&
          (await savedShortcutCount(shortcutManager)) === 1,
        JSON.stringify({
          openedCommands: commandCount(openedWindow),
          savedCount: await savedShortcutCount(shortcutManager),
          sourceCommands: commandCount(window),
        }),
      );

      await sineManager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = false;
      await waitFor("shortcut cleanup", async () =>
        command(window) === null && command(openedWindow) === null &&
          key(window) === null && key(openedWindow) === null &&
          window.zenPopOutTab === undefined && openedWindow.zenPopOutTab === undefined &&
          (await savedShortcutCount(shortcutManager)) === 0
      );
      const retained = JSON.parse(
        Services.prefs.getStringPref("zen.pop-out-tab.saved-binding", "null")
      );
      check(
        "disable removes commands and the editable action",
        key(window) === null && key(openedWindow) === null &&
          retained?.key === "p" &&
          retained?.modifiers?.control === true &&
          retained?.modifiers?.shift === true &&
          retained?.modifiers?.meta === true,
        JSON.stringify({
          openedCommand: Boolean(command(openedWindow)),
          openedKey: Boolean(key(openedWindow)),
          retained,
          sourceCommand: Boolean(command(window)),
          sourceKey: Boolean(key(window)),
        }),
      );

      await sineManager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = true;
      await waitFor("restored shortcut", async () =>
        command(window) && command(openedWindow) &&
          key(window)?.getAttribute("key") === "p" &&
          key(openedWindow)?.getAttribute("key") === "p" &&
          (await savedShortcutCount(shortcutManager)) === 1
      );
      const restored = await savedShortcut(shortcutManager);
      check(
        "re-enable restores the user binding",
        commandCount(window) === 1 && commandCount(openedWindow) === 1 &&
          restored?.key === "p" &&
          restored?.modifiers?.control === true &&
          restored?.modifiers?.shift === true &&
          restored?.modifiers?.meta === true,
        JSON.stringify({
          openedCommands: commandCount(openedWindow),
          restored,
          sourceCommands: commandCount(window),
        }),
      );
    } catch (error) {
      report.fatal = String(error?.stack ?? error);
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
        if (testTab?.parentNode) gBrowser.removeTab(testTab, { animate: false });
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
    label: "Pop Out Tab lifecycle",
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
    console.error(`Pop Out Tab lifecycle probe failed: ${error.stack ?? error.message}`);
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
