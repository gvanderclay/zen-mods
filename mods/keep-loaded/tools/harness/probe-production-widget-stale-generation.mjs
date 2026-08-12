#!/usr/bin/env node

/** Force retained G1 production panel paths after Sine has installed G2. */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectVerdicts, validateAssertionManifest } from "@zen-mods/live-harness/core";
import { openMarionette } from "@zen-mods/live-harness/marionette";
import { launchLiveZen } from "@zen-mods/live-harness/zen-launcher";
import {
  REQUIRED_ASSERTIONS,
  validateStaleGenerationEvidence,
} from "./production-widget-stale-generation-core.mjs";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MOD_DIRECTORY = resolve(DIRECTORY, "../..");
const REPOSITORY_ROOT = resolve(MOD_DIRECTORY, "../..");
const OUTPUT = resolve(
  REPOSITORY_ROOT,
  ".benchmarks/live/keep-loaded-production-widget-stale-generation.smoke.json",
);
const MANIFEST_PATH = resolve(MOD_DIRECTORY, "theme.json");
const PRODUCTION_PATHS = [
  "dist/keep-loaded.sys.mjs",
  "dist/keep-loaded.uc.mjs",
  "preferences.json",
  "styles/chrome.css",
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
  const json = value => value === undefined ? null : JSON.parse(JSON.stringify(value));
  const report = {
    assertions: [],
    capture: {},
    fatal: null,
    forces: {},
    generation: {},
    owner: {},
    platform: null,
  };
  const retained = {
    facade: null,
    panelDisposer: null,
    panelDisposerForced: false,
    panelDisposerHeld: false,
    panelDisposerStopCalls: 0,
    holdPanelDisposer: false,
    view: null,
    viewShowing: null,
    widgetCreateCalls: 0,
    waitingForPanelDisposer: false,
    wake: {
      errorCalls: 0,
      released: false,
      release: null,
      readyCalls: 0,
      settleCalls: 0,
      settleFinished: false,
      settleFailure: null,
      workSettled: false,
    },
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
  const cachedView = targetWindow =>
    targetWindow.document.getElementById(VIEW_ID) ??
    targetWindow.document.getElementById(CACHE_ID)?.content.querySelector("#" + VIEW_ID) ??
    null;
  const controllerReady = targetWindow => {
    try {
      const facade = targetWindow.zenKeepLoaded;
      return facade?.controller?.isLive() === true &&
        facade.controller.state?.kind === "live" &&
        typeof facade.fillPanel === "function" &&
        Boolean(facade.application?.()?.registrationId) &&
        Boolean(cachedView(targetWindow));
    } catch {
      return false;
    }
  };
  const captureReport = () => ({
    g1Facade: Boolean(retained.facade),
    g1PanelDisposer: typeof retained.panelDisposer === "function",
    g1View: Boolean(retained.view),
    g1WakeCompletion: retained.wake.settleCalls === 1 &&
      retained.wake.workSettled === true && typeof retained.wake.release === "function",
    g1WidgetViewShowing: typeof retained.viewShowing === "function" &&
      retained.widgetCreateCalls === 1,
  });

  const installG1Capture = ui => {
    const facadeDescriptor = Object.getOwnPropertyDescriptor(window, "zenKeepLoaded");
    if (
      facadeDescriptor &&
      (!facadeDescriptor.configurable || !("value" in facadeDescriptor) ||
        facadeDescriptor.writable !== true)
    ) {
      throw new Error("zenKeepLoaded cannot be temporarily intercepted as a writable property");
    }
    const uiDescriptor = Object.getOwnPropertyDescriptor(window, "CustomizableUI");
    if (
      !uiDescriptor || !uiDescriptor.configurable || !("value" in uiDescriptor) ||
      uiDescriptor.writable !== true
    ) {
      throw new Error("window.CustomizableUI cannot be temporarily intercepted");
    }
    const originalCreateWidget = ui.createWidget;
    if (typeof originalCreateWidget !== "function") {
      throw new Error("CustomizableUI.createWidget is unavailable");
    }
    let facadeValue = facadeDescriptor?.value;
    let facadeInstalled = false;
    let uiInstalled = false;

    const captureFacade = candidate => {
      if (!candidate || typeof candidate !== "object" ||
        typeof candidate.fillPanel !== "function" || !candidate.controller) {
        throw new Error("G1 assigned an invalid Keep Loaded facade");
      }
      if (retained.facade && retained.facade !== candidate) {
        throw new Error("captured more than one G1 Keep Loaded facade");
      }
      retained.facade = candidate;
      const controller = candidate.controller;
      const originalDefer = controller.defer;
      const originalSettlePanel = controller.settlePanel;
      if (typeof originalDefer !== "function" || typeof originalSettlePanel !== "function") {
        throw new Error("G1 controller lacks the generation seams needed by this probe");
      }
      const wrappedDefer = disposer => {
        if (retained.waitingForPanelDisposer) {
          if (typeof disposer !== "function" || retained.panelDisposer) {
            throw new Error("G1 panel disposer capture was not one exact deferred callback");
          }
          retained.waitingForPanelDisposer = false;
          retained.panelDisposer = disposer;
          return originalDefer.call(controller, () => {
            retained.panelDisposerStopCalls += 1;
            if (retained.holdPanelDisposer) {
              retained.panelDisposerHeld = true;
              return;
            }
            return disposer();
          });
        }
        return originalDefer.call(controller, disposer);
      };
      const wrappedSettlePanel = (work, onReady, onError) => {
        retained.wake.settleCalls += 1;
        let released = false;
        const heldWork = new Promise((resolve, reject) => {
          Promise.resolve(work).then(
            value => {
              retained.wake.workSettled = true;
              retained.wake.release = () => {
                if (released) return;
                released = true;
                retained.wake.released = true;
                resolve(value);
              };
            },
            error => {
              retained.wake.workSettled = true;
              retained.wake.release = () => {
                if (released) return;
                released = true;
                retained.wake.released = true;
                reject(error);
              };
            },
          );
        });
        const completion = originalSettlePanel.call(
          controller,
          heldWork,
          () => {
            retained.wake.readyCalls += 1;
            return onReady();
          },
          error => {
            retained.wake.errorCalls += 1;
            return onError(error);
          },
        );
        void Promise.resolve(completion).then(
          () => {
            retained.wake.settleFinished = true;
          },
          error => {
            retained.wake.settleFailure = String(error?.stack ?? error);
          },
        );
        return completion;
      };
      controller.defer = wrappedDefer;
      controller.settlePanel = wrappedSettlePanel;
      if (controller.defer !== wrappedDefer || controller.settlePanel !== wrappedSettlePanel) {
        throw new Error("G1 controller methods could not be intercepted");
      }
    };

    Object.defineProperty(window, "zenKeepLoaded", {
      configurable: true,
      enumerable: facadeDescriptor?.enumerable ?? true,
      get: () => facadeValue,
      set: candidate => {
        facadeValue = candidate;
        captureFacade(candidate);
      },
    });
    facadeInstalled = true;

    const wrappedCreateWidget = function (...args) {
      const definition = args[0];
      const value = originalCreateWidget.apply(this, args);
      if (definition?.id === BUTTON_ID) {
        retained.widgetCreateCalls += 1;
        if (retained.widgetCreateCalls !== 1 || typeof definition.onViewShowing !== "function") {
          throw new Error("G1 status widget did not expose one real onViewShowing callback");
        }
        retained.viewShowing = definition.onViewShowing;
        retained.waitingForPanelDisposer = true;
      }
      return value;
    };
    // The real CustomizableUI object is frozen: a Proxy cannot replace its
    // non-configurable createWidget property either. Shadow the writable window
    // reference with a one-generation facade instead. Every other method remains
    // bound to the real frozen object, and only createWidget observes the definition
    // before calling the real implementation.
    const wrappedUi = {};
    for (const property of Reflect.ownKeys(ui)) {
      const descriptor = Object.getOwnPropertyDescriptor(ui, property);
      if (!descriptor) continue;
      if (property === "createWidget") {
        Object.defineProperty(wrappedUi, property, {
          ...descriptor,
          value: wrappedCreateWidget,
        });
        continue;
      }
      if ("value" in descriptor && typeof descriptor.value === "function") {
        Object.defineProperty(wrappedUi, property, {
          ...descriptor,
          value: descriptor.value.bind(ui),
        });
      } else {
        Object.defineProperty(wrappedUi, property, descriptor);
      }
    }
    Object.defineProperty(window, "CustomizableUI", {
      configurable: true,
      enumerable: uiDescriptor.enumerable,
      value: wrappedUi,
      writable: true,
    });
    if (window.CustomizableUI !== wrappedUi) {
      throw new Error("window.CustomizableUI proxy replacement was ignored");
    }
    uiInstalled = true;

    return {
      restore: () => {
        const errors = [];
        if (uiInstalled) {
          try {
            Object.defineProperty(window, "CustomizableUI", uiDescriptor);
          } catch (error) {
            errors.push(String(error?.stack ?? error));
          }
          uiInstalled = false;
        }
        if (facadeInstalled) {
          try {
            Object.defineProperty(window, "zenKeepLoaded", {
              configurable: facadeDescriptor?.configurable ?? true,
              enumerable: facadeDescriptor?.enumerable ?? true,
              value: facadeValue,
              writable: facadeDescriptor?.writable ?? true,
            });
          } catch (error) {
            errors.push(String(error?.stack ?? error));
          }
          facadeInstalled = false;
        }
        if (errors.length > 0) {
          throw new Error("could not restore G1 capture hooks: " + errors.join("; "));
        }
      },
    };
  };

  (async () => {
    let enabled = false;
    let hooks = null;
    let manager = null;
    let owner = null;
    let sineUtils = null;
    let observer = null;
    try {
      manager = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/manager.sys.mjs",
      ).default;
      sineUtils = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/utils.sys.mjs",
      ).default;
      await waitFor("primary Sine interface", () =>
        typeof window.addUnloadListener === "function" && window.CustomizableUI,
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
      const initialMods = await sineUtils.getMods();
      check(
        "production mod starts disabled",
        initialMods[options.modId]?.enabled === false && !window.zenKeepLoaded,
        JSON.stringify({ enabled: initialMods[options.modId]?.enabled }),
      );

      const ui = window.CustomizableUI;
      hooks = installG1Capture(ui);
      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = true;
      await waitFor("G1 production controller", () => controllerReady(window));
      await waitFor(
        "G1 real widget callback and panel disposer capture",
        () => retained.facade && retained.viewShowing && retained.panelDisposer &&
          retained.waitingForPanelDisposer === false,
      );
      hooks.restore();
      hooks = null;

      const oldFacade = retained.facade;
      const oldController = oldFacade.controller;
      const oldRegistration = oldFacade.application();
      const oldView = cachedView(window);
      retained.view = oldView;
      if (!oldView) throw new Error("G1 panel view disappeared before the wake command");
      const oldWakeButton = oldView.querySelector("#" + WAKE_ID);
      if (!oldWakeButton) throw new Error("G1 panel has no wake command");
      oldWakeButton.dispatchEvent(new Event("command", { bubbles: true }));
      await waitFor(
        "real G1 panel wake completion to settle behind the probe gate",
        () => retained.wake.settleCalls === 1 && retained.wake.workSettled === true &&
          typeof retained.wake.release === "function",
      );
      report.capture = captureReport();
      check(
        "real G1 widget and generation callbacks are captured",
        report.capture.g1Facade && report.capture.g1View &&
          report.capture.g1WidgetViewShowing && report.capture.g1PanelDisposer,
        JSON.stringify(report.capture),
      );
      check(
        "real G1 wake completion is paused before reload",
        report.capture.g1WakeCompletion && retained.wake.released === false &&
          retained.wake.settleFinished === false,
        JSON.stringify(retained.wake),
      );

      retained.holdPanelDisposer = true;
      await manager.rebuildMods(true, false);
      await waitFor("G1 controller terminal stop", () => oldController.isLive() === false);
      await waitFor(
        "G1 panel disposer held by its actual generation stop",
        () => retained.panelDisposerHeld === true && retained.panelDisposerStopCalls === 1,
      );
      await waitFor(
        "replacement G2 production controller",
        () => controllerReady(window) && window.zenKeepLoaded.controller !== oldController,
      );
      owner = ChromeUtils.importESModule(OWNER_URI);
      await waitFor("G2 owner idle with one widget lease", () => {
        const snapshot = owner.snapshot();
        return snapshot.protocol === options.expectedProtocol &&
          snapshot.registrationCount === 1 && snapshot.activeCount === 0 &&
          snapshot.keyRecords === 0 && snapshot.statusWidgetLeases === 1 &&
          snapshot.statusWidgetPhase === "present";
      });
      const g2Facade = window.zenKeepLoaded;
      const g2Controller = g2Facade.controller;
      const g2Registration = g2Facade.application();
      const g2View = cachedView(window);
      const g2Widget = ui.getWidget(BUTTON_ID);
      if (!g2View || !g2Widget) throw new Error("G2 did not retain a panel view and widget");
      report.owner.g2 = json(owner.snapshot());
      report.generation = {
        controllerReplaced: g2Controller !== oldController,
        g1RegistrationId: oldRegistration.registrationId,
        g1Stopped: oldController.isLive() === false,
        g2Current: g2Controller.isLive() === true && cachedView(window) === g2View &&
          ui.getWidget(BUTTON_ID) === g2Widget,
        g2RegistrationId: g2Registration.registrationId,
        ownerApplicationPreserved:
          oldRegistration.applicationId === g2Registration.applicationId &&
          g2Registration.applicationId === owner.applicationId,
        registrationReplaced: oldRegistration.registrationId !== g2Registration.registrationId,
      };
      check(
        "Sine reload replaces G1 with one live G2 widget lease",
        report.generation.controllerReplaced && report.generation.g1Stopped &&
          report.generation.g2Current && report.generation.registrationReplaced &&
          report.generation.ownerApplicationPreserved &&
          report.owner.g2.statusWidgetLeaseIds.includes(g2Registration.registrationId),
        JSON.stringify({ generation: report.generation, owner: report.owner.g2 }),
      );

      const mutationRecords = [];
      observer = new MutationObserver(records => {
        for (const record of records) {
          mutationRecords.push({
            attributeName: record.attributeName ?? null,
            type: record.type,
          });
        }
      });
      observer.observe(g2View, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });
      const currentState = () => {
        const facade = window.zenKeepLoaded;
        const registration = facade?.application?.();
        const view = cachedView(window);
        const widget = ui.getWidget(BUTTON_ID);
        const body = view?.querySelector("#" + BODY_ID);
        const action = view?.querySelector("#" + WAKE_ID);
        const evidence = {
          body: {
            childCount: body?.childElementCount ?? null,
            heading: body?.querySelector(".keep-loaded-panel-total")?.getAttribute("value") ?? null,
            wakeLabel: action?.getAttribute("label") ?? null,
          },
          current: {
            controller: facade?.controller === g2Controller,
            facade: facade === g2Facade,
            view: view === g2View,
            widget: widget === g2Widget,
          },
          owner: json(owner.snapshot()),
          registrationId: registration?.registrationId ?? null,
          widget: {
            placement: json(ui.getPlacementOfWidget(BUTTON_ID)),
            provider: widget?.provider ?? null,
          },
        };
        return {
          evidence,
          refs: { controller: facade?.controller, facade, view, widget },
        };
      };
      const sameCurrent = (before, after) =>
        before.refs.facade === after.refs.facade &&
        before.refs.controller === after.refs.controller &&
        before.refs.view === after.refs.view &&
        before.refs.widget === after.refs.widget &&
        JSON.stringify(before.evidence) === JSON.stringify(after.evidence);
      const forceRetained = async (key, invoke, extras = () => ({})) => {
        const before = currentState();
        const mutationStart = mutationRecords.length;
        let error = null;
        try {
          await invoke();
        } catch (caught) {
          error = String(caught?.stack ?? caught);
        }
        await Promise.resolve();
        await Promise.resolve();
        const after = currentState();
        const force = {
          after: after.evidence,
          before: before.evidence,
          error,
          invoked: true,
          mutationDelta: mutationRecords.length - mutationStart,
          stable: error === null && sameCurrent(before, after) &&
            mutationRecords.length === mutationStart,
          ...extras(),
        };
        report.forces[key] = force;
        return force;
      };

      const facadeForce = await forceRetained("facadeFill", () => {
        oldFacade.fillPanel(g2View);
      });
      check(
        "retained G1 facade fill cannot mutate G2",
        facadeForce.stable,
        JSON.stringify(facadeForce),
      );

      const viewForce = await forceRetained("viewShowing", () => {
        retained.viewShowing({ target: oldView });
      });
      check(
        "retained G1 widget view callback cannot mutate G2",
        viewForce.stable,
        JSON.stringify(viewForce),
      );

      const disposerForce = await forceRetained(
        "panelDisposer",
        () => {
          if (typeof retained.panelDisposer !== "function") {
            throw new Error("the retained G1 panel disposer is missing");
          }
          retained.panelDisposerForced = true;
          retained.panelDisposer();
        },
        () => ({
          held: retained.panelDisposerHeld,
          stopCalls: retained.panelDisposerStopCalls,
        }),
      );
      check(
        "retained G1 panel disposer cannot mutate G2",
        disposerForce.stable && disposerForce.held === true && disposerForce.stopCalls === 1,
        JSON.stringify(disposerForce),
      );

      const wakeForce = await forceRetained(
        "wakeCompletion",
        async () => {
          if (typeof retained.wake.release !== "function") {
            throw new Error("the retained G1 wake completion is missing");
          }
          retained.wake.release();
          await waitFor(
            "retained G1 wake completion after G2 replacement",
            () => retained.wake.settleFinished === true || retained.wake.settleFailure !== null,
          );
          if (retained.wake.settleFailure) {
            throw new Error(retained.wake.settleFailure);
          }
        },
        () => ({
          completion: {
            errorCalls: retained.wake.errorCalls,
            readyCalls: retained.wake.readyCalls,
            released: retained.wake.released,
            settleFinished: retained.wake.settleFinished,
            workSettled: retained.wake.workSettled,
          },
        }),
      );
      check(
        "retained G1 wake completion cannot mutate G2",
        wakeForce.stable && wakeForce.completion.readyCalls === 0 &&
          wakeForce.completion.errorCalls === 0,
        JSON.stringify(wakeForce),
      );

      observer.disconnect();
      observer = null;
      const currentButton = window.document.getElementById(BUTTON_ID);
      if (!currentButton || typeof currentButton.doCommand !== "function") {
        throw new Error("G2 status widget has no command after stale callbacks");
      }
      currentButton.doCommand();
      await waitFor("G2 normal panel fill", () => {
        const view = cachedView(window);
        const body = view?.querySelector("#" + BODY_ID);
        return view === g2View &&
          Boolean(body?.querySelector(".keep-loaded-panel-total")?.getAttribute("value")) &&
          Boolean(view?.querySelector("#" + WAKE_ID)?.getAttribute("label"));
      });
      const normalView = cachedView(window);
      const normalBody = normalView?.querySelector("#" + BODY_ID);
      const normalPanel = {
        action: normalView?.querySelector("#" + WAKE_ID)?.getAttribute("label") ?? null,
        bodyOwnerIsG2: normalBody?.ownerDocument === window.document,
        heading: normalBody?.querySelector(".keep-loaded-panel-total")?.getAttribute("value") ?? null,
        viewIsG2: normalView === g2View,
      };
      check(
        "G2 panel still fills normally after stale work is forced",
        normalPanel.viewIsG2 && normalPanel.bodyOwnerIsG2 &&
          Boolean(normalPanel.heading) && Boolean(normalPanel.action),
        JSON.stringify(normalPanel),
      );

      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = false;
      await waitFor("G2 owner drain on production disable", () => {
        const snapshot = owner.snapshot();
        return snapshot.registrationCount === 0 && snapshot.activeCount === 0 &&
          snapshot.drainingCount === 0 && snapshot.keyRecords === 0 &&
          snapshot.statusWidgetLeases === 0 && snapshot.statusWidgetPhase === "absent";
      });
      report.owner.final = json(owner.snapshot());
      check(
        "production disable drains the widget owner",
        ui.getWidget(BUTTON_ID) === null &&
          report.owner.final.registrationCount === 0 &&
          report.owner.final.statusWidgetLeases === 0 &&
          report.owner.final.activeCount === 0 && report.owner.final.keyRecords === 0,
        JSON.stringify(report.owner.final),
      );
    } catch (error) {
      report.fatal = String(error?.stack ?? error);
    } finally {
      report.capture = captureReport();
      try {
        observer?.disconnect();
      } catch {}
      try {
        hooks?.restore();
      } catch (error) {
        report.fatal ??= String(error?.stack ?? error);
      }
      if (enabled && manager && sineUtils) {
        try {
          await manager.toggleTheme(await sineUtils.getMods(), options.modId);
          enabled = false;
        } catch {}
      }
      // Only release retained G1 work after current production UI is disabled, so a
      // failing pre-fix bundle cannot damage a still-live G2 while this probe cleans up.
      try {
        if (!retained.wake.released && typeof retained.wake.release === "function") {
          retained.wake.release();
        }
        if (retained.panelDisposerHeld && !retained.panelDisposerForced) {
          retained.panelDisposer?.();
        }
      } catch {}
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
        console.error(`widget stale-generation cleanup failed: ${error.stack ?? error}`),
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
        expectedProtocol: 9,
        geckoVersion: zen.platformStamp.zen.geckoVersion,
        modId: manifest.id,
        sineVersion: zen.platformStamp.sine.version,
        zenVersion: zen.platformStamp.zen.version,
      },
    ]);
    let assertions = null;
    let evidence = null;
    let validationError = null;
    let verdicts = null;
    try {
      assertions = validateAssertionManifest(result, REQUIRED_ASSERTIONS);
      verdicts = collectVerdicts(assertions);
      evidence = validateStaleGenerationEvidence(result);
      if (!evidence.ok) {
        throw new Error(
          `invalid stale-generation evidence: ${JSON.stringify(evidence.failures)}`,
        );
      }
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
      validation: { error: validationError, evidence, verdicts },
      result,
    };
    await atomicWriteJson(OUTPUT, artifact);
    for (const assertion of result?.assertions ?? []) {
      console.log(`  ${assertion.ok ? "PASS" : "FAIL"}  ${assertion.name}`);
      if (!assertion.ok) console.log(`        ${assertion.detail}`);
    }
    console.log(`Raw production widget stale-generation evidence: ${OUTPUT}`);
    if (validationError) {
      console.error(validationError);
      process.exitCode = 1;
    } else {
      console.log(`${verdicts.counts.passed}/${verdicts.counts.total} assertions passed`);
      if (!verdicts.ok) process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      `production widget stale-generation probe failed: ${error.stack ?? error.message}`,
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
