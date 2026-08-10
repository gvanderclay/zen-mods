#!/usr/bin/env node

/** Verify first/last CustomizableUI ownership with the committed production bundle. */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectVerdicts, validateAssertionManifest } from "./live-core.mjs";
import { openMarionette } from "./live-marionette.mjs";
import { launchLiveZen } from "./live-zen.mjs";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MOD_DIRECTORY = resolve(DIRECTORY, "../..");
const REPOSITORY_ROOT = resolve(MOD_DIRECTORY, "../..");
const OUTPUT = resolve(
  REPOSITORY_ROOT,
  ".benchmarks/live/keep-loaded-production-widget-ownership.smoke.json",
);
const MANIFEST_PATH = resolve(MOD_DIRECTORY, "theme.json");
const BUNDLE_PATHS = {
  system: resolve(MOD_DIRECTORY, "dist/keep-loaded.sys.mjs"),
  window: resolve(MOD_DIRECTORY, "dist/keep-loaded.uc.mjs"),
};
const PRODUCTION_PATHS = [
  "dist/keep-loaded.sys.mjs",
  "dist/keep-loaded.uc.mjs",
  "preferences.json",
  "styles/chrome.css",
];

const REQUIRED_ASSERTIONS = [
  "exact stamped platform is running",
  "production mod starts disabled",
  "three live production windows register on one owner",
  "one widget identity is shared by all windows",
  "first secondary close leaves the creator and widget live",
  "first survivor fills its own panel",
  "second secondary close leaves the creator and widget live",
  "creator survivor fills its own panel",
  "last active registration disable destroys the application widget",
  "application owner drains after the final disable",
];

const PROBE = `
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  const BUTTON_ID = "keep-loaded-button";
  const VIEW_ID = "keep-loaded-panelview";
  const BODY_ID = "keep-loaded-panel-body";
  const WAKE_ID = "keep-loaded-wake-button";
  const CACHE_ID = "appMenu-viewCache";
  const OWNER_URI = "chrome://sine/content/keep-loaded/dist/keep-loaded.sys.mjs";
  const nativeNow = Date.now.bind(Date);
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const report = { assertions: [], closeOrder: [], fatal: null, panels: [], platform: null, owner: {} };
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
  const browserWindows = () => {
    const windows = [];
    const enumerator = Services.wm.getEnumerator("navigator:browser");
    while (enumerator.hasMoreElements()) windows.push(enumerator.getNext());
    return windows;
  };
  const cachedView = targetWindow =>
    targetWindow.document.getElementById(VIEW_ID) ??
    targetWindow.document.getElementById(CACHE_ID)?.content.querySelector("#" + VIEW_ID) ??
    null;
  const controllerReady = targetWindow => {
    try {
      return targetWindow.zenKeepLoaded?.controller?.isLive() === true &&
        Boolean(targetWindow.zenKeepLoaded?.application?.()?.registrationId) &&
        Boolean(cachedView(targetWindow));
    } catch {
      return false;
    }
  };
  const waitWindow = async (name, targetWindow, requireController = true) => {
    await waitFor(name + " Sine interface", () =>
      !targetWindow.closed && targetWindow.gBrowser &&
      typeof targetWindow.addUnloadListener === "function" &&
      targetWindow.document.getElementById(CACHE_ID));
    if (requireController) {
      await waitFor(name + " production controller", () => controllerReady(targetWindow));
    }
  };
  const closeWindow = targetWindow => {
    const command = targetWindow.document.getElementById("cmd_closeWindow");
    if (!command || typeof command.doCommand !== "function") {
      throw new Error("missing close command for " + targetWindow.location.href);
    }
    command.doCommand();
  };
  const panelSnapshot = async (name, targetWindow) => {
    const button = targetWindow.document.getElementById(BUTTON_ID);
    if (!button || typeof button.doCommand !== "function") {
      throw new Error(name + " has no status button");
    }
    button.doCommand();
    await waitFor(name + " panel fill", () => {
      const body = targetWindow.document.getElementById(BODY_ID);
      return body?.querySelector(".keep-loaded-panel-heading")?.getAttribute("value") &&
        targetWindow.document.getElementById(WAKE_ID)?.getAttribute("label");
    });
    const body = targetWindow.document.getElementById(BODY_ID);
    const snapshot = {
      action: targetWindow.document.getElementById(WAKE_ID)?.getAttribute("label") ?? null,
      bodyOwnerIsWindow: body?.ownerDocument === targetWindow.document,
      heading: body?.querySelector(".keep-loaded-panel-heading")?.getAttribute("value") ?? null,
    };
    report.panels.push({ name, ...snapshot });
    return snapshot;
  };

  (async () => {
    let manager;
    let sineUtils;
    let enabled = false;
    let windows = [];
    try {
      manager = ChromeUtils.importESModule("chrome://userscripts/content/core/manager.sys.mjs").default;
      sineUtils = ChromeUtils.importESModule("chrome://userscripts/content/core/utils.sys.mjs").default;
      await waitFor("primary Sine interface", () =>
        typeof window.addUnloadListener === "function" && window.CustomizableUI);
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

      const initialMods = await sineUtils.getMods();
      check(
        "production mod starts disabled",
        initialMods[options.modId]?.enabled === false && !window.zenKeepLoaded,
        "enabled=" + String(initialMods[options.modId]?.enabled) +
          ", facade=" + String(Boolean(window.zenKeepLoaded)),
      );

      const initialWindowCount = browserWindows().length;
      const second = OpenBrowserWindow({ openerWindow: window });
      await waitWindow("secondary", second, false);
      const third = OpenBrowserWindow({ openerWindow: window });
      await waitWindow("tertiary", third, false);
      windows = [window, second, third];

      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = true;
      await Promise.all(windows.map((target, index) => waitWindow("window-" + (index + 1), target)));

      const owner = ChromeUtils.importESModule(OWNER_URI);
      await waitFor("three idle registrations", () => {
        const snapshot = owner.snapshot();
        return snapshot.registrationCount === 3 && snapshot.activeCount === 0 && snapshot.keyRecords === 0;
      });
      const initialOwner = owner.snapshot();
      report.owner.initial = initialOwner;
      const ui = window.CustomizableUI;
      const initialWidget = ui.getWidget(BUTTON_ID);
      const eachWidget = windows.map(target => target.CustomizableUI.getWidget(BUTTON_ID));
      check(
        "three live production windows register on one owner",
        browserWindows().length === initialWindowCount + 2 &&
          initialOwner.registrationCount === 3 &&
          windows.every(target => target.zenKeepLoaded?.controller?.isLive()),
        JSON.stringify(initialOwner),
      );
      check(
        "one widget identity is shared by all windows",
        initialWidget?.provider === ui.PROVIDER_API &&
          eachWidget.every(widget => widget === initialWidget) &&
          Boolean(ui.getPlacementOfWidget(BUTTON_ID)),
        "same=" + String(eachWidget.every(widget => widget === initialWidget)) +
          ", placement=" + JSON.stringify(ui.getPlacementOfWidget(BUTTON_ID)),
      );

      closeWindow(second);
      report.closeOrder.push("secondary-1");
      await waitFor("first secondary close", () => second.closed && !browserWindows().includes(second));
      await waitFor("two surviving registrations", () => owner.snapshot().registrationCount === 2);
      const afterFirstSecondary = owner.snapshot();
      const firstSurvivorWidget = ui.getWidget(BUTTON_ID);
      check(
        "first secondary close leaves the creator and widget live",
        !window.closed && !third.closed &&
          firstSurvivorWidget === initialWidget &&
          afterFirstSecondary.registrationCount === 2 &&
          Boolean(ui.getPlacementOfWidget(BUTTON_ID)),
        JSON.stringify({
          owner: afterFirstSecondary,
          sameWidget: firstSurvivorWidget === initialWidget,
        }),
      );
      const secondPanel = await panelSnapshot("creator after first secondary close", window);
      check(
        "first survivor fills its own panel",
        secondPanel.bodyOwnerIsWindow && Boolean(secondPanel.heading) && Boolean(secondPanel.action),
        JSON.stringify(secondPanel),
      );

      closeWindow(third);
      report.closeOrder.push("secondary-2");
      await waitFor("second secondary close", () => third.closed && !browserWindows().includes(third));
      await waitFor("one surviving registration", () => owner.snapshot().registrationCount === 1);
      const afterSecondSecondary = owner.snapshot();
      const secondSurvivorWidget = ui.getWidget(BUTTON_ID);
      check(
        "second secondary close leaves the creator and widget live",
        !window.closed &&
          secondSurvivorWidget === initialWidget &&
          afterSecondSecondary.registrationCount === 1 &&
          Boolean(ui.getPlacementOfWidget(BUTTON_ID)),
        JSON.stringify({
          owner: afterSecondSecondary,
          sameWidget: secondSurvivorWidget === initialWidget,
        }),
      );
      const thirdPanel = await panelSnapshot("creator after second secondary close", window);
      check(
        "creator survivor fills its own panel",
        thirdPanel.bodyOwnerIsWindow && Boolean(thirdPanel.heading) && Boolean(thirdPanel.action),
        JSON.stringify(thirdPanel),
      );

      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = false;
      await waitFor("last registration drain", () => owner.snapshot().registrationCount === 0);
      const finalOwner = owner.snapshot();
      check(
        "last active registration disable destroys the application widget",
        ui.getWidget(BUTTON_ID) === null && !ui.getPlacementOfWidget(BUTTON_ID),
        "widget=" + String(ui.getWidget(BUTTON_ID)) + ", placement=" +
          JSON.stringify(ui.getPlacementOfWidget(BUTTON_ID)),
      );
      report.owner.final = finalOwner;
      check(
        "application owner drains after the final disable",
        finalOwner.registrationCount === 0 && finalOwner.activeCount === 0 &&
          finalOwner.drainingCount === 0 && finalOwner.keyRecords === 0 &&
          finalOwner.readyCount === 0 && finalOwner.trailingCount === 0,
        JSON.stringify(finalOwner),
      );
      enabled = false;
    } catch (error) {
      report.fatal = String(error?.stack ?? error);
      if (enabled && manager && sineUtils) {
        try {
          await manager.toggleTheme(await sineUtils.getMods(), options.modId);
        } catch {}
      }
    }
    done(report);
  })();
`;

const sha256 = contents => createHash("sha256").update(contents).digest("hex");

const atomicWriteJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
};

const main = async () => {
  const manifestContents = await readFile(MANIFEST_PATH);
  const bundleContents = Object.fromEntries(
    await Promise.all(
      Object.entries(BUNDLE_PATHS).map(async ([kind, path]) => [
        kind,
        await readFile(path),
      ]),
    ),
  );
  const manifest = JSON.parse(manifestContents);
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
  let signalExitCode = null;
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
  const exitAfterSignal = code => {
    if (signalExitCode !== null) return;
    signalExitCode = code;
    void shutdown()
      .catch(error =>
        console.error(`widget ownership cleanup failed: ${error.stack ?? error}`),
      )
      .finally(() => process.exit(code));
  };
  const onInterrupt = () => exitAfterSignal(130);
  const onTerminate = () => exitAfterSignal(143);
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);

  try {
    client = await openMarionette({ port: zen.port });
    await client.setScriptTimeout(120_000);
    const result = await client.executeAsync(PROBE, [
      {
        buildId: zen.platformStamp.zen.buildId,
        geckoVersion: zen.platformStamp.zen.geckoVersion,
        modId: manifest.id,
        sineVersion: zen.platformStamp.sine.version,
        zenVersion: zen.platformStamp.zen.version,
      },
    ]);
    let assertions = null;
    let validationError = null;
    let verdicts = null;
    try {
      assertions = validateAssertionManifest(result, REQUIRED_ASSERTIONS);
      verdicts = collectVerdicts(assertions);
    } catch (error) {
      validationError = String(error?.stack ?? error);
    }
    const artifact = {
      recordedAt: new Date().toISOString(),
      stagedProduction: {
        bundles: Object.fromEntries(
          Object.entries(bundleContents).map(([kind, contents]) => [
            kind,
            {
              bytes: contents.length,
              path:
                kind === "system"
                  ? "mods/keep-loaded/dist/keep-loaded.sys.mjs"
                  : "mods/keep-loaded/dist/keep-loaded.uc.mjs",
              sha256: sha256(contents),
            },
          ]),
        ),
        manifest: {
          path: "mods/keep-loaded/theme.json",
          sha256: sha256(manifestContents),
          value: manifest,
        },
        relativePaths: PRODUCTION_PATHS,
      },
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
    console.log(`Raw widget ownership evidence: ${OUTPUT}`);
    if (validationError) {
      console.error(validationError);
      process.exitCode = 1;
    } else {
      console.log(`${verdicts.counts.passed}/${verdicts.counts.total} assertions passed`);
      if (!verdicts.ok) process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      `production widget ownership probe failed: ${error.stack ?? error.message}`,
    );
    console.error(zen.output.join("").slice(-4000));
    process.exitCode = 1;
  } finally {
    try {
      await shutdown();
    } finally {
      process.removeListener("SIGINT", onInterrupt);
      process.removeListener("SIGTERM", onTerminate);
    }
  }
};

await main();
