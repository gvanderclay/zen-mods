#!/usr/bin/env node

/** Exercise the shipped Keep Loaded bundle across ownership, reload, close, and drain. */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectVerdicts, validateAssertionManifest } from "./live-core.mjs";
import { openMarionette } from "./live-marionette.mjs";
import { launchLiveZen } from "./live-zen.mjs";
import {
  REQUIRED_ASSERTIONS,
  validateMultiWindowEvidence,
} from "./production-multi-window-core.mjs";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MOD_DIRECTORY = resolve(DIRECTORY, "../..");
const REPOSITORY_ROOT = resolve(MOD_DIRECTORY, "../..");
const OUTPUT = resolve(
  REPOSITORY_ROOT,
  ".benchmarks/live/keep-loaded-production-multi-window.smoke.json",
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
  const MATCH_PREF = "zen.keep-loaded.match";
  const LAZY_PREF = "zen.keep-loaded.lazy-pinned";
  const ON_DEMAND_PREF = "browser.sessionstore.restore_pinned_tabs_on_demand";
  const FRESHEN_PREF = "zen.keep-loaded.freshen-seconds";
  const FRESHEN_HOLD_PREF = "zen.keep-loaded.freshen-hold-seconds";
  const nativeNow = Date.now.bind(Date);
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const json = value => value === undefined ? null : JSON.parse(JSON.stringify(value));
  const report = {
    assertions: [],
    capture: {},
    close: null,
    disable: null,
    fatal: null,
    forces: {},
    manifest: { supportsUnload: options.supportsUnload === true },
    ownership: null,
    platform: null,
    preferences: {},
    pulse: null,
    reload: null,
    serialization: null,
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
    waitingForPanelDisposer: false,
    wake: {
      armed: false,
      captured: false,
      errorCalls: 0,
      passthroughCalls: 0,
      priorSettleCalls: 0,
      released: false,
      release: null,
      readyCalls: 0,
      settleCalls: 0,
      settleFailure: null,
      settleFinished: false,
      workSettled: false,
    },
    widgetCreateCalls: 0,
  };
  const check = (name, condition, detail) => {
    report.assertions.push({
      detail: String(detail === undefined ? "" : detail),
      name,
      ok: Boolean(condition),
    });
    return Boolean(condition);
  };
  const fail = message => {
    throw new Error(message);
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
  const waitForNativeWindowClose = (targetWindow, onClosed, timeout = 30000) =>
    new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const observerForClose = {
        observe(subject, topic) {
          if (topic !== "domwindowclosed" || subject !== targetWindow) return;
          settle(() => {
            try {
              onClosed();
              resolve();
            } catch (error) {
              reject(error);
            }
          });
        },
      };
      const cleanup = () => {
        if (timer !== null) clearTimeout(timer);
        try {
          Services.obs.removeObserver(observerForClose, "domwindowclosed");
        } catch {}
      };
      const settle = callback => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      try {
        Services.obs.addObserver(observerForClose, "domwindowclosed");
        timer = setTimeout(
          () =>
            settle(() =>
              reject(
                new Error("timed out waiting for native domwindowclosed notification"),
              ),
            ),
          timeout,
        );
      } catch (error) {
        settle(() => reject(error));
      }
    });
  const cachedView = targetWindow =>
    targetWindow.document.getElementById(VIEW_ID) ??
    targetWindow.document.getElementById(CACHE_ID)?.content.querySelector("#" + VIEW_ID) ??
    null;
  const browserWindows = () => {
    const windows = [];
    const enumerator = Services.wm.getEnumerator("navigator:browser");
    while (enumerator.hasMoreElements()) windows.push(enumerator.getNext());
    return windows;
  };
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
  const requestSweepFrom = targetWindow => {
    const action = cachedView(targetWindow)?.querySelector("#" + WAKE_ID);
    if (!action) fail("the target window has no production wake action");
    action.dispatchEvent(new targetWindow.Event("command", { bubbles: true }));
  };
  const fillCurrentPanel = async targetWindow => {
    const button = targetWindow.document.getElementById(BUTTON_ID);
    if (!button || typeof button.doCommand !== "function") {
      fail("the target window has no current Keep Loaded status button");
    }
    button.doCommand();
    await waitFor("current panel fill", () => {
      const view = cachedView(targetWindow);
      const body = view?.querySelector("#" + BODY_ID);
      return Boolean(body?.querySelector(".keep-loaded-panel-heading")?.getAttribute("value")) &&
        Boolean(view?.querySelector("#" + WAKE_ID)?.getAttribute("label"));
    });
  };
  const panel = targetWindow => {
    const view = cachedView(targetWindow);
    const body = view?.querySelector("#" + BODY_ID);
    return {
      action: view?.querySelector("#" + WAKE_ID)?.getAttribute("label") ?? null,
      heading: body?.querySelector(".keep-loaded-panel-heading")?.getAttribute("value") ?? null,
    };
  };
  const ownerIdle = (owner, registrations) => {
    const snapshot = owner.snapshot();
    return snapshot.protocol === options.expectedProtocol &&
      snapshot.registrationCount === registrations &&
      snapshot.activeCount === 0 &&
      snapshot.drainingCount === 0 &&
      snapshot.keyRecords === 0 &&
      snapshot.readyCount === 0 &&
      snapshot.sweepRecords === 0 &&
      snapshot.trailingCount === 0 &&
      snapshot.wakeCandidates === 0 &&
      snapshot.wakePhase === "idle";
  };
  const captureReport = () => ({
    g1Facade: Boolean(retained.facade),
    g1PanelDisposer: typeof retained.panelDisposer === "function",
    g1View: Boolean(retained.view),
    g1WakeCompletion: retained.wake.captured === true && retained.wake.settleCalls === 1 &&
      retained.wake.workSettled === true && typeof retained.wake.release === "function",
    g1WidgetViewShowing: typeof retained.viewShowing === "function" &&
      retained.widgetCreateCalls === 1,
    passthroughSettleCalls: retained.wake.passthroughCalls,
    priorSettleCalls: retained.wake.priorSettleCalls,
  });
  const installG1Capture = ui => {
    const facadeDescriptor = Object.getOwnPropertyDescriptor(window, "zenKeepLoaded");
    if (
      facadeDescriptor &&
      (!facadeDescriptor.configurable || !("value" in facadeDescriptor) ||
        facadeDescriptor.writable !== true)
    ) {
      fail("zenKeepLoaded cannot be intercepted for G1 capture");
    }
    const uiDescriptor = Object.getOwnPropertyDescriptor(window, "CustomizableUI");
    if (
      !uiDescriptor || !uiDescriptor.configurable || !("value" in uiDescriptor) ||
      uiDescriptor.writable !== true
    ) {
      fail("window.CustomizableUI cannot be intercepted for G1 capture");
    }
    const originalCreateWidget = ui.createWidget;
    if (typeof originalCreateWidget !== "function") fail("CustomizableUI.createWidget is absent");
    let facadeValue = facadeDescriptor?.value;
    let facadeInstalled = false;
    let uiInstalled = false;
    const captureFacade = candidate => {
      if (
        !candidate ||
        typeof candidate !== "object" ||
        typeof candidate.fillPanel !== "function" ||
        !candidate.controller
      ) {
        fail("G1 assigned an invalid Keep Loaded facade");
      }
      if (retained.facade && retained.facade !== candidate) {
        fail("captured more than one G1 facade");
      }
      retained.facade = candidate;
      const controller = candidate.controller;
      const originalDefer = controller.defer;
      const originalSettlePanel = controller.settlePanel;
      if (typeof originalDefer !== "function" || typeof originalSettlePanel !== "function") {
        fail("G1 controller lacks defer or settlePanel");
      }
      const wrappedDefer = disposer => {
        if (retained.waitingForPanelDisposer) {
          if (typeof disposer !== "function" || retained.panelDisposer) {
            fail("G1 panel disposer capture was not exact");
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
        if (!retained.wake.armed) {
          retained.wake.passthroughCalls += 1;
          return originalSettlePanel.call(controller, work, onReady, onError);
        }
        if (retained.wake.captured) {
          fail("captured more than one armed G1 panel wake completion");
        }
        retained.wake.armed = false;
        retained.wake.captured = true;
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
        fail("G1 controller interception was ignored");
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
        if (
          retained.widgetCreateCalls !== 1 ||
          typeof definition.onViewShowing !== "function"
        ) {
          fail("G1 status widget did not expose one physical onViewShowing callback");
        }
        retained.viewShowing = definition.onViewShowing;
        retained.waitingForPanelDisposer = true;
      }
      return value;
    };
    const wrappedUi = {};
    for (const property of Reflect.ownKeys(ui)) {
      const descriptor = Object.getOwnPropertyDescriptor(ui, property);
      if (!descriptor) continue;
      if (property === "createWidget") {
        Object.defineProperty(wrappedUi, property, {
          ...descriptor,
          value: wrappedCreateWidget,
        });
      } else if ("value" in descriptor && typeof descriptor.value === "function") {
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
        if (errors.length) fail("could not restore G1 capture hooks: " + errors.join("; "));
      },
    };
  };
  // This controlled lazy fixture proves global sweep serialization. It deliberately
  // does not stand in for the separate real SessionStore rollback transaction gate.
  const createFixture = (targetWindow, label, SessionStore, counters) => {
    const tab = targetWindow.gBrowser.addTab("about:blank", {
      createLazyBrowser: true,
      inBackground: true,
      lazyTabTitle: "keep-loaded multi-window " + label,
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    targetWindow.gBrowser.pinTab(tab);
    SessionStore.setCustomTabValue(tab, "zenKeepLoaded", "true");
    targetWindow.gZenWorkspaces._allStoredTabs = null;
    const originalInsert = targetWindow.gBrowser._insertBrowser;
    const originalLinkedPanel = Object.getOwnPropertyDescriptor(tab, "linkedPanel");
    const fixture = {
      calls: 0,
      held: false,
      inserted: false,
      label,
      originalInsert,
      originalLinkedPanel,
      tab,
      targetWindow,
      release: () => {
        fixture.tab.removeAttribute("pending");
        if (fixture.held) {
          fixture.held = false;
          counters.held -= 1;
        }
      },
      reset: () => {
        fixture.tab.setAttribute("pending", "true");
        fixture.inserted = false;
        if (fixture.held) {
          fixture.held = false;
          counters.held -= 1;
        }
        fixture.targetWindow.gZenWorkspaces._allStoredTabs = null;
      },
      snapshot: () => ({
        calls: fixture.calls,
        connected: fixture.tab.isConnected,
        inserted: fixture.inserted,
        linkedPanel: Boolean(fixture.tab.linkedPanel),
        pending: fixture.tab.hasAttribute("pending"),
      }),
      eligible: () => {
        fixture.targetWindow.gZenWorkspaces._allStoredTabs = null;
        return fixture.tab.pinned &&
          !fixture.tab.selected &&
          fixture.tab.hasAttribute("pending") &&
          !fixture.tab.linkedPanel &&
          SessionStore.getCustomTabValue(fixture.tab, "zenKeepLoaded") === "true" &&
          fixture.targetWindow.gZenWorkspaces.allStoredTabs.includes(fixture.tab);
      },
      restore: () => {
        if (fixture.targetWindow.closed) return;
        fixture.targetWindow.gBrowser._insertBrowser = fixture.originalInsert;
        if (fixture.originalLinkedPanel) {
          Object.defineProperty(fixture.tab, "linkedPanel", fixture.originalLinkedPanel);
        } else {
          delete fixture.tab.linkedPanel;
        }
        fixture.tab.removeAttribute("pending");
        if (fixture.tab.isConnected) {
          fixture.targetWindow.gBrowser.removeTab(fixture.tab, { animate: false });
        }
      },
    };
    Object.defineProperty(tab, "linkedPanel", {
      configurable: true,
      get: () => fixture.inserted ? "keep-loaded-multi-window-" + label : "",
    });
    targetWindow.gBrowser._insertBrowser = function(candidate) {
      if (candidate === tab) {
        fixture.calls += 1;
        fixture.inserted = true;
        if (!fixture.held) {
          fixture.held = true;
          counters.held += 1;
          counters.maxHeld = Math.max(counters.maxHeld, counters.held);
        }
        return;
      }
      return originalInsert.call(this, candidate);
    };
    return fixture;
  };
  const makeSentinel = controller => {
    const sentinel = {
      deferAt: null,
      deferCalls: 0,
      timerFired: false,
      waitStopped: false,
    };
    controller.defer(() => {
      sentinel.deferCalls += 1;
      sentinel.deferAt = nativeNow();
    });
    controller.schedule(60_000, () => {
      sentinel.timerFired = true;
    });
    void controller.wait(new Promise(() => {})).then(result => {
      sentinel.waitStopped = result?.kind === "stopped";
    });
    return sentinel;
  };

  (async () => {
    let enabled = false;
    let firstWindow = window;
    let secondWindow = null;
    let owner = null;
    let manager = null;
    let sineUtils = null;
    let hooks = null;
    let observer = null;
    let preferenceObserver = null;
    let pulseTab = null;
    const fixtures = [];
    const savedPrefs = new Map();
    try {
      manager = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/manager.sys.mjs",
      ).default;
      sineUtils = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/utils.sys.mjs",
      ).default;
      await waitFor(
        "primary Sine interface",
        () => typeof window.addUnloadListener === "function" && Boolean(window.CustomizableUI),
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
      check(
        "manifest retains supportsUnload",
        options.supportsUnload === true,
        String(options.supportsUnload),
      );

      const saveBool = name => {
        const hadUserValue = Services.prefs.prefHasUserValue(name);
        savedPrefs.set(name, {
          hadUserValue,
          type: "bool",
          value: hadUserValue ? Services.prefs.getBoolPref(name) : null,
        });
      };
      const saveString = name => {
        const hadUserValue = Services.prefs.prefHasUserValue(name);
        savedPrefs.set(name, {
          hadUserValue,
          type: "string",
          value: hadUserValue ? Services.prefs.getStringPref(name) : null,
        });
      };
      saveBool(LAZY_PREF);
      saveBool(ON_DEMAND_PREF);
      saveString(MATCH_PREF);
      saveString(FRESHEN_PREF);
      saveString(FRESHEN_HOLD_PREF);
      Services.prefs.setBoolPref(LAZY_PREF, true);
      Services.prefs.setBoolPref(ON_DEMAND_PREF, true);
      Services.prefs.setStringPref(FRESHEN_PREF, "0");
      Services.prefs.setStringPref(FRESHEN_HOLD_PREF, "1");

      const onDemandTrace = [];
      preferenceObserver = {
        observe(subject, topic, name) {
          if (topic === "nsPref:changed" && name === ON_DEMAND_PREF) {
            onDemandTrace.push({
              at: nativeNow(),
              value: Services.prefs.getBoolPref(ON_DEMAND_PREF),
            });
          }
        },
      };
      Services.prefs.addObserver(ON_DEMAND_PREF, preferenceObserver);

      hooks = installG1Capture(firstWindow.CustomizableUI);
      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = true;
      await waitFor("G1 primary controller", () => controllerReady(firstWindow));
      await waitFor(
        "physical G1 widget and panel disposer capture",
        () => retained.facade && retained.viewShowing && retained.panelDisposer &&
          retained.waitingForPanelDisposer === false,
      );
      hooks.restore();
      hooks = null;
      const g1FacadeA = retained.facade;
      const g1ControllerA = g1FacadeA.controller;
      const g1ApplicationA = g1FacadeA.application();
      const g1ViewA = cachedView(firstWindow);
      if (!g1ViewA) fail("G1 creator lost its panel view before B opened");
      retained.view = g1ViewA;

      const initialWindowCount = browserWindows().length;
      secondWindow = OpenBrowserWindow({ openerWindow: firstWindow });
      await waitFor(
        "secondary browser window",
        () => !secondWindow.closed &&
          secondWindow.gBrowser &&
          secondWindow.CustomizableUI &&
          typeof secondWindow.addUnloadListener === "function" &&
          browserWindows().length === initialWindowCount + 1,
      );
      await waitFor("G1 secondary controller", () => controllerReady(secondWindow));
      owner = ChromeUtils.importESModule(OWNER_URI);
      await waitFor("two G1 owner registrations", () => ownerIdle(owner, 2));
      const g1FacadeB = secondWindow.zenKeepLoaded;
      const g1ControllerB = g1FacadeB.controller;
      const g1ApplicationB = g1FacadeB.application();
      const g1ViewB = cachedView(secondWindow);
      if (!g1ViewB) fail("G1 secondary lost its panel view");
      const g1Widget = firstWindow.CustomizableUI.getWidget(BUTTON_ID);
      const g1Owner = json(owner.snapshot());
      const g1RegistrationIds = [
        g1ApplicationA.registrationId,
        g1ApplicationB.registrationId,
      ];
      report.ownership = {
        creatorRegistrationId: g1ApplicationA.registrationId,
        owner: g1Owner,
        registrationIds: g1RegistrationIds,
        sharedWidget: g1Widget?.provider === firstWindow.CustomizableUI.PROVIDER_API &&
          firstWindow.CustomizableUI.getWidget(BUTTON_ID) ===
            secondWindow.CustomizableUI.getWidget(BUTTON_ID),
        viewsDistinct: g1ViewA !== g1ViewB,
      };
      check(
        "G1 first lease creates one widget shared by both windows",
        report.ownership.creatorRegistrationId === g1ApplicationA.registrationId &&
          report.ownership.sharedWidget &&
          report.ownership.viewsDistinct &&
          g1Owner.registrationIds.includes(g1ApplicationA.registrationId) &&
          g1Owner.registrationIds.includes(g1ApplicationB.registrationId),
        JSON.stringify(report.ownership),
      );

      const { SessionStore } = ChromeUtils.importESModule(
        "resource:///modules/sessionstore/SessionStore.sys.mjs",
      );
      const fixtureCounters = { held: 0, maxHeld: 0 };
      const fixtureA = createFixture(firstWindow, "A", SessionStore, fixtureCounters);
      const fixtureB = createFixture(secondWindow, "B", SessionStore, fixtureCounters);
      fixtures.push(fixtureA, fixtureB);
      if (!fixtureA.eligible() || !fixtureB.eligible()) {
        fail("two-window lazy fixtures are not eligible");
      }

      const serializationMonitor = {
        maxActive: 0,
        maxTrailing: 0,
        ownerTrace: [],
      };
      const sampleSerializationOwner = phase => {
        const snapshot = json(owner.snapshot());
        serializationMonitor.maxActive = Math.max(
          serializationMonitor.maxActive,
          snapshot.activeCount,
        );
        serializationMonitor.maxTrailing = Math.max(
          serializationMonitor.maxTrailing,
          snapshot.trailingCount,
        );
        serializationMonitor.ownerTrace.push({ at: nativeNow(), owner: snapshot, phase });
        return snapshot;
      };
      let sampleSerialization = true;
      const serializationSampler = (async () => {
        while (sampleSerialization) {
          sampleSerializationOwner("poll");
          await wait(10);
        }
      })();
      const trueTraceStart = onDemandTrace.length;
      const trueInitial = Services.prefs.getBoolPref(ON_DEMAND_PREF);
      const trueCallsBefore = { a: fixtureA.calls, b: fixtureB.calls };
      requestSweepFrom(firstWindow);
      await waitFor("true-original A held", () => {
        const snapshot = owner.snapshot();
        return fixtureA.calls === 1 &&
          fixtureA.held &&
          snapshot.activeCount === 1 &&
          snapshot.activeKind === "sweep" &&
          snapshot.keyRecords === 1 &&
          snapshot.wakeCandidates === 1 &&
          snapshot.wakePhase === "waiting" &&
          Services.prefs.getBoolPref(ON_DEMAND_PREF) === false;
      });
      const trueDuring = sampleSerializationOwner("held-a");
      const trueHeldCandidate = {
        ...fixtureA.snapshot(),
        callDelta: fixtureA.calls - trueCallsBefore.a,
      };
      fixtureA.release();
      await waitFor(
        "true-original B held while on-demand remains false",
        () => fixtureB.calls === 1 &&
          fixtureB.held &&
          Services.prefs.getBoolPref(ON_DEMAND_PREF) === false,
      );
      const bHeldOnDemand = Services.prefs.getBoolPref(ON_DEMAND_PREF);
      sampleSerializationOwner("held-b");
      for (let revision = 0; revision < 8; revision += 1) {
        Services.prefs.setStringPref(MATCH_PREF, "multi-window-true-" + revision);
      }
      await waitFor("coalesced true-original trailing sweep", () => owner.snapshot().trailingCount === 1);
      sampleSerializationOwner("trailing");
      const bHeldOnDemandBeforeRelease = Services.prefs.getBoolPref(ON_DEMAND_PREF);
      const bHeldCandidate = {
        ...fixtureB.snapshot(),
        callDelta: fixtureB.calls - trueCallsBefore.b,
      };
      fixtureB.release();
      await waitFor(
        "true-original owner idle",
        () => ownerIdle(owner, 2) && Services.prefs.getBoolPref(ON_DEMAND_PREF) === true,
      );
      const trueAfter = sampleSerializationOwner("idle");
      sampleSerialization = false;
      await serializationSampler;
      const trueFanoutCalls = {
        a: fixtureA.calls - trueCallsBefore.a,
        b: fixtureB.calls - trueCallsBefore.b,
      };
      const trueTransitions = onDemandTrace.slice(trueTraceStart).map(entry => entry.value);
      report.preferences.trueOriginal = {
        bHeldCandidate,
        bHeldOnDemand,
        bHeldOnDemandBeforeRelease,
        expectedRegistrationIds: g1RegistrationIds,
        final: Services.prefs.getBoolPref(ON_DEMAND_PREF),
        heldCandidate: trueHeldCandidate,
        initial: trueInitial,
        ownerAfter: trueAfter,
        ownerDuring: trueDuring,
        transitions: trueTransitions,
        wakeObserved: fixtureA.calls === 1 && fixtureB.calls === 1,
      };
      check(
        "original true wake restores true after global serialization",
          report.preferences.trueOriginal.initial === true &&
          report.preferences.trueOriginal.final === true &&
          report.preferences.trueOriginal.bHeldOnDemand === false &&
          report.preferences.trueOriginal.bHeldOnDemandBeforeRelease === false &&
          JSON.stringify(trueTransitions) === JSON.stringify([false, true, false, true]) &&
          fixtureCounters.maxHeld === 1,
        JSON.stringify(report.preferences.trueOriginal),
      );

      Services.prefs.setBoolPref(LAZY_PREF, false);
      Services.prefs.setBoolPref(ON_DEMAND_PREF, false);
      await waitFor(
        "false-original pref reconciliation",
        () => ownerIdle(owner, 2) &&
          owner.snapshot().desiredOnDemand === false &&
          Services.prefs.getBoolPref(ON_DEMAND_PREF) === false,
      );
      fixtureA.reset();
      const falseTraceStart = onDemandTrace.length;
      const falseInitial = Services.prefs.getBoolPref(ON_DEMAND_PREF);
      const callsBeforeFalse = fixtureA.calls;
      requestSweepFrom(firstWindow);
      await waitFor("false-original A held", () => {
        const snapshot = owner.snapshot();
        return fixtureA.calls === callsBeforeFalse + 1 &&
          fixtureA.held &&
          snapshot.activeCount === 1 &&
          snapshot.activeKind === "sweep" &&
          snapshot.keyRecords === 1 &&
          snapshot.wakeCandidates === 1 &&
          snapshot.wakePhase === "waiting" &&
          Services.prefs.getBoolPref(ON_DEMAND_PREF) === false;
      });
      const falseDuring = json(owner.snapshot());
      const falseHeldCandidate = {
        ...fixtureA.snapshot(),
        callDelta: fixtureA.calls - callsBeforeFalse,
      };
      fixtureA.release();
      await waitFor("false-original owner idle", () => ownerIdle(owner, 2));
      const falseAfter = json(owner.snapshot());
      const falseTransitions = onDemandTrace.slice(falseTraceStart).map(entry => entry.value);
      report.preferences.falseOriginal = {
        expectedRegistrationIds: g1RegistrationIds,
        final: Services.prefs.getBoolPref(ON_DEMAND_PREF),
        heldCandidate: falseHeldCandidate,
        initial: falseInitial,
        ownerAfter: falseAfter,
        ownerDuring: falseDuring,
        transitions: falseTransitions,
        wakeObserved: fixtureA.calls === callsBeforeFalse + 1,
      };
      report.serialization = {
        expectedRegistrationIds: g1RegistrationIds,
        fanoutCalls: trueFanoutCalls,
        idle: trueAfter,
        maxActive: serializationMonitor.maxActive,
        maxHeld: fixtureCounters.maxHeld,
        maxTrailing: serializationMonitor.maxTrailing,
        ownerTrace: serializationMonitor.ownerTrace,
        trailingObserved: serializationMonitor.maxTrailing === 1,
      };
      check(
        "original false wake remains false without a true write",
        report.preferences.falseOriginal.initial === false &&
          report.preferences.falseOriginal.final === false &&
          falseTransitions.length === 0,
        JSON.stringify(report.preferences.falseOriginal),
      );
      check(
        "two-window production sweeps serialize and coalesce",
        fixtureCounters.maxHeld === 1 &&
          report.serialization.maxActive === 1 &&
          report.serialization.fanoutCalls.a === 1 &&
          report.serialization.fanoutCalls.b === 1 &&
          report.serialization.trailingObserved,
        JSON.stringify(report.serialization),
      );

      retained.wake.armed = true;
      retained.wake.priorSettleCalls = retained.wake.passthroughCalls;
      requestSweepFrom(firstWindow);
      await waitFor(
        "G1 panel wake completion held before reload",
        () => retained.wake.captured === true &&
          retained.wake.settleCalls === 1 &&
          retained.wake.workSettled === true &&
          typeof retained.wake.release === "function",
      );
      report.capture = captureReport();
      check(
        "real G1 creator callbacks are captured before reload",
        report.capture.g1Facade &&
          report.capture.g1View &&
          report.capture.g1WidgetViewShowing &&
          report.capture.g1PanelDisposer &&
          report.capture.g1WakeCompletion &&
          report.capture.priorSettleCalls >= 2 &&
          report.capture.passthroughSettleCalls === report.capture.priorSettleCalls,
        JSON.stringify(report.capture),
      );
      retained.holdPanelDisposer = true;
      await manager.rebuildMods(true, false);
      await waitFor(
        "both G1 controllers terminal",
        () => !g1ControllerA.isLive() && !g1ControllerB.isLive(),
      );
      await waitFor(
        "real G1 panel disposer held at replacement",
        () => retained.panelDisposerHeld === true && retained.panelDisposerStopCalls === 1,
      );
      await Promise.all([
        waitFor(
          "G2 primary controller",
          () => controllerReady(firstWindow) &&
            firstWindow.zenKeepLoaded.controller !== g1ControllerA,
        ),
        waitFor(
          "G2 secondary controller",
          () => controllerReady(secondWindow) &&
            secondWindow.zenKeepLoaded.controller !== g1ControllerB,
        ),
      ]);
      await waitFor("G2 owner idle", () => ownerIdle(owner, 2));
      const g2FacadeA = firstWindow.zenKeepLoaded;
      const g2FacadeB = secondWindow.zenKeepLoaded;
      const g2ControllerA = g2FacadeA.controller;
      const g2ControllerB = g2FacadeB.controller;
      const g2ApplicationA = g2FacadeA.application();
      const g2ApplicationB = g2FacadeB.application();
      const g2ViewA = cachedView(firstWindow);
      const g2ViewB = cachedView(secondWindow);
      const g2Widget = firstWindow.CustomizableUI.getWidget(BUTTON_ID);
      if (!g2ViewA || !g2ViewB || !g2Widget) fail("G2 lacks either view or widget");
      await fillCurrentPanel(firstWindow);
      await fillCurrentPanel(secondWindow);
      const currentState = () => {
        const currentA = firstWindow.zenKeepLoaded;
        const currentB = secondWindow.zenKeepLoaded;
        const currentViewA = cachedView(firstWindow);
        const currentViewB = cachedView(secondWindow);
        const applicationA = currentA?.application?.();
        const applicationB = currentB?.application?.();
        const widget = firstWindow.CustomizableUI.getWidget(BUTTON_ID);
        const evidence = {
          owner: json(owner.snapshot()),
          widget: {
            placement: Boolean(firstWindow.CustomizableUI.getPlacementOfWidget(BUTTON_ID)),
            provider: widget?.provider ?? null,
          },
          windows: {
            a: {
              controller: currentA?.controller === g2ControllerA,
              facade: currentA === g2FacadeA,
              panel: panel(firstWindow),
              registrationId: applicationA?.registrationId ?? null,
              view: currentViewA === g2ViewA,
            },
            b: {
              controller: currentB?.controller === g2ControllerB,
              facade: currentB === g2FacadeB,
              panel: panel(secondWindow),
              registrationId: applicationB?.registrationId ?? null,
              view: currentViewB === g2ViewB,
            },
          },
        };
        return {
          evidence,
          refs: {
            controllerA: currentA?.controller,
            controllerB: currentB?.controller,
            facadeA: currentA,
            facadeB: currentB,
            viewA: currentViewA,
            viewB: currentViewB,
            widget,
          },
        };
      };
      const sameCurrent = (before, after) =>
        before.refs.controllerA === after.refs.controllerA &&
        before.refs.controllerB === after.refs.controllerB &&
        before.refs.facadeA === after.refs.facadeA &&
        before.refs.facadeB === after.refs.facadeB &&
        before.refs.viewA === after.refs.viewA &&
        before.refs.viewB === after.refs.viewB &&
        before.refs.widget === after.refs.widget &&
        JSON.stringify(before.evidence) === JSON.stringify(after.evidence);
      const g2Current = currentState();
      report.reload = {
        applicationPreserved:
          g1ApplicationA.applicationId === g2ApplicationA.applicationId &&
          g1ApplicationB.applicationId === g2ApplicationB.applicationId &&
          g2ApplicationA.applicationId === owner.applicationId,
        controllersReplaced:
          g2ControllerA !== g1ControllerA && g2ControllerB !== g1ControllerB,
        current: g2Current.evidence,
        g1ApplicationId: g1ApplicationA.applicationId,
        g1RegistrationIds: [g1ApplicationA.registrationId, g1ApplicationB.registrationId],
        g1Stopped: !g1ControllerA.isLive() && !g1ControllerB.isLive(),
        g2ARegistrationId: g2ApplicationA.registrationId,
        g2ApplicationId: g2ApplicationA.applicationId,
        g2BRegistrationId: g2ApplicationB.registrationId,
        g2RegistrationIds: [g2ApplicationA.registrationId, g2ApplicationB.registrationId],
        owner: json(owner.snapshot()),
        registrationsReplaced:
          ![g1ApplicationA.registrationId, g1ApplicationB.registrationId].includes(
            g2ApplicationA.registrationId,
          ) &&
          ![g1ApplicationA.registrationId, g1ApplicationB.registrationId].includes(
            g2ApplicationB.registrationId,
          ),
        viewsReplaced: g2ViewA !== g1ViewA && g2ViewB !== g1ViewB,
      };
      check(
        "Sine reload replaces both live generations on the stable owner",
        report.reload.applicationPreserved &&
          report.reload.controllersReplaced &&
          report.reload.g1Stopped &&
          report.reload.registrationsReplaced &&
          report.reload.viewsReplaced &&
          new Set(report.reload.g1RegistrationIds).size === 2 &&
          new Set(report.reload.g2RegistrationIds).size === 2,
        JSON.stringify(report.reload),
      );

      const mutationA = [];
      const mutationB = [];
      const observeMutations = (view, records) => {
        const observerForView = new MutationObserver(items => {
          for (const item of items) records.push(item.type);
        });
        observerForView.observe(view, {
          attributes: true,
          characterData: true,
          childList: true,
          subtree: true,
        });
        return observerForView;
      };
      const observerA = observeMutations(g2ViewA, mutationA);
      const observerB = observeMutations(g2ViewB, mutationB);
      observer = {
        disconnect() {
          observerA.disconnect();
          observerB.disconnect();
        },
      };
      const forceRetained = async (key, invoke, extras = () => ({})) => {
        const before = currentState();
        const startA = mutationA.length;
        const startB = mutationB.length;
        let error = null;
        try {
          await invoke();
        } catch (caught) {
          error = String(caught?.stack ?? caught);
        }
        await Promise.resolve();
        await Promise.resolve();
        await wait(0);
        await waitFor(
          "G2 owner idle after retained " + key,
          () => ownerIdle(owner, 2),
        );
        const after = currentState();
        const mutationDeltas = {
          a: mutationA.length - startA,
          b: mutationB.length - startB,
        };
        const force = {
          after: after.evidence,
          before: before.evidence,
          error,
          invoked: true,
          mutationDelta: mutationDeltas.a + mutationDeltas.b,
          mutationDeltas,
          stable: error === null && sameCurrent(before, after) &&
            mutationDeltas.a === 0 && mutationDeltas.b === 0,
          ...extras(),
        };
        report.forces[key] = force;
        return force;
      };
      const facadeForce = await forceRetained("facadeFill", () => {
        g1FacadeA.fillPanel(g2ViewA);
      });
      check(
        "retained G1 facade fill cannot mutate either G2 window",
        facadeForce.stable,
        JSON.stringify(facadeForce),
      );
      const viewForce = await forceRetained("viewShowing", () => {
        retained.viewShowing({ target: g1ViewA });
      });
      check(
        "retained G1 widget view callback cannot mutate either G2 window",
        viewForce.stable,
        JSON.stringify(viewForce),
      );
      const disposerForce = await forceRetained(
        "panelDisposer",
        () => {
          retained.panelDisposerForced = true;
          retained.panelDisposer();
        },
        () => ({
          held: retained.panelDisposerHeld,
          stopCalls: retained.panelDisposerStopCalls,
        }),
      );
      check(
        "retained G1 panel disposer cannot mutate either G2 window",
        disposerForce.stable && disposerForce.held && disposerForce.stopCalls >= 1,
        JSON.stringify(disposerForce),
      );
      const wakeForce = await forceRetained(
        "wakeCompletion",
        async () => {
          retained.wake.release();
          await waitFor(
            "retained G1 wake completion",
            () => retained.wake.settleFinished || retained.wake.settleFailure !== null,
          );
          if (retained.wake.settleFailure) fail(retained.wake.settleFailure);
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
        "retained G1 wake completion cannot mutate either G2 window",
        wakeForce.stable &&
          wakeForce.completion.readyCalls === 0 &&
          wakeForce.completion.errorCalls === 0,
        JSON.stringify(wakeForce),
      );
      observer.disconnect();
      observer = null;
      await fillCurrentPanel(firstWindow);
      await fillCurrentPanel(secondWindow);

      fixtureB.reset();
      const closeSentinel = makeSentinel(g2ControllerB);
      const closeCallsBefore = fixtureB.calls;
      requestSweepFrom(secondWindow);
      await waitFor("G2 B held candidate before native close", () => {
        const snapshot = owner.snapshot();
        return fixtureB.calls === closeCallsBefore + 1 &&
          fixtureB.held &&
          snapshot.activeCount === 1 &&
          snapshot.activeKind === "sweep" &&
          snapshot.keyRecords === 1 &&
          snapshot.wakeCandidates === 1 &&
          snapshot.wakePhase === "waiting" &&
          Services.prefs.getBoolPref(ON_DEMAND_PREF) === false;
      });
      const closeHeldCandidate = {
        ...fixtureB.snapshot(),
        callDelta: fixtureB.calls - closeCallsBefore,
      };
      let closeEventSequence = 0;
      const closeEvents = {
        beforeUnloadSeen: false,
        domwindowclosedAt: null,
        domwindowclosedSeq: null,
        unloadAt: null,
        unloadSeq: null,
      };
      let bAtUnload = null;
      secondWindow.addEventListener("beforeunload", () => {
        closeEvents.beforeUnloadSeen = true;
      });
      secondWindow.addEventListener("unload", () => {
        closeEvents.unloadAt = nativeNow();
        closeEvents.unloadSeq = ++closeEventSequence;
        try {
          bAtUnload = {
            pendingTimers: g2ControllerB.pendingTimers,
            pendingWaits: g2ControllerB.pendingWaits,
            reason: g2ControllerB.stopReason ?? null,
            stopped: !g2ControllerB.isLive() && g2ControllerB.state?.kind === "stopped",
          };
        } catch (error) {
          bAtUnload = { error: String(error?.stack ?? error) };
        }
      });
      const nativeClosed = waitForNativeWindowClose(secondWindow, () => {
        closeEvents.domwindowclosedAt = nativeNow();
        closeEvents.domwindowclosedSeq = ++closeEventSequence;
      });
      const closeCommand = secondWindow.document.getElementById("cmd_closeWindow");
      if (!closeCommand || typeof closeCommand.doCommand !== "function") {
        fail("G2 B has no executable cmd_closeWindow");
      }
      closeCommand.doCommand();
      await nativeClosed;
      await waitFor(
        "G2 B unload and owner settlement",
        () => bAtUnload !== null &&
          ownerIdle(owner, 1) &&
          owner.snapshot().registrationIds.includes(g2ApplicationA.registrationId),
      );
      await waitFor("G2 B sentinel stopped", () => closeSentinel.waitStopped === true);
      const closeOwner = json(owner.snapshot());
      const survivingWidget = firstWindow.CustomizableUI.getWidget(BUTTON_ID);
      await fillCurrentPanel(firstWindow);
      report.close = {
        closedController: bAtUnload,
        closedRegistrationId: g2ApplicationB.registrationId,
        creator: {
          panelFills: Boolean(panel(firstWindow).heading) && Boolean(panel(firstWindow).action),
          registrationId: g2ApplicationA.registrationId,
          widgetPreserved: survivingWidget === g2Widget &&
            survivingWidget?.provider === firstWindow.CustomizableUI.PROVIDER_API,
        },
        events: closeEvents,
        heldCandidate: closeHeldCandidate,
        owner: closeOwner,
        secondaryClosed: secondWindow.closed && !browserWindows().includes(secondWindow),
        sentinel: closeSentinel,
      };
      check(
        "native B close drains only that production generation",
        report.close.secondaryClosed &&
          report.close.closedRegistrationId === g2ApplicationB.registrationId &&
          report.close.closedController?.stopped === true &&
          report.close.closedController?.reason === "window-unload" &&
          report.close.events.beforeUnloadSeen === false &&
          report.close.events.domwindowclosedSeq < report.close.events.unloadSeq &&
          closeOwner.registrationCount === 1 &&
          closeOwner.registrationIds.includes(g2ApplicationA.registrationId) &&
          !closeOwner.registrationIds.includes(g2ApplicationB.registrationId),
        JSON.stringify(report.close),
      );
      check(
        "native B close preserves creator A widget and panel",
        report.close.creator.widgetPreserved &&
          report.close.creator.panelFills &&
          firstWindow.zenKeepLoaded?.controller === g2ControllerA &&
          g2ControllerA.isLive(),
        JSON.stringify(report.close.creator),
      );

      fixtureA.reset();
      const disableSentinelA = makeSentinel(g2ControllerA);
      const disableCallsBefore = fixtureA.calls;
      requestSweepFrom(firstWindow);
      await waitFor("G2 A held candidate before active Sine disable", () => {
        const snapshot = owner.snapshot();
        return fixtureA.calls === disableCallsBefore + 1 &&
          fixtureA.held &&
          snapshot.protocol === options.expectedProtocol &&
          snapshot.registrationCount === 1 &&
          snapshot.statusWidgetLeases === 1 &&
          snapshot.statusWidgetPhase === "present" &&
          snapshot.desiredOnDemand === false &&
          snapshot.activeCount === 1 &&
          snapshot.activeKind === "sweep" &&
          snapshot.keyRecords === 1 &&
          snapshot.wakeCandidates === 1 &&
          snapshot.wakePhase === "waiting";
      });
      const activeBeforeDisable = {
        aRegistrationId: g2ApplicationA.registrationId,
        aWidgetPresent: firstWindow.CustomizableUI.getWidget(BUTTON_ID) === g2Widget,
        bTerminal: secondWindow.closed && !g2ControllerB.isLive(),
        heldCandidate: {
          ...fixtureA.snapshot(),
          callDelta: fixtureA.calls - disableCallsBefore,
        },
        owner: json(owner.snapshot()),
      };
      const enabledBeforeDisable = (await sineUtils.getMods())[options.modId]?.enabled;
      const disablePromise = manager.toggleTheme(await sineUtils.getMods(), options.modId);
      // The controlled serialization fixture models a candidate that SessionStore starts
      // while Sine is cancelling it. It is intentionally not a rollback substitute.
      await waitFor(
        "active Sine disable callback before fixture release",
        () => disableSentinelA.deferCalls === 1,
      );
      fixtureA.release();
      const fixtureReleasedAt = nativeNow();
      await disablePromise;
      enabled = false;
      await waitFor(
        "first active Sine disable drain",
        () => !firstWindow.zenKeepLoaded?.controller &&
          firstWindow.CustomizableUI.getWidget(BUTTON_ID) === null &&
          ownerIdle(owner, 0),
      );
      await waitFor("first disable sentinel", () => disableSentinelA.waitStopped === true);
      const enabledAfterDisable = (await sineUtils.getMods())[options.modId]?.enabled;
      report.disable = {
        activeBeforeDisable,
        actualSineDisable: {
          callbackBeforeFixtureRelease: disableSentinelA.deferAt <= fixtureReleasedAt,
          callbackAt: disableSentinelA.deferAt,
          callbackDelivered: disableSentinelA.deferCalls === 1,
          enabledAfter: enabledAfterDisable,
          enabledBefore: enabledBeforeDisable,
          fixtureReleasedAt,
        },
        controllers: {
          a: {
            pendingTimers: g2ControllerA.pendingTimers,
            pendingWaits: g2ControllerA.pendingWaits,
            stopped: !g2ControllerA.isLive() && g2ControllerA.state?.kind === "stopped",
          },
          b: {
            pendingTimers: g2ControllerB.pendingTimers,
            pendingWaits: g2ControllerB.pendingWaits,
            stopped: !g2ControllerB.isLive() && g2ControllerB.state?.kind === "stopped",
          },
        },
        firstDrain: {
          owner: json(owner.snapshot()),
          widget: {
            placement: Boolean(firstWindow.CustomizableUI.getPlacementOfWidget(BUTTON_ID)),
            present: firstWindow.CustomizableUI.getWidget(BUTTON_ID) !== null,
          },
          windows: {
            aPanel: Boolean(cachedView(firstWindow)),
            bPanel: false,
          },
        },
        sentinels: { a: disableSentinelA, b: closeSentinel },
      };
      check(
        "active Sine disable drains every owned production resource",
          report.disable.actualSineDisable.enabledBefore === true &&
          report.disable.actualSineDisable.enabledAfter === false &&
          report.disable.actualSineDisable.callbackDelivered &&
          report.disable.actualSineDisable.callbackBeforeFixtureRelease &&
          report.disable.controllers.a.stopped &&
          report.disable.controllers.b.stopped &&
          report.disable.firstDrain.owner.registrationCount === 0 &&
          report.disable.firstDrain.owner.statusWidgetLeases === 0 &&
          report.disable.firstDrain.widget.present === false &&
          report.disable.firstDrain.widget.placement === false,
        JSON.stringify(report.disable),
      );
      check(
        "last active registration disable destroys the application widget",
        report.disable.firstDrain.owner.statusWidgetPhase === "absent" &&
          report.disable.firstDrain.widget.present === false,
        JSON.stringify(report.disable.firstDrain),
      );

      fixtureA.restore();
      const createPulseTab = async phase => {
        const tab = firstWindow.gBrowser.addTab(
          "data:text/html,<title>keep-loaded-pulse-" + phase + "</title><p>pulse</p>",
          {
            inBackground: true,
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
          },
        );
        firstWindow.gBrowser.pinTab(tab);
        SessionStore.setCustomTabValue(tab, "zenKeepLoaded", "true");
        firstWindow.gZenWorkspaces._allStoredTabs = null;
        await waitFor(
          "background " + phase + " pulse tab browser",
          () => tab.isConnected && Boolean(tab.linkedPanel) && Boolean(tab.linkedBrowser),
        );
        if (tab.linkedBrowser?.docShellIsActive === true) {
          tab.linkedBrowser.docShellIsActive = false;
        }
        await waitFor(
          "inactive " + phase + " pulse baseline",
          () => tab.linkedBrowser?.docShellIsActive === false,
        );
        return tab;
      };
      pulseTab = await createPulseTab("first");
      const pulseActive = () => pulseTab?.linkedBrowser?.docShellIsActive === true;
      Services.prefs.setStringPref(FRESHEN_PREF, "8");
      Services.prefs.setStringPref(FRESHEN_HOLD_PREF, "1");
      const firstEnableAt = nativeNow();
      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = true;
      await waitFor("pulse generation controller", () => controllerReady(firstWindow));
      const firstActiveAt = await waitFor("immediate first pulse activation", () =>
        pulseActive() ? nativeNow() : 0,
      );
      const firstReleasedAt = await waitFor("first pulse release", () =>
        !pulseActive() ? nativeNow() : 0,
      );
      const oldDeadlineEarliestAt = firstEnableAt + 8_000;
      const oldDeadlineLatestAt = firstActiveAt + 8_000;
      if (nativeNow() > oldDeadlineEarliestAt) {
        fail("first pulse took too long to disable before its old scheduler deadline range");
      }
      const disabledAt = nativeNow();
      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = false;
      await waitFor(
        "pulse generation first disable",
        () => !firstWindow.zenKeepLoaded?.controller && ownerIdle(owner, 0),
      );
      if (pulseTab?.isConnected) {
        firstWindow.gBrowser.removeTab(pulseTab, { animate: false });
      }
      pulseTab = null;
      firstWindow.gZenWorkspaces._allStoredTabs = null;
      await wait(3_000);
      pulseTab = await createPulseTab("replacement");
      const replacementEnableAt = nativeNow();
      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = true;
      await waitFor("replacement pulse controller", () => controllerReady(firstWindow));
      const replacementController = firstWindow.zenKeepLoaded.controller;
      const replacementActiveAt = await waitFor(
        "immediate replacement pulse activation",
        () => pulseActive() ? nativeNow() : 0,
      );
      const replacementReleasedAt = await waitFor(
        "replacement pulse release",
        () => !pulseActive() ? nativeNow() : 0,
      );
      // The immediate replacement pulse writes this tab's PulseClaims timestamp. Drop it
      // before monitoring a fresh claim-free kept tab: a leaked old scheduler must not be
      // allowed to skip its only observable candidate because of that new-generation claim.
      if (pulseTab?.isConnected) {
        firstWindow.gBrowser.removeTab(pulseTab, { animate: false });
      }
      pulseTab = await createPulseTab("replacement-sentinel");
      const replacementSentinelReadyAt = nativeNow();
      if (replacementSentinelReadyAt > oldDeadlineEarliestAt) {
        fail("replacement sentinel was not ready before the old deadline range");
      }
      const replacementDeadlineEarliestAt = replacementEnableAt + 8_000;
      const oldObservationStart = oldDeadlineEarliestAt;
      const oldObservationEnd = oldDeadlineLatestAt + 1_250;
      let earlyActiveSamples = 0;
      let earlyActiveStarts = 0;
      let earlyActiveTransitions = 0;
      let earlySamples = 0;
      let oldActiveSamples = 0;
      let oldActiveStarts = 0;
      let oldActiveTransitions = 0;
      let oldSamples = 0;
      let previousEarlyActive = pulseActive();
      let previousOldActive = null;
      while (nativeNow() < replacementDeadlineEarliestAt) {
        await wait(
          Math.min(25, Math.max(1, replacementDeadlineEarliestAt - nativeNow())),
        );
        const at = nativeNow();
        if (at >= replacementDeadlineEarliestAt) break;
        const active = pulseActive();
        earlySamples += 1;
        if (active) earlyActiveSamples += 1;
        if (active !== previousEarlyActive) {
          earlyActiveTransitions += 1;
          if (active) earlyActiveStarts += 1;
          previousEarlyActive = active;
        }
        if (at >= oldObservationStart && at <= oldObservationEnd) {
          oldSamples += 1;
          if (active) oldActiveSamples += 1;
          if (previousOldActive !== null && active !== previousOldActive) {
            oldActiveTransitions += 1;
            if (active) oldActiveStarts += 1;
          }
          previousOldActive = active;
        }
      }
      if (oldSamples === 0) {
        fail("old scheduler deadline range was not sampled after replacement");
      }
      const normalActiveAt = await waitFor(
        "normal replacement pulse after earliest replacement deadline",
        () => pulseActive() && nativeNow() >= replacementDeadlineEarliestAt ? nativeNow() : 0,
        15_000,
      );
      const normalReleasedAt = await waitFor(
        "normal replacement pulse release",
        () => !pulseActive() ? nativeNow() : 0,
      );
      const finalPulseSentinel = makeSentinel(replacementController);
      const finalEnabledBefore = (await sineUtils.getMods())[options.modId]?.enabled;
      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = false;
      await waitFor(
        "terminal pulse disable drain",
        () => !firstWindow.zenKeepLoaded?.controller &&
          firstWindow.CustomizableUI.getWidget(BUTTON_ID) === null &&
          ownerIdle(owner, 0),
      );
      await waitFor("terminal pulse sentinel", () => finalPulseSentinel.waitStopped === true);
      const finalEnabledAfter = (await sineUtils.getMods())[options.modId]?.enabled;
      report.pulse = {
        finalController: {
          pendingTimers: replacementController.pendingTimers,
          pendingWaits: replacementController.pendingWaits,
          stopped: !replacementController.isLive() &&
            replacementController.state?.kind === "stopped",
        },
        finalOwner: json(owner.snapshot()),
        finalSineDisable: {
          callbackDelivered: finalPulseSentinel.deferCalls === 1,
          enabledAfter: finalEnabledAfter,
          enabledBefore: finalEnabledBefore,
        },
        finalWidget: {
          placement: Boolean(firstWindow.CustomizableUI.getPlacementOfWidget(BUTTON_ID)),
          present: firstWindow.CustomizableUI.getWidget(BUTTON_ID) !== null,
        },
        finalWindows: {
          aPanel: Boolean(cachedView(firstWindow)),
          bPanel: false,
        },
        oldDeadlineObservation: {
          activeSamples: oldActiveSamples,
          activeStarts: oldActiveStarts,
          activeTransitions: oldActiveTransitions,
          endAt: oldObservationEnd,
          samples: oldSamples,
          startAt: oldObservationStart,
        },
        oldDeadlineQuiet: oldActiveSamples === 0 &&
          oldActiveStarts === 0 &&
          oldActiveTransitions === 0,
        replacementEarlyObservation: {
          activeSamples: earlyActiveSamples,
          activeStarts: earlyActiveStarts,
          activeTransitions: earlyActiveTransitions,
          endAt: replacementDeadlineEarliestAt,
          samples: earlySamples,
          startAt: replacementReleasedAt,
        },
        replacementSentinel: {
          baselineInactive: pulseActive() === false,
          readyAt: replacementSentinelReadyAt,
        },
        released: firstReleasedAt <= disabledAt &&
          replacementReleasedAt <= oldDeadlineEarliestAt &&
          normalReleasedAt >= normalActiveAt,
        replacementNormalAfterDeadline: normalActiveAt >= replacementDeadlineEarliestAt,
        timing: {
          disabledAt,
          firstActiveAt,
          firstEnableAt,
          firstReleasedAt,
          normalActiveAt,
          normalReleasedAt,
          oldDeadlineEarliestAt,
          oldDeadlineLatestAt,
          replacementActiveAt,
          replacementDeadlineEarliestAt,
          replacementEnableAt,
          replacementReleasedAt,
          replacementSentinelReadyAt,
        },
      };
      check(
        "disabled pulse schedule cannot fire into the replacement generation",
        report.pulse.oldDeadlineQuiet &&
          report.pulse.replacementNormalAfterDeadline &&
          report.pulse.released &&
          report.pulse.replacementSentinel.baselineInactive &&
          report.pulse.finalController.stopped &&
          report.pulse.finalSineDisable.enabledBefore === true &&
          report.pulse.finalSineDisable.enabledAfter === false,
        JSON.stringify(report.pulse),
      );
      check(
        "supportsUnload is justified by the complete final drain",
        options.supportsUnload === true &&
          report.pulse.finalOwner.registrationCount === 0 &&
          report.pulse.finalOwner.statusWidgetLeases === 0 &&
          report.pulse.finalOwner.activeCount === 0 &&
          report.pulse.finalWidget.present === false &&
          report.pulse.finalWidget.placement === false &&
          report.pulse.finalWindows.aPanel === false &&
          report.pulse.finalWindows.bPanel === false,
        JSON.stringify({
          manifest: report.manifest,
          pulse: report.pulse,
        }),
      );
    } catch (error) {
      report.fatal = String(error?.stack ?? error);
    } finally {
      try {
        observer?.disconnect();
      } catch {}
      try {
        if (preferenceObserver) Services.prefs.removeObserver(ON_DEMAND_PREF, preferenceObserver);
      } catch {}
      try {
        hooks?.restore();
      } catch (error) {
        report.fatal = report.fatal ?? String(error?.stack ?? error);
      }
      try {
        if (enabled && manager && sineUtils) {
          await manager.toggleTheme(await sineUtils.getMods(), options.modId);
        }
      } catch {}
      try {
        for (const fixture of fixtures) fixture.restore();
      } catch {}
      try {
        if (pulseTab?.isConnected && !firstWindow.closed) {
          firstWindow.gBrowser.removeTab(pulseTab, { animate: false });
        }
      } catch {}
      try {
        for (const [name, saved] of savedPrefs) {
          if (saved.hadUserValue) {
            if (saved.type === "bool") Services.prefs.setBoolPref(name, saved.value);
            else Services.prefs.setStringPref(name, saved.value);
          } else {
            Services.prefs.clearUserPref(name);
          }
        }
      } catch (error) {
        report.fatal = report.fatal ?? String(error?.stack ?? error);
      }
      done(report);
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
        console.error(
          `production multi-window probe cleanup failed: ${error.stack ?? error}`,
        ),
      )
      .finally(() => process.exit(code));
  };
  const onInterrupt = () => exitAfterSignal(130);
  const onTerminate = () => exitAfterSignal(143);
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);

  try {
    client = await openMarionette({ port: zen.port });
    await client.setScriptTimeout(180_000);
    const result = await client.executeAsync(PROBE, [
      {
        buildId: zen.platformStamp.zen.buildId,
        expectedProtocol: 8,
        geckoVersion: zen.platformStamp.zen.geckoVersion,
        modId: manifest.id,
        sineVersion: zen.platformStamp.sine.version,
        supportsUnload: manifest.supportsUnload === true,
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
      evidence = validateMultiWindowEvidence(result);
      if (!evidence.ok) {
        throw new Error(
          `invalid multi-window evidence: ${JSON.stringify(evidence.failures)}`,
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
    console.log(`Raw production multi-window evidence: ${OUTPUT}`);
    if (validationError) {
      console.error(validationError);
      process.exitCode = 1;
    } else {
      console.log(`${verdicts.counts.passed}/${verdicts.counts.total} assertions passed`);
      if (!verdicts.ok) process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      `production multi-window probe failed: ${error.stack ?? error.message}`,
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
