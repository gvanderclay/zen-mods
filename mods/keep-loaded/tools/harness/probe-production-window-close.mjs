#!/usr/bin/env node

/** Close a real secondary Zen window with the shipped Keep Loaded bundle loaded by Sine. */

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
  ".benchmarks/live/keep-loaded-production-window-close.smoke.json",
);
const MANIFEST_PATH = resolve(MOD_DIRECTORY, "theme.json");
const BUNDLE_PATH = resolve(MOD_DIRECTORY, "dist/keep-loaded.uc.mjs");
const PRODUCTION_PATHS = [
  "dist/keep-loaded.uc.mjs",
  "preferences.json",
  "styles/chrome.css",
];

const REQUIRED_ASSERTIONS = [
  "exact stamped platform is running",
  "production mod starts disabled",
  "secondary browser window reaches Sine",
  "Sine loads distinct live production controllers in both windows",
  "secondary controller owns cancellable work before close",
  "exact close emits domwindowclosed then unload without beforeunload",
  "native unload stops the secondary production controller",
  "secondary controller drains its generation resources",
  "secondary window leaves the window mediator",
  "primary production controller remains live",
  "primary status widget survives the secondary close",
  "primary status button still opens and fills its real panel",
];

const PROBE = `
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  const BUTTON_ID = "keep-loaded-button";
  const VIEW_ID = "keep-loaded-panelview";
  const BODY_ID = "keep-loaded-panel-body";
  const WAKE_ID = "keep-loaded-wake-button";
  const MENU_ITEM_ID = "keep-loaded-context-item";
  const CACHE_ID = "appMenu-viewCache";
  const nativeNow = Date.now.bind(Date);
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const report = {
    assertions: [],
    beforeClose: null,
    closeEvents: [],
    fatal: null,
    panelAfterClose: null,
    platform: null,
    secondaryAtUnload: null,
  };
  let eventSequence = 0;
  const progress = label => {
    dump("[keep-loaded production close probe] " + label + "\\n");
  };
  const event = (type, detail = {}) => {
    report.closeEvents.push({ seq: ++eventSequence, type, ...detail });
  };
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
      const controller = targetWindow.zenKeepLoaded?.controller;
      return controller?.isLive() === true &&
        controller.state?.kind === "live" &&
        controller.state.operation?.kind === "idle" &&
        Boolean(cachedView(targetWindow));
    } catch {
      return false;
    }
  };

  (async () => {
    let enabled = false;
    let manager;
    let sineUtils;
    try {
      progress("importing exact Sine manager");
      manager = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/manager.sys.mjs"
      ).default;
      sineUtils = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/utils.sys.mjs"
      ).default;
      await waitFor(
        "primary Sine interface",
        () => typeof window.addUnloadListener === "function" && window.CustomizableUI
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
        Services.appinfo.version + " / " + Services.appinfo.appBuildID +
          " / Gecko " + Services.appinfo.platformVersion + " / Sine " + options.sineVersion,
      );

      const initialMods = await sineUtils.getMods();
      check(
        "production mod starts disabled",
        initialMods[options.modId]?.enabled === false && !window.zenKeepLoaded,
        "enabled=" + String(initialMods[options.modId]?.enabled) +
          ", facade=" + String(Boolean(window.zenKeepLoaded)),
      );

      const initialWindowCount = browserWindows().length;
      progress("opening secondary browser window");
      const secondWindow = OpenBrowserWindow({ openerWindow: window });
      await waitFor(
        "secondary Sine interface",
        () => !secondWindow.closed &&
          secondWindow.gBrowser &&
          secondWindow.CustomizableUI &&
          secondWindow.document.getElementById(CACHE_ID) &&
          typeof secondWindow.addUnloadListener === "function" &&
          browserWindows().length === initialWindowCount + 1,
      );
      check(
        "secondary browser window reaches Sine",
        secondWindow !== window &&
          !secondWindow.closed &&
          secondWindow.location.href === "chrome://browser/content/browser.xhtml" &&
          typeof secondWindow.addUnloadListener === "function",
        secondWindow.location.href + " / " + browserWindows().length + " browser windows",
      );

      progress("enabling staged production mod through Sine");
      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = true;
      await Promise.all([
        waitFor("primary production controller", () => controllerReady(window)),
        waitFor("secondary production controller", () => controllerReady(secondWindow)),
      ]);
      const controllerA = window.zenKeepLoaded.controller;
      const controllerB = secondWindow.zenKeepLoaded.controller;
      const identity = {
        controllersDistinct: controllerA !== controllerB,
        facadesDistinct: window.zenKeepLoaded !== secondWindow.zenKeepLoaded,
        viewsDistinct: cachedView(window) !== cachedView(secondWindow),
      };
      progress("both production controllers are ready");
      check(
        "Sine loads distinct live production controllers in both windows",
        identity.controllersDistinct &&
          identity.facadesDistinct &&
          identity.viewsDistinct &&
          controllerA.isLive() &&
          controllerB.isLive(),
        JSON.stringify({
          ...identity,
          primary: controllerA.state.kind + "/" + controllerA.state.operation.kind,
          secondary: controllerB.state.kind + "/" + controllerB.state.operation.kind,
        }),
      );

      let secondaryDisposals = 0;
      controllerB.defer(() => {
        secondaryDisposals += 1;
      });
      controllerB.sleep(600000);
      report.beforeClose = {
        primaryControllerLive: controllerA.isLive(),
        secondaryControllerLive: controllerB.isLive(),
        secondaryPendingTimers: controllerB.pendingTimers,
        secondaryPendingWaits: controllerB.pendingWaits,
      };
      check(
        "secondary controller owns cancellable work before close",
        controllerB.pendingTimers >= 1 && controllerB.pendingWaits >= 1,
        JSON.stringify(report.beforeClose),
      );

      secondWindow.addEventListener("beforeunload", () => event("beforeunload"));
      secondWindow.addEventListener("unload", () => {
        event("unload");
        try {
          report.secondaryAtUnload = {
            contextItemPresent: Boolean(secondWindow.document.getElementById(MENU_ITEM_ID)),
            controllerLive: controllerB.isLive(),
            controllerState: controllerB.state?.kind ?? null,
            facadeHasController: Boolean(secondWindow.zenKeepLoaded?.controller),
            panelViewPresent: Boolean(cachedView(secondWindow)),
            pendingTimers: controllerB.pendingTimers,
            pendingWaits: controllerB.pendingWaits,
            stopReason: controllerB.stopReason ?? null,
            testDisposals: secondaryDisposals,
          };
        } catch (error) {
          report.secondaryAtUnload = { error: String(error?.stack ?? error) };
        }
      });

      const closed = new Promise(resolve => {
        const observer = {
          observe(subject, topic) {
            if (topic !== "domwindowclosed" || subject !== secondWindow) return;
            Services.obs.removeObserver(observer, "domwindowclosed");
            event("domwindowclosed");
            resolve();
          },
        };
        Services.obs.addObserver(observer, "domwindowclosed");
      });
      const closeCommand = secondWindow.document.getElementById("cmd_closeWindow");
      if (!closeCommand || typeof closeCommand.doCommand !== "function") {
        throw new Error("the secondary window has no executable cmd_closeWindow command");
      }
      event("close-request");
      progress("closing secondary through cmd_closeWindow");
      closeCommand.doCommand();
      await closed;
      await waitFor(
        "secondary native unload snapshot",
        () => report.secondaryAtUnload && !browserWindows().includes(secondWindow),
      );
      event("close-observed");
      progress("secondary native unload observed");

      const signalTypes = report.closeEvents.map(entry => entry.type);
      const domClosedIndex = signalTypes.indexOf("domwindowclosed");
      const unloadIndex = signalTypes.indexOf("unload");
      check(
        "exact close emits domwindowclosed then unload without beforeunload",
        domClosedIndex >= 0 &&
          unloadIndex > domClosedIndex &&
          !signalTypes.includes("beforeunload"),
        JSON.stringify(report.closeEvents),
      );
      check(
        "native unload stops the secondary production controller",
        report.secondaryAtUnload.controllerLive === false &&
          report.secondaryAtUnload.controllerState === "stopped" &&
          report.secondaryAtUnload.stopReason === "window-unload",
        JSON.stringify(report.secondaryAtUnload),
      );
      check(
        "secondary controller drains its generation resources",
        report.secondaryAtUnload.pendingTimers === 0 &&
          report.secondaryAtUnload.pendingWaits === 0 &&
          report.secondaryAtUnload.testDisposals === 1 &&
          report.secondaryAtUnload.facadeHasController === false &&
          report.secondaryAtUnload.contextItemPresent === false &&
          report.secondaryAtUnload.panelViewPresent === false,
        JSON.stringify(report.secondaryAtUnload),
      );
      check(
        "secondary window leaves the window mediator",
        secondWindow.closed && !browserWindows().includes(secondWindow),
        browserWindows().length + " browser window(s) remain",
      );
      check(
        "primary production controller remains live",
        window.zenKeepLoaded?.controller === controllerA &&
          controllerA.isLive() &&
          controllerA.state.kind === "live",
        "live=" + String(controllerA.isLive()) + ", state=" + controllerA.state.kind,
      );

      const widget = CustomizableUI.getWidget(BUTTON_ID);
      const placement = CustomizableUI.getPlacementOfWidget(BUTTON_ID);
      const button = document.getElementById(BUTTON_ID);
      check(
        "primary status widget survives the secondary close",
        widget?.provider === CustomizableUI.PROVIDER_API &&
          Boolean(placement) &&
          Boolean(button?.isConnected),
        "provider=" + String(widget?.provider) +
          ", placement=" + JSON.stringify(placement) +
          ", connected=" + String(button?.isConnected),
      );

      if (!button || typeof button.doCommand !== "function") {
        throw new Error("the surviving status button cannot issue its command");
      }
      progress("opening surviving primary status button");
      button.doCommand();
      await waitFor("primary status panel fill", () => {
        const body = document.getElementById(BODY_ID);
        const heading = body?.querySelector(".keep-loaded-panel-heading");
        const action = document.getElementById(WAKE_ID);
        return heading?.getAttribute("value") && action?.getAttribute("label");
      });
      const body = document.getElementById(BODY_ID);
      const heading = body?.querySelector(".keep-loaded-panel-heading")?.getAttribute("value") ?? null;
      const action = document.getElementById(WAKE_ID)?.getAttribute("label") ?? null;
      report.panelAfterClose = {
        action,
        bodyOwnerIsPrimary: body?.ownerDocument === document,
        heading,
      };
      check(
        "primary status button still opens and fills its real panel",
        report.panelAfterClose.bodyOwnerIsPrimary === true &&
          heading === "nothing kept" &&
          action === "Nothing to wake",
        JSON.stringify(report.panelAfterClose),
      );

      if (enabled) {
        progress("disabling production mod through Sine");
        await manager.toggleTheme(await sineUtils.getMods(), options.modId);
        enabled = false;
        await waitFor(
          "production disable cleanup",
          () => !window.zenKeepLoaded?.controller && !CustomizableUI.getWidget(BUTTON_ID),
        );
      }
      progress("probe complete");
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
  const bundleContents = await readFile(BUNDLE_PATH);
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
        console.error(`production close probe cleanup failed: ${error.stack ?? error}`),
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
        bundle: {
          bytes: bundleContents.length,
          path: "mods/keep-loaded/dist/keep-loaded.uc.mjs",
          sha256: sha256(bundleContents),
        },
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

    console.log(
      `Zen ${result?.platform?.zenVersion ?? "?"} / Sine ${result?.platform?.sineVersion ?? "?"}`,
    );
    for (const assertion of result?.assertions ?? []) {
      console.log(`  ${assertion.ok ? "PASS" : "FAIL"}  ${assertion.name}`);
      if (!assertion.ok) console.log(`        ${assertion.detail}`);
    }
    console.log(`Raw production close evidence: ${OUTPUT}`);
    if (validationError) {
      console.error(validationError);
      process.exitCode = 1;
    } else {
      console.log(`${verdicts.counts.passed}/${verdicts.counts.total} assertions passed`);
      if (!verdicts.ok) process.exitCode = 1;
    }
  } catch (error) {
    console.error(`production close probe failed: ${error.stack ?? error.message}`);
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
