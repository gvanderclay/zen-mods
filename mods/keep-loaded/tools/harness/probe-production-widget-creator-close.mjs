#!/usr/bin/env node

/** Close the widget-creating browser window from a surviving Marionette context. */

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
  ".benchmarks/live/keep-loaded-production-widget-creator-close.smoke.json",
);
const MANIFEST_PATH = resolve(MOD_DIRECTORY, "theme.json");
const PRODUCTION_PATHS = [
  "dist/keep-loaded.sys.mjs",
  "dist/keep-loaded.uc.mjs",
  "preferences.json",
  "styles/chrome.css",
];
const REQUIRED_ASSERTIONS = [
  "exact stamped platform is running",
  "production mod starts disabled",
  "creator and survivor controllers share one owner",
  "one widget identity exists before creator close",
  "creator close leaves the survivor registered",
  "creator close preserves the widget identity",
  "survivor panel fills from the survivor window",
  "disable after creator close destroys the widget",
  "owner drains after creator close and disable",
];

const SETUP = `
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  const BUTTON_ID = "keep-loaded-button";
  const CACHE_ID = "appMenu-viewCache";
  const OWNER_URI = "chrome://sine/content/keep-loaded/dist/keep-loaded.sys.mjs";
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const waitFor = async (name, read, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    let value;
    while (Date.now() < deadline) {
      value = read();
      if (value) return value;
      await wait(25);
    }
    throw new Error("timed out waiting for " + name + "; last value: " + String(value));
  };
  const controllerReady = targetWindow => {
    try {
      return targetWindow.zenKeepLoaded?.controller?.isLive() === true &&
        Boolean(targetWindow.zenKeepLoaded?.application?.()?.registrationId) &&
        Boolean(targetWindow.document.getElementById(CACHE_ID));
    } catch {
      return false;
    }
  };
  const browserWindows = () => {
    const windows = [];
    const enumerator = Services.wm.getEnumerator("navigator:browser");
    while (enumerator.hasMoreElements()) windows.push(enumerator.getNext());
    return windows;
  };
  (async () => {
    try {
      const manager = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/manager.sys.mjs",
      ).default;
      const sineUtils = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/utils.sys.mjs",
      ).default;
      await waitFor("primary Sine interface", () =>
        typeof window.addUnloadListener === "function" && window.CustomizableUI);
      const second = OpenBrowserWindow({ openerWindow: window });
      await waitFor("secondary Sine interface", () =>
        !second.closed && second.gBrowser &&
        typeof second.addUnloadListener === "function" &&
        second.document.getElementById(CACHE_ID));
      const initialMods = await sineUtils.getMods();
      const initial = {
        enabled: initialMods[options.modId]?.enabled === true,
        facade: Boolean(window.zenKeepLoaded),
      };
      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      await Promise.all([
        waitFor("primary controller", () => controllerReady(window)),
        waitFor("secondary controller", () => controllerReady(second)),
      ]);
      const owner = ChromeUtils.importESModule(OWNER_URI);
      await waitFor("two registrations", () => owner.snapshot().registrationCount === 2);
      const ui = window.CustomizableUI;
      const widget = ui.getWidget(BUTTON_ID);
      done({
        applicationId: owner.applicationId,
        browserWindows: browserWindows().length,
        initial,
        owner: owner.snapshot(),
        primaryId: String(window.docShell.outerWindowID),
        secondaryId: String(second.docShell.outerWindowID),
        platform: {
          buildId: Services.appinfo.appBuildID,
          geckoVersion: Services.appinfo.platformVersion,
          sineVersion: options.sineVersion,
          zenVersion: Services.appinfo.version,
        },
        widget: {
          placement: ui.getPlacementOfWidget(BUTTON_ID),
          provider: widget?.provider ?? null,
        },
      });
    } catch (error) {
      done({ fatal: String(error?.stack ?? error) });
    }
  })();
`;

const CLOSE_CREATOR = `
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  const BUTTON_ID = "keep-loaded-button";
  const VIEW_ID = "keep-loaded-panelview";
  const BODY_ID = "keep-loaded-panel-body";
  const WAKE_ID = "keep-loaded-wake-button";
  const CACHE_ID = "appMenu-viewCache";
  const OWNER_URI = "chrome://sine/content/keep-loaded/dist/keep-loaded.sys.mjs";
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const waitFor = async (name, read, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    let value;
    while (Date.now() < deadline) {
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
  const targetWindow = outerId => {
    const enumerator = Services.wm.getEnumerator("navigator:browser");
    while (enumerator.hasMoreElements()) {
      const candidate = enumerator.getNext();
      if (String(candidate.docShell?.outerWindowID) === outerId) return candidate;
    }
    return null;
  };
  (async () => {
    try {
      const owner = ChromeUtils.importESModule(OWNER_URI);
      const creator = targetWindow(options.creatorId);
      if (!creator) throw new Error("creator window was not found before close");
      const beforeWidget = CustomizableUI.getWidget(BUTTON_ID);
      creator.document.getElementById("cmd_closeWindow")?.doCommand();
      await waitFor("creator close", () => creator.closed && !browserWindows().includes(creator));
      await waitFor("survivor registration", () => owner.snapshot().registrationCount === 1);
      const afterCloseOwner = owner.snapshot();
      const afterCloseWidget = CustomizableUI.getWidget(BUTTON_ID);
      const afterClosePlacement = CustomizableUI.getPlacementOfWidget(BUTTON_ID);
      const button = window.document.getElementById(BUTTON_ID);
      if (!button || typeof button.doCommand !== "function") {
        throw new Error("survivor has no status button after creator close");
      }
      button.doCommand();
      await waitFor("survivor panel", () => {
        const body = window.document.getElementById(BODY_ID);
        return body?.querySelector(".keep-loaded-panel-heading")?.getAttribute("value") &&
          window.document.getElementById(WAKE_ID)?.getAttribute("label");
      });
      const body = window.document.getElementById(BODY_ID);
      const manager = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/manager.sys.mjs",
      ).default;
      const sineUtils = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/utils.sys.mjs",
      ).default;
      const panel = {
        action: window.document.getElementById(WAKE_ID)?.getAttribute("label") ?? null,
        bodyOwnerIsSurvivor: body?.ownerDocument === window.document,
        heading: body?.querySelector(".keep-loaded-panel-heading")?.getAttribute("value") ?? null,
      };
      const survivorControllerLiveBeforeDisable =
        window.zenKeepLoaded?.controller?.isLive() === true;
      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      await waitFor("owner disable", () => owner.snapshot().registrationCount === 0);
      done({
        afterCloseOwner,
        browserWindows: browserWindows().length,
        finalOwner: owner.snapshot(),
        panel,
        survivorControllerLive: survivorControllerLiveBeforeDisable,
        widgetAfterClose: {
          sameObject: afterCloseWidget === beforeWidget,
          placement: afterClosePlacement,
          provider: afterCloseWidget?.provider ?? null,
        },
        widgetAfterDisable: CustomizableUI.getWidget(BUTTON_ID),
      });
    } catch (error) {
      done({ fatal: String(error?.stack ?? error) });
    }
  })();
`;

const atomicWriteJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
};

const main = async () => {
  const manifestContents = await readFile(MANIFEST_PATH);
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
        console.error(`creator-close cleanup failed: ${error.stack ?? error}`),
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
    const setup = await client.executeAsync(SETUP, [
      {
        buildId: zen.platformStamp.zen.buildId,
        geckoVersion: zen.platformStamp.zen.geckoVersion,
        modId: manifest.id,
        sineVersion: zen.platformStamp.sine.version,
        zenVersion: zen.platformStamp.zen.version,
      },
    ]);
    if (setup.fatal) throw new Error(setup.fatal);
    const handles = await client.command("WebDriver:GetWindowHandles");
    const handleByOuterId = new Map();
    for (const handle of handles) {
      await client.command("WebDriver:SwitchToWindow", { handle });
      const identity = await client.executeAsync(
        "const done=arguments[arguments.length-1]; done(String(window.docShell.outerWindowID));",
      );
      handleByOuterId.set(identity, handle);
    }
    const survivorHandle = handleByOuterId.get(setup.secondaryId);
    if (!survivorHandle) throw new Error("could not map the survivor Marionette handle");
    await client.command("WebDriver:SwitchToWindow", { handle: survivorHandle });
    const close = await client.executeAsync(CLOSE_CREATOR, [
      { creatorId: setup.primaryId, modId: manifest.id },
    ]);
    if (close.fatal) throw new Error(close.fatal);

    const assertions = [
      {
        name: "exact stamped platform is running",
        ok:
          setup.platform.zenVersion === zen.platformStamp.zen.version &&
          setup.platform.buildId === zen.platformStamp.zen.buildId &&
          setup.platform.geckoVersion === zen.platformStamp.zen.geckoVersion,
        detail: JSON.stringify(setup.platform),
      },
      {
        name: "production mod starts disabled",
        ok: setup.initial.enabled === false && setup.initial.facade === false,
        detail: JSON.stringify(setup.initial),
      },
      {
        name: "creator and survivor controllers share one owner",
        ok:
          setup.owner.registrationCount === 2 &&
          setup.applicationId &&
          setup.owner.applicationId === setup.applicationId,
        detail: JSON.stringify(setup.owner),
      },
      {
        name: "one widget identity exists before creator close",
        ok: setup.widget.provider === "api" && Boolean(setup.widget.placement),
        detail: JSON.stringify(setup.widget),
      },
      {
        name: "creator close leaves the survivor registered",
        ok:
          close.browserWindows === 1 &&
          close.survivorControllerLive &&
          close.afterCloseOwner.registrationCount === 1,
        detail: JSON.stringify(close.afterCloseOwner),
      },
      {
        name: "creator close preserves the widget identity",
        ok:
          close.widgetAfterClose.sameObject &&
          close.widgetAfterClose.provider === "api" &&
          Boolean(close.widgetAfterClose.placement),
        detail: JSON.stringify(close.widgetAfterClose),
      },
      {
        name: "survivor panel fills from the survivor window",
        ok:
          close.panel.bodyOwnerIsSurvivor &&
          Boolean(close.panel.heading) &&
          Boolean(close.panel.action),
        detail: JSON.stringify(close.panel),
      },
      {
        name: "disable after creator close destroys the widget",
        ok: close.widgetAfterDisable === null,
        detail: `widget=${String(close.widgetAfterDisable)}`,
      },
      {
        name: "owner drains after creator close and disable",
        ok:
          close.finalOwner.registrationCount === 0 &&
          close.finalOwner.activeCount === 0 &&
          close.finalOwner.drainingCount === 0 &&
          close.finalOwner.keyRecords === 0,
        detail: JSON.stringify(close.finalOwner),
      },
    ];
    const result = {
      assertions,
      fatal: null,
      phases: { close, setup },
      platform: setup.platform,
    };
    let validated = null;
    let validationError = null;
    let verdicts = null;
    try {
      validated = validateAssertionManifest(result, REQUIRED_ASSERTIONS);
      verdicts = collectVerdicts(validated);
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
    for (const assertion of assertions) {
      console.log(`  ${assertion.ok ? "PASS" : "FAIL"}  ${assertion.name}`);
      if (!assertion.ok) console.log(`        ${assertion.detail}`);
    }
    console.log(`Raw creator-close evidence: ${OUTPUT}`);
    if (validationError) {
      console.error(validationError);
      process.exitCode = 1;
    } else {
      console.log(`${verdicts.counts.passed}/${verdicts.counts.total} assertions passed`);
      if (!verdicts.ok) process.exitCode = 1;
    }
  } catch (error) {
    console.error(`creator-close probe failed: ${error.stack ?? error.message}`);
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
