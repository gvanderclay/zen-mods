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
const OUTPUT = resolve(REPOSITORY_ROOT, ".benchmarks/live/copy-links.smoke.json");
const PRODUCTION_PATHS = ["dist/copy-links.uc.mjs"];

const REQUIRED_ASSERTIONS = [
  "exact stamped platform is running",
  "manifest declares unload support",
  "production mod starts disabled",
  "enable installs one live action",
  "single-tab context uses Firefox share state",
  "multiselect context uses Firefox share order and count",
  "Sine reload replaces the generation without duplication",
  "disable removes only the owned action",
];

const PROBE = `
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  const ITEM_ID = "copy-links-context-item";
  const SHARE_CLASS = "share-tab-url-item";
  const nativeNow = Date.now.bind(Date);
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const report = { assertions: [], fatal: null, platform: null };
  const check = (name, condition, detail) => {
    report.assertions.push({ name, ok: Boolean(condition), detail: String(detail ?? "") });
    return Boolean(condition);
  };
  const waitFor = async (name, read, timeout = 30000) => {
    const deadline = nativeNow() + timeout;
    let value;
    while (nativeNow() < deadline) {
      value = read();
      if (value) return value;
      await wait(25);
    }
    throw new Error("timed out waiting for " + name + "; last value: " + String(value));
  };
  const waitForEvent = (target, type, timeout = 10000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        target.removeEventListener(type, onEvent);
        reject(new Error("timed out waiting for " + type));
      }, timeout);
      const onEvent = event => {
        clearTimeout(timer);
        target.removeEventListener(type, onEvent);
        resolve(event);
      };
      target.addEventListener(type, onEvent);
    });
  const menu = document.getElementById("tabContextMenu");
  const shareMenu = () =>
    [...menu.children].find(node => node.classList.contains(SHARE_CLASS)) ?? null;
  const item = () => document.getElementById(ITEM_ID);
  const openFor = async tab => {
    const shown = waitForEvent(menu, "popupshown");
    const rect = tab.getBoundingClientRect();
    tab.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      button: 2,
      clientX: rect.left + Math.max(1, rect.width / 2),
      clientY: rect.top + Math.max(1, rect.height / 2),
    }));
    await shown;
  };
  const closeMenu = async () => {
    if (menu.state === "closed") return;
    const hidden = waitForEvent(menu, "popuphidden");
    menu.hidePopup();
    await hidden;
  };
  const l10nCount = node => {
    try {
      return JSON.parse(node.getAttribute("data-l10n-args") || "{}").count;
    } catch {
      return null;
    }
  };
  const principal = Services.scriptSecurityManager.getSystemPrincipal();
  const addTab = url => gBrowser.addTab(url, {
    skipAnimation: true,
    triggeringPrincipal: principal,
  });

  (async () => {
    let manager;
    let sineUtils;
    let enabled = false;
    const tabs = [];
    try {
      manager = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/manager.sys.mjs"
      ).default;
      sineUtils = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/utils.sys.mjs"
      ).default;
      const { SharingUtils } = ChromeUtils.importESModule(
        "resource:///modules/SharingUtils.sys.mjs"
      );
      await waitFor("primary Sine interface", () =>
        typeof window.addUnloadListener === "function" && window.gBrowser && menu
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
          window.zenCopyLinks === undefined && item() === null,
        "enabled=" + String(initialMods[options.modId]?.enabled),
      );

      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = true;
      await waitFor("copy-links generation", () =>
        window.zenCopyLinks?.isLive?.() === true &&
          document.querySelectorAll("#" + ITEM_ID).length === 1
      );
      const initialGeneration = window.zenCopyLinks;
      check(
        "enable installs one live action",
        initialGeneration?.isLive() === true &&
          document.querySelectorAll("#" + ITEM_ID).length === 1,
        "items=" + document.querySelectorAll("#" + ITEM_ID).length,
      );

      const first = addTab("https://copy-links.invalid/one");
      tabs.push(first);
      gBrowser.selectedTab = first;
      await waitFor("first tab URI", () =>
        first.linkedBrowser.currentURI.spec === "https://copy-links.invalid/one"
      );
      await openFor(first);
      const singleShare = shareMenu();
      const singleItem = item();
      const singleLinks = singleShare ? SharingUtils.getLinksToShare(singleShare) : [];
      check(
        "single-tab context uses Firefox share state",
        singleItem?.previousElementSibling === singleShare &&
          !singleItem.hasAttribute("disabled") &&
          singleItem.getAttribute("data-l10n-id") === "menu-share-copy-links" &&
          l10nCount(singleItem) === 1 &&
          singleLinks.length === 1 &&
          singleLinks[0]?.url === "https://copy-links.invalid/one",
        JSON.stringify({
          count: l10nCount(singleItem),
          disabled: singleItem?.hasAttribute("disabled"),
          links: singleLinks.map(link => link.url),
          previous: singleItem?.previousElementSibling?.className,
        }),
      );
      await closeMenu();

      const second = addTab("https://copy-links.invalid/two");
      tabs.push(second);
      await waitFor("second tab URI", () =>
        second.linkedBrowser.currentURI.spec === "https://copy-links.invalid/two"
      );
      gBrowser.addToMultiSelectedTabs(first);
      gBrowser.addToMultiSelectedTabs(second);
      await openFor(first);
      const multiShare = shareMenu();
      const multiItem = item();
      const multiLinks = multiShare ? SharingUtils.getLinksToShare(multiShare) : [];
      const expectedMultiUrls = gBrowser.selectedTabs.map(
        tab => tab.linkedBrowser.currentURI.spec
      );
      check(
        "multiselect context uses Firefox share order and count",
        multiItem?.previousElementSibling === multiShare &&
          !multiItem.hasAttribute("disabled") &&
          l10nCount(multiItem) === 2 &&
          multiLinks.length === 2 &&
          multiLinks.every((link, index) => link.url === expectedMultiUrls[index]),
        JSON.stringify({
          count: l10nCount(multiItem),
          disabled: multiItem?.hasAttribute("disabled"),
          expected: expectedMultiUrls,
          links: multiLinks.map(link => link.url),
        }),
      );
      await closeMenu();

      await manager.rebuildMods(true, false);
      await waitFor("replacement copy-links generation", () =>
        window.zenCopyLinks?.isLive?.() === true &&
          window.zenCopyLinks !== initialGeneration &&
          document.querySelectorAll("#" + ITEM_ID).length === 1
      );
      const replacementGeneration = window.zenCopyLinks;
      check(
        "Sine reload replaces the generation without duplication",
        initialGeneration?.stopReason === "sine-unload" &&
          initialGeneration?.isLive() === false &&
          replacementGeneration?.isLive() === true &&
          document.querySelectorAll("#" + ITEM_ID).length === 1,
        JSON.stringify({
          initialReason: initialGeneration?.stopReason,
          initialLive: initialGeneration?.isLive(),
          replacementLive: replacementGeneration?.isLive(),
          items: document.querySelectorAll("#" + ITEM_ID).length,
        }),
      );

      const retainedShare = shareMenu();
      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = false;
      await waitFor("copy-links disable", () =>
        window.zenCopyLinks === undefined && item() === null
      );
      const finalMods = await sineUtils.getMods();
      check(
        "disable removes only the owned action",
        finalMods[options.modId]?.enabled === false &&
          replacementGeneration?.stopReason === "sine-unload" &&
          replacementGeneration?.isLive() === false &&
          retainedShare?.isConnected === true && item() === null,
        JSON.stringify({
          enabled: finalMods[options.modId]?.enabled,
          reason: replacementGeneration?.stopReason,
          shareConnected: retainedShare?.isConnected,
        }),
      );
    } catch (error) {
      report.fatal = String(error?.stack ?? error);
    } finally {
      try {
        await closeMenu();
      } catch {}
      gBrowser.clearMultiSelectedTabs();
      for (const tab of tabs.reverse()) {
        if (tab?.isConnected) {
          gBrowser.removeTab(tab, { animate: false, skipPermitUnload: true });
        }
      }
      if (enabled && manager && sineUtils) {
        try {
          await manager.toggleTheme(await sineUtils.getMods(), options.modId);
        } catch {}
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
    label: "Copy Links lifecycle",
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
    console.error(`Copy Links lifecycle probe failed: ${error.stack ?? error.message}`);
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
