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
  ".benchmarks/live/duplicate-tab-toast.smoke.json",
);
const PRODUCTION_PATHS = ["dist/duplicate-tab-toast.uc.mjs"];

const REQUIRED_ASSERTIONS = [
  "exact stamped platform is running",
  "manifest declares unload support",
  "production mod starts disabled",
  "enable starts one live generation",
  "shortcut duplicates one tab and shows singular feedback",
  "shortcut duplicates selected tabs and shows the actual count",
  "non-command duplication does not show feedback",
  "Sine reload replaces the observer without duplicate feedback",
  "disable removes feedback without changing the native shortcut",
];

const PROBE = `
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  const SHORTCUT_ID = "zen-duplicate-tab";
  const TOAST_ID = "zen-duplicate-tab-toast";
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
  const toastContainer = document.getElementById("zen-toast-container");
  const ownedToast = () =>
    [...toastContainer.children].find(child => child._messageId === TOAST_ID) ?? null;
  const toastText = () => ownedToast()?.querySelector("label")?.textContent ?? "";
  const removeOwnedToast = async () => {
    await wait(650);
    ownedToast()?.remove();
  };
  const addedSince = before => gBrowser.tabs.filter(tab => !before.has(tab));
  const removeTabs = tabs => {
    for (const tab of [...tabs].reverse()) {
      if (tab?.isConnected) {
        gBrowser.removeTab(tab, { animate: false, skipPermitUnload: true });
      }
    }
  };

  (async () => {
    let sineManager;
    let sineUtils;
    let enabled = false;
    let originalShowToast;
    let toastCalls = 0;
    const testTabs = [];
    try {
      sineManager = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/manager.sys.mjs"
      ).default;
      sineUtils = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/utils.sys.mjs"
      ).default;
      await waitFor("primary Sine interface", () =>
        typeof window.addUnloadListener === "function" &&
          window.gBrowser && toastContainer && window.gZenUIManager
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
          window.zenDuplicateTabToast === undefined && ownedToast() === null,
        JSON.stringify({
          enabled: initialMods[options.modId]?.enabled,
          generation: Boolean(window.zenDuplicateTabToast),
          toast: Boolean(ownedToast()),
        }),
      );

      originalShowToast = gZenUIManager.showToast;
      gZenUIManager.showToast = function (...args) {
        if (args[0] === TOAST_ID) toastCalls += 1;
        return originalShowToast.apply(this, args);
      };

      const { nsKeyShortcutModifiers } = ChromeUtils.importESModule(
        "chrome://browser/content/zen-components/ZenKeyboardShortcuts.mjs",
        { global: "current" }
      );
      await gZenKeyboardShortcutsManager.getModifiableShortcuts();
      await gZenKeyboardShortcutsManager.setShortcut(
        SHORTCUT_ID,
        "d",
        new nsKeyShortcutModifiers(true, false, true, true, false)
      );
      const key = () => document.getElementById(SHORTCUT_ID);
      await waitFor("bound duplicate shortcut", () => key()?.doCommand);

      await sineManager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = true;
      await waitFor(
        "duplicate-tab-toast generation",
        () => window.zenDuplicateTabToast?.isLive?.() === true,
      );
      const initialGeneration = window.zenDuplicateTabToast;
      check(
        "enable starts one live generation",
        initialGeneration?.isLive() === true,
        "live=" + String(initialGeneration?.isLive()),
      );

      const principal = Services.scriptSecurityManager.getSystemPrincipal();
      const first = gBrowser.addTab("https://duplicate-tab-toast.invalid/one", {
        skipAnimation: true,
        triggeringPrincipal: principal,
      });
      testTabs.push(first);
      gBrowser.selectedTab = first;
      await waitFor("first test tab URI", () =>
        first.linkedBrowser.currentURI.spec === "https://duplicate-tab-toast.invalid/one"
      );

      let before = new Set(gBrowser.tabs);
      let callsBefore = toastCalls;
      key().doCommand();
      const singleCopies = await waitFor("one duplicated tab", () => {
        const added = addedSince(before);
        return added.length === 1 ? added : null;
      });
      await waitFor("singular duplicate toast", () => toastText() === "Tab duplicated!");
      check(
        "shortcut duplicates one tab and shows singular feedback",
        singleCopies.length === 1 && toastCalls - callsBefore === 1 &&
          toastText() === "Tab duplicated!",
        JSON.stringify({
          copies: singleCopies.length,
          text: toastText(),
          toastCalls: toastCalls - callsBefore,
        }),
      );
      await removeOwnedToast();
      removeTabs(singleCopies);

      const second = gBrowser.addTab("https://duplicate-tab-toast.invalid/two", {
        skipAnimation: true,
        triggeringPrincipal: principal,
      });
      testTabs.push(second);
      await waitFor("second test tab URI", () =>
        second.linkedBrowser.currentURI.spec === "https://duplicate-tab-toast.invalid/two"
      );
      gBrowser.selectedTab = first;
      gBrowser.addToMultiSelectedTabs(first);
      gBrowser.addToMultiSelectedTabs(second);
      before = new Set(gBrowser.tabs);
      callsBefore = toastCalls;
      key().doCommand();
      const selectedCopies = await waitFor("two duplicated tabs", () => {
        const added = addedSince(before);
        return added.length === 2 ? added : null;
      });
      await waitFor("plural duplicate toast", () => toastText() === "2 tabs duplicated!");
      check(
        "shortcut duplicates selected tabs and shows the actual count",
        selectedCopies.length === 2 && toastCalls - callsBefore === 1 &&
          toastText() === "2 tabs duplicated!",
        JSON.stringify({
          copies: selectedCopies.length,
          text: toastText(),
          toastCalls: toastCalls - callsBefore,
        }),
      );
      gBrowser.clearMultiSelectedTabs();
      await removeOwnedToast();
      removeTabs(selectedCopies);

      gBrowser.selectedTab = first;
      before = new Set(gBrowser.tabs);
      callsBefore = toastCalls;
      gBrowser.duplicateTab(first, true, { tabIndex: first._tPos + 1 });
      const directCopies = await waitFor("directly duplicated tab", () => {
        const added = addedSince(before);
        return added.length === 1 ? added : null;
      });
      await wait(100);
      check(
        "non-command duplication does not show feedback",
        directCopies.length === 1 && toastCalls === callsBefore && ownedToast() === null,
        JSON.stringify({
          copies: directCopies.length,
          toast: Boolean(ownedToast()),
          toastCalls: toastCalls - callsBefore,
        }),
      );
      removeTabs(directCopies);

      await sineManager.rebuildMods(true, false);
      await waitFor("replacement generation", () =>
        window.zenDuplicateTabToast?.isLive?.() === true &&
          window.zenDuplicateTabToast !== initialGeneration
      );
      const replacementGeneration = window.zenDuplicateTabToast;
      gBrowser.selectedTab = first;
      before = new Set(gBrowser.tabs);
      callsBefore = toastCalls;
      key().doCommand();
      const reloadCopies = await waitFor("post-reload duplicated tab", () => {
        const added = addedSince(before);
        return added.length === 1 ? added : null;
      });
      await waitFor("post-reload duplicate toast", () => toastText() === "Tab duplicated!");
      check(
        "Sine reload replaces the observer without duplicate feedback",
        initialGeneration?.stopReason === "sine-unload" &&
          initialGeneration?.isLive() === false &&
          replacementGeneration?.isLive() === true &&
          reloadCopies.length === 1 && toastCalls - callsBefore === 1,
        JSON.stringify({
          initialReason: initialGeneration?.stopReason,
          initialLive: initialGeneration?.isLive(),
          replacementLive: replacementGeneration?.isLive(),
          toastCalls: toastCalls - callsBefore,
        }),
      );
      await removeOwnedToast();
      removeTabs(reloadCopies);

      await sineManager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = false;
      await waitFor("duplicate-tab-toast disable", () =>
        window.zenDuplicateTabToast === undefined
      );
      gBrowser.selectedTab = first;
      before = new Set(gBrowser.tabs);
      callsBefore = toastCalls;
      key().doCommand();
      const disabledCopies = await waitFor("disabled-mod duplicated tab", () => {
        const added = addedSince(before);
        return added.length === 1 ? added : null;
      });
      await wait(100);
      check(
        "disable removes feedback without changing the native shortcut",
        replacementGeneration?.stopReason === "sine-unload" &&
          replacementGeneration?.isLive() === false &&
          key()?.isConnected === true && disabledCopies.length === 1 &&
          toastCalls === callsBefore && ownedToast() === null,
        JSON.stringify({
          copies: disabledCopies.length,
          keyConnected: key()?.isConnected,
          reason: replacementGeneration?.stopReason,
          toast: Boolean(ownedToast()),
          toastCalls: toastCalls - callsBefore,
        }),
      );
      removeTabs(disabledCopies);
    } catch (error) {
      report.fatal = String(error?.stack ?? error);
    } finally {
      try {
        gBrowser.clearMultiSelectedTabs();
        removeTabs(testTabs);
      } catch (error) {
        report.cleanupError = String(error?.stack ?? error);
      }
      if (originalShowToast) gZenUIManager.showToast = originalShowToast;
      if (enabled && sineManager && sineUtils) {
        try {
          await sineManager.toggleTheme(await sineUtils.getMods(), options.modId);
        } catch (error) {
          report.disableError = String(error?.stack ?? error);
        }
      }
    }
    done(report);
  })();
`;

const atomicWriteJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
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
    label: "Duplicate Tab Toast lifecycle",
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
      `Duplicate Tab Toast lifecycle probe failed: ${error.stack ?? error.message}`,
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
