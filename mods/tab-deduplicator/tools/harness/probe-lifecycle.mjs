#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectVerdicts,
  validateAssertionManifest,
} from "../../../keep-loaded/tools/harness/live-core.mjs";
import { openMarionette } from "../../../keep-loaded/tools/harness/live-marionette.mjs";
import {
  installShutdownSignals,
  launchLiveZen,
} from "../../../keep-loaded/tools/harness/live-zen.mjs";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MOD_DIRECTORY = resolve(DIRECTORY, "../..");
const REPOSITORY_ROOT = resolve(MOD_DIRECTORY, "../..");
const MANIFEST_PATH = resolve(MOD_DIRECTORY, "theme.json");
const OUTPUT = resolve(
  REPOSITORY_ROOT,
  ".benchmarks/live/tab-deduplicator-lifecycle.smoke.json",
);
const PRODUCTION_PATHS = ["dist/tab-deduplicator.uc.mjs", "preferences.json"];

const REQUIRED_ASSERTIONS = [
  "exact stamped platform is running",
  "manifest declares unload support",
  "production mod starts disabled",
  "two windows install distinct live generations",
  "Sine reload replaces both generations without duplication",
  "retained old generation stops are inert",
  "secondary native close stops only its generation",
  "surviving generation stays functional",
  "final Sine disable drains the current generation",
];

const PROBE = `
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  const ITEM_IDS = [
    "tab-deduplicator-unpin-close-pinned",
    "tab-deduplicator-context-item",
    "tab-deduplicator-group-space",
  ];
  const nativeNow = Date.now.bind(Date);
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const report = { assertions: [], fatal: null, generations: {}, platform: null };
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
  const hasOneItemSet = targetWindow =>
    ITEM_IDS.every(id => targetWindow.document.querySelectorAll("#" + id).length === 1);
  const hasNoItems = targetWindow =>
    ITEM_IDS.every(id => targetWindow.document.getElementById(id) === null);
  const generationReady = targetWindow =>
    !targetWindow.closed &&
    targetWindow.zenTabDeduplicator?.isLive?.() === true &&
    hasOneItemSet(targetWindow);
  const browserWindows = () => {
    const windows = [];
    const enumerator = Services.wm.getEnumerator("navigator:browser");
    while (enumerator.hasMoreElements()) windows.push(enumerator.getNext());
    return windows;
  };
  const closeWindow = targetWindow => {
    const command = targetWindow.document.getElementById("cmd_closeWindow");
    if (!command || typeof command.doCommand !== "function") {
      throw new Error("missing native close-window command");
    }
    command.doCommand();
  };

  (async () => {
    let manager;
    let sineUtils;
    let enabled = false;
    let second = null;
    try {
      manager = ChromeUtils.importESModule(
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
      check(
        "production mod starts disabled",
        initialMods[options.modId]?.enabled === false &&
          !window.zenTabDeduplicator && hasNoItems(window),
        "enabled=" + String(initialMods[options.modId]?.enabled),
      );

      const initialWindowCount = browserWindows().length;
      second = OpenBrowserWindow({ openerWindow: window });
      await waitFor("secondary Sine interface", () =>
        !second.closed && second.gBrowser &&
          typeof second.addUnloadListener === "function"
      );

      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = true;
      await waitFor("both initial generations", () =>
        generationReady(window) && generationReady(second)
      );
      const oldA = window.zenTabDeduplicator;
      const oldB = second.zenTabDeduplicator;
      report.generations.initial = {
        distinct: oldA !== oldB,
        windowCount: browserWindows().length,
      };
      check(
        "two windows install distinct live generations",
        browserWindows().length === initialWindowCount + 1 &&
          oldA !== oldB && oldA?.isLive() === true && oldB?.isLive() === true &&
          hasOneItemSet(window) && hasOneItemSet(second),
        JSON.stringify(report.generations.initial),
      );

      await manager.rebuildMods(true, false);
      await waitFor("both replacement generations", () =>
        generationReady(window) && generationReady(second) &&
          window.zenTabDeduplicator !== oldA &&
          second.zenTabDeduplicator !== oldB
      );
      const currentA = window.zenTabDeduplicator;
      const currentB = second.zenTabDeduplicator;
      report.generations.reload = {
        oldAReason: oldA?.stopReason,
        oldBReason: oldB?.stopReason,
        currentDistinct: currentA !== currentB,
      };
      check(
        "Sine reload replaces both generations without duplication",
        oldA?.stopReason === "sine-unload" &&
          oldB?.stopReason === "sine-unload" &&
          currentA !== currentB && currentA?.isLive() === true &&
          currentB?.isLive() === true && hasOneItemSet(window) &&
          hasOneItemSet(second),
        JSON.stringify(report.generations.reload),
      );

      const retainedResults = [oldA?.stop("manual"), oldB?.stop("manual")];
      check(
        "retained old generation stops are inert",
        retainedResults.every(result => result === false) &&
          window.zenTabDeduplicator === currentA &&
          second.zenTabDeduplicator === currentB &&
          currentA?.isLive() === true && currentB?.isLive() === true,
        JSON.stringify(retainedResults),
      );

      closeWindow(second);
      await waitFor("secondary native close", () =>
        second.closed && !browserWindows().includes(second)
      );
      check(
        "secondary native close stops only its generation",
        currentB?.stopReason === "window-unload" &&
          currentB?.isLive() === false && currentA?.isLive() === true,
        JSON.stringify({
          primaryLive: currentA?.isLive(),
          secondaryLive: currentB?.isLive(),
          secondaryReason: currentB?.stopReason,
        }),
      );
      check(
        "surviving generation stays functional",
        window.zenTabDeduplicator === currentA &&
          currentA?.isLive() === true && hasOneItemSet(window),
        "primary items=" + ITEM_IDS.map(id =>
          window.document.querySelectorAll("#" + id).length
        ).join(","),
      );

      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = false;
      await waitFor("final Sine disable", () =>
        window.zenTabDeduplicator === undefined && hasNoItems(window)
      );
      const finalMods = await sineUtils.getMods();
      check(
        "final Sine disable drains the current generation",
        finalMods[options.modId]?.enabled === false &&
          currentA?.stopReason === "sine-unload" &&
          currentA?.isLive() === false &&
          window.zenTabDeduplicator === undefined && hasNoItems(window),
        JSON.stringify({
          enabled: finalMods[options.modId]?.enabled,
          live: currentA?.isLive(),
          reason: currentA?.stopReason,
          state: String(window.zenTabDeduplicator),
        }),
      );
    } catch (error) {
      report.fatal = String(error?.stack ?? error);
      if (enabled && manager && sineUtils) {
        try {
          await manager.toggleTheme(await sineUtils.getMods(), options.modId);
        } catch {}
      }
      if (second && !second.closed) {
        try {
          closeWindow(second);
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
    label: "Tab Deduplicator lifecycle",
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
    console.error(`Tab lifecycle probe failed: ${error.stack ?? error.message}`);
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
