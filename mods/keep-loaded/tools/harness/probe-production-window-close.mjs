#!/usr/bin/env node

/** Close a real secondary Zen window with the shipped Keep Loaded bundle loaded by Sine. */

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
const PRODUCTION_PATHS = [
  "dist/keep-loaded.sys.mjs",
  "dist/keep-loaded.uc.mjs",
  "preferences.json",
  "styles/chrome.css",
];

const REQUIRED_ASSERTIONS = [
  "exact stamped platform is running",
  "production mod starts disabled",
  "secondary browser window reaches Sine",
  "Sine loads distinct live production controllers in both windows",
  "production controllers share one application work owner",
  "application owner registers both live controller generations",
  "two-window held-tab fixture is eligible in both windows",
  "duplicate production sweeps retain one semantic key",
  "held production sweep permits one active operation across windows",
  "dequeued production sweep visits both currently live windows",
  "production work finishes without overlap or preference drift",
  "hot reload replaces registrations on the same application owner",
  "secondary controller owns cancellable work before close",
  "exact close emits domwindowclosed then unload without beforeunload",
  "native unload stops the secondary production controller",
  "secondary controller drains its generation resources",
  "native close unregisters secondary application work",
  "secondary window leaves the window mediator",
  "primary production controller remains live",
  "primary status widget survives the secondary close",
  "primary status button still opens and fills its real panel",
  "primary application work still runs after secondary close",
  "production application owner drains after disable",
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
  const OWNER_URI = "chrome://sine/content/keep-loaded/dist/keep-loaded.sys.mjs";
  const MATCH_PREF = "zen.keep-loaded.match";
  const ON_DEMAND_PREF = "browser.sessionstore.restore_pinned_tabs_on_demand";
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
    work: {},
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
  const requestSweepFrom = targetWindow => {
    const action = cachedView(targetWindow)?.querySelector("#" + WAKE_ID);
    if (!action) {
      throw new Error("the target window has no production wake action");
    }
    action.dispatchEvent(new targetWindow.Event("command", { bubbles: true }));
  };
  const controllerReady = targetWindow => {
    try {
      const controller = targetWindow.zenKeepLoaded?.controller;
      return controller?.isLive() === true &&
        controller.state?.kind === "live" &&
        Boolean(targetWindow.zenKeepLoaded?.application?.()?.registrationId) &&
        Boolean(cachedView(targetWindow));
    } catch {
      return false;
    }
  };

  (async () => {
    let enabled = false;
    let fixtures = [];
    let manager;
    let originalMatch = null;
    let originalMatchHadUserValue = false;
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

      const { SessionStore } = ChromeUtils.importESModule(
        "resource:///modules/sessionstore/SessionStore.sys.mjs"
      );
      originalMatchHadUserValue = Services.prefs.prefHasUserValue(MATCH_PREF);
      originalMatch = Services.prefs.getStringPref(MATCH_PREF, "");
      let heldFixtures = 0;
      report.work.maxHeldFixtures = 0;
      const createFixture = (targetWindow, label) => {
        const tab = targetWindow.gBrowser.addTab("about:blank", {
          createLazyBrowser: true,
          inBackground: true,
          lazyTabTitle: "keep-loaded close probe " + label,
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
        };
        Object.defineProperty(tab, "linkedPanel", {
          configurable: true,
          get: () => fixture.inserted ? "keep-loaded-close-probe-" + label : "",
        });
        targetWindow.gBrowser._insertBrowser = function(candidate) {
          if (candidate === tab) {
            fixture.calls += 1;
            fixture.inserted = true;
            if (!fixture.held) {
              fixture.held = true;
              heldFixtures += 1;
              report.work.maxHeldFixtures = Math.max(
                report.work.maxHeldFixtures,
                heldFixtures
              );
            }
            return;
          }
          return originalInsert.call(this, candidate);
        };
        return fixture;
      };
      const releaseFixture = fixture => {
        fixture.tab.removeAttribute("pending");
        if (fixture.held) {
          fixture.held = false;
          heldFixtures -= 1;
        }
      };
      const fixtureEligible = fixture => {
        fixture.targetWindow.gZenWorkspaces._allStoredTabs = null;
        return fixture.tab.pinned &&
          !fixture.tab.selected &&
          fixture.tab.hasAttribute("pending") &&
          !fixture.tab.linkedPanel &&
          SessionStore.getCustomTabValue(fixture.tab, "zenKeepLoaded") === "true" &&
          fixture.targetWindow.gZenWorkspaces.allStoredTabs.includes(fixture.tab);
      };
      progress("enabling staged production mod through Sine");
      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = true;
      await Promise.all([
        waitFor("primary production controller", () => controllerReady(window)),
        waitFor("secondary production controller", () => controllerReady(secondWindow)),
      ]);
      let controllerA = window.zenKeepLoaded.controller;
      let controllerB = secondWindow.zenKeepLoaded.controller;
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

      const workOwner = ChromeUtils.importESModule(OWNER_URI);
      await waitFor(
        "two idle application registrations",
        () => {
          const snapshot = workOwner.snapshot();
          return snapshot.registrationCount === 2 &&
            snapshot.activeCount === 0 &&
            snapshot.keyRecords === 0;
        },
      );
      const applicationA = window.zenKeepLoaded.application();
      const applicationB = secondWindow.zenKeepLoaded.application();
      const initialOwner = workOwner.snapshot();
      report.work.initialOwner = initialOwner;
      check(
        "production controllers share one application work owner",
        applicationA.applicationId === workOwner.applicationId &&
          applicationB.applicationId === workOwner.applicationId &&
          applicationA.snapshot.applicationId === workOwner.applicationId &&
          applicationB.snapshot.applicationId === workOwner.applicationId,
        JSON.stringify({
          imported: workOwner.applicationId,
          primary: applicationA.applicationId,
          secondary: applicationB.applicationId,
        }),
      );
      check(
        "application owner registers both live controller generations",
        applicationA.registrationId !== applicationB.registrationId &&
          initialOwner.registrationIds.includes(applicationA.registrationId) &&
          initialOwner.registrationIds.includes(applicationB.registrationId) &&
          initialOwner.registrationCount === 2,
        JSON.stringify({ applicationA, applicationB, owner: initialOwner }),
      );

      fixtures = [createFixture(window, "primary"), createFixture(secondWindow, "secondary")];
      check(
        "two-window held-tab fixture is eligible in both windows",
        fixtures.every(fixture => fixture.calls === 0 && fixtureEligible(fixture)),
        JSON.stringify(
          fixtures.map(fixture => ({
            calls: fixture.calls,
            label: fixture.label,
            pending: fixture.tab.hasAttribute("pending"),
            pinned: fixture.tab.pinned,
            selected: fixture.tab.selected,
          })),
        ),
      );

      requestSweepFrom(window);
      await waitFor(
        "one held fixture from one production request",
        () => {
          const snapshot = workOwner.snapshot();
          return fixtures.reduce((total, fixture) => total + fixture.calls, 0) === 1 &&
            snapshot.activeCount === 1 &&
            snapshot.trailingCount === 0;
        },
      );
      const firstFixture = fixtures.find(fixture => fixture.calls === 1);
      const waitingFixture = fixtures.find(fixture => fixture.calls === 0);
      if (!firstFixture || !waitingFixture) {
        throw new Error("the application owner did not hold exactly one fixture first");
      }
      const singleRequestOwner = workOwner.snapshot();
      report.work.singleRequestOwner = singleRequestOwner;
      check(
        "held production sweep permits one active operation across windows",
        singleRequestOwner.activeCount === 1 &&
          singleRequestOwner.activeKind === "sweep" &&
          singleRequestOwner.keyRecords === 1 &&
          singleRequestOwner.sweepRecords === 1 &&
          singleRequestOwner.trailingCount === 0 &&
          firstFixture.calls === 1 &&
          waitingFixture.calls === 0 &&
          report.work.maxHeldFixtures === 1,
        JSON.stringify({
          first: firstFixture.label,
          calls: fixtures.map(fixture => [fixture.label, fixture.calls]),
          maxHeldFixtures: report.work.maxHeldFixtures,
          owner: singleRequestOwner,
        }),
      );

      releaseFixture(firstFixture);
      await waitFor(
        "second serialized fixture insertion from the same request",
        () => waitingFixture.calls === 1,
      );
      const fanoutOwner = workOwner.snapshot();
      report.work.fanoutOwner = fanoutOwner;
      check(
        "dequeued production sweep visits both currently live windows",
        fixtures.every(fixture => fixture.calls === 1) &&
          report.work.maxHeldFixtures === 1 &&
          fanoutOwner.activeCount === 1 &&
          fanoutOwner.activeKind === "sweep" &&
          fanoutOwner.keyRecords === 1 &&
          fanoutOwner.sweepRecords === 1 &&
          fanoutOwner.trailingCount === 0,
        JSON.stringify({
          calls: fixtures.map(fixture => [fixture.label, fixture.calls]),
          maxHeldFixtures: report.work.maxHeldFixtures,
          owner: fanoutOwner,
        }),
      );

      for (let revision = 0; revision < 8; revision += 1) {
        Services.prefs.setStringPref(MATCH_PREF, "probe-no-match-" + revision);
      }
      await waitFor(
        "one coalesced trailing sweep",
        () => workOwner.snapshot().trailingCount === 1,
      );
      const heldOwner = workOwner.snapshot();
      report.work.heldOwner = heldOwner;
      check(
        "duplicate production sweeps retain one semantic key",
        heldOwner.keyRecords === 1 &&
          heldOwner.sweepRecords === 1 &&
          heldOwner.activeCount === 1 &&
          heldOwner.trailingCount === 1 &&
          fixtures.every(fixture => fixture.calls === 1) &&
          report.work.maxHeldFixtures === 1,
        JSON.stringify(heldOwner),
      );

      releaseFixture(waitingFixture);
      await waitFor(
        "application work to become idle",
        () => {
          const snapshot = workOwner.snapshot();
          return snapshot.activeCount === 0 && snapshot.keyRecords === 0;
        },
      );
      const idleOwner = workOwner.snapshot();
      report.work.idleOwner = idleOwner;
      check(
        "production work finishes without overlap or preference drift",
        report.work.maxHeldFixtures === 1 &&
          idleOwner.activeCount === 0 &&
          idleOwner.keyRecords === 0 &&
          Services.prefs.getBoolPref(ON_DEMAND_PREF, false) === true &&
          fixtures.every(fixture => fixture.tab.hasAttribute("zen-keep-loaded")),
        JSON.stringify({
          maxHeldFixtures: report.work.maxHeldFixtures,
          onDemand: Services.prefs.getBoolPref(ON_DEMAND_PREF, false),
          owner: idleOwner,
        }),
      );

      const oldControllers = [controllerA, controllerB];
      const oldRegistrationIds = [applicationA.registrationId, applicationB.registrationId];
      progress("hot reloading both production window generations");
      await manager.rebuildMods(true, false);
      await Promise.all([
        waitFor(
          "replacement primary production controller",
          () => controllerReady(window) && window.zenKeepLoaded.controller !== controllerA,
        ),
        waitFor(
          "replacement secondary production controller",
          () => controllerReady(secondWindow) &&
            secondWindow.zenKeepLoaded.controller !== controllerB,
        ),
      ]);
      controllerA = window.zenKeepLoaded.controller;
      controllerB = secondWindow.zenKeepLoaded.controller;
      await waitFor(
        "replacement application work idle",
        () => {
          const snapshot = workOwner.snapshot();
          return snapshot.registrationCount === 2 &&
            snapshot.activeCount === 0 &&
            snapshot.keyRecords === 0;
        },
      );
      const replacementA = window.zenKeepLoaded.application();
      const replacementB = secondWindow.zenKeepLoaded.application();
      const replacementOwner = workOwner.snapshot();
      report.work.replacementOwner = replacementOwner;
      check(
        "hot reload replaces registrations on the same application owner",
        oldControllers.every(old => !old.isLive()) &&
          replacementA.applicationId === applicationA.applicationId &&
          replacementB.applicationId === applicationB.applicationId &&
          !oldRegistrationIds.includes(replacementA.registrationId) &&
          !oldRegistrationIds.includes(replacementB.registrationId) &&
          replacementOwner.registrationCount === 2 &&
          replacementOwner.registrationIds.includes(replacementA.registrationId) &&
          replacementOwner.registrationIds.includes(replacementB.registrationId),
        JSON.stringify({
          applicationId: replacementA.applicationId,
          oldRegistrationIds,
          replacementOwner,
        }),
      );

      const secondaryFixture = fixtures.find(
        fixture => fixture.targetWindow === secondWindow,
      );
      if (!secondaryFixture) {
        throw new Error("secondary held-tab fixture disappeared");
      }
      secondaryFixture.tab.setAttribute("pending", "true");
      secondaryFixture.inserted = false;
      const secondaryEligibleBeforeClose = fixtureEligible(secondaryFixture);
      const secondaryCallsBeforeClose = secondaryFixture.calls;
      let secondaryDisposals = 0;
      controllerB.defer(() => {
        secondaryDisposals += 1;
      });
      requestSweepFrom(secondWindow);
      await waitFor(
        "secondary production sweep to hold its restore lease",
        () => {
          const snapshot = workOwner.snapshot();
          return secondaryFixture.calls === secondaryCallsBeforeClose + 1 &&
            secondaryFixture.held &&
            controllerB.state.kind === "live" &&
            controllerB.state.operation.kind === "sweep" &&
            snapshot.activeCount === 1 &&
            snapshot.activeKind === "sweep" &&
            snapshot.keyRecords === 1 &&
            snapshot.trailingCount === 0 &&
            snapshot.wakeCandidates === 1 &&
            snapshot.wakePhase === "waiting" &&
            Services.prefs.getBoolPref(ON_DEMAND_PREF, true) === false;
        },
      );
      const closeActiveOwner = workOwner.snapshot();
      report.beforeClose = {
        onDemand: Services.prefs.getBoolPref(ON_DEMAND_PREF, true),
        primaryControllerLive: controllerA.isLive(),
        secondaryCalls: secondaryFixture.calls,
        secondaryControllerLive: controllerB.isLive(),
        secondaryPendingTimers: controllerB.pendingTimers,
        secondaryPendingWaits: controllerB.pendingWaits,
        workOwner: closeActiveOwner,
      };
      check(
        "secondary controller owns cancellable work before close",
          secondaryEligibleBeforeClose &&
          secondaryFixture.held &&
          secondaryFixture.calls === secondaryCallsBeforeClose + 1 &&
          closeActiveOwner.activeCount === 1 &&
          closeActiveOwner.activeKind === "sweep" &&
          closeActiveOwner.keyRecords === 1 &&
          closeActiveOwner.trailingCount === 0 &&
          closeActiveOwner.wakeCandidates === 1 &&
          closeActiveOwner.wakePhase === "waiting" &&
          report.beforeClose.onDemand === false,
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
            onDemand: Services.prefs.getBoolPref(ON_DEMAND_PREF, false),
            secondaryFixtureCalls: secondaryFixture.calls,
            stopReason: controllerB.stopReason ?? null,
            testDisposals: secondaryDisposals,
            workOwner: workOwner.snapshot(),
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
      await waitFor(
        "secondary application drain settlement",
        () => {
          const snapshot = workOwner.snapshot();
          return snapshot.registrationCount === 1 &&
            snapshot.activeCount === 0 &&
            snapshot.drainingCount === 0 &&
            snapshot.keyRecords === 0;
        },
      );
      const closeSettledOwner = workOwner.snapshot();
      const secondaryCallsAfterClose = secondaryFixture.calls;
      const unloadOwner = report.secondaryAtUnload?.workOwner ?? null;
      const unloadOwnerWasDraining = unloadOwner?.activeCount === 1 &&
        unloadOwner.activeKind === "sweep" &&
        unloadOwner.drainingCount === 1 &&
        unloadOwner.keyRecords === 1 &&
        unloadOwner.sweepRecords === 1 &&
        unloadOwner.readyCount === 0 &&
        unloadOwner.trailingCount === 0;
      const unloadOwnerWasSettled = unloadOwner?.activeCount === 0 &&
        unloadOwner.activeKind === null &&
        unloadOwner.drainingCount === 0 &&
        unloadOwner.keyRecords === 0 &&
        unloadOwner.sweepRecords === 0 &&
        unloadOwner.readyCount === 0 &&
        unloadOwner.trailingCount === 0;
      report.work.close = {
        atUnload: unloadOwner,
        atUnloadPhase: unloadOwnerWasDraining
          ? "draining"
          : unloadOwnerWasSettled
            ? "settled"
            : "inconsistent",
        settled: closeSettledOwner,
      };
      if (secondaryFixture.held) {
        secondaryFixture.held = false;
        heldFixtures -= 1;
      }

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
        "native close unregisters secondary application work",
        report.secondaryAtUnload.workOwner?.registrationCount === 1 &&
          report.secondaryAtUnload.workOwner?.registrationIds.includes(
            replacementA.registrationId,
          ) &&
          !report.secondaryAtUnload.workOwner?.registrationIds.includes(
            replacementB.registrationId,
          ) &&
          (unloadOwnerWasDraining || unloadOwnerWasSettled) &&
          report.secondaryAtUnload.onDemand === true &&
          report.secondaryAtUnload.secondaryFixtureCalls ===
            secondaryCallsBeforeClose + 1 &&
          closeSettledOwner.registrationCount === 1 &&
          closeSettledOwner.registrationIds.includes(replacementA.registrationId) &&
          closeSettledOwner.activeCount === 0 &&
          closeSettledOwner.activeKind === null &&
          closeSettledOwner.drainingCount === 0 &&
          closeSettledOwner.keyRecords === 0 &&
          closeSettledOwner.sweepRecords === 0 &&
          closeSettledOwner.readyCount === 0 &&
          closeSettledOwner.trailingCount === 0 &&
          secondaryCallsAfterClose === secondaryCallsBeforeClose + 1,
        JSON.stringify(report.work.close),
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
          heading === "1 kept — 1 alive" &&
          action === "All kept tabs are awake",
        JSON.stringify(report.panelAfterClose),
      );

      const primaryFixture = fixtures.find(fixture => fixture.targetWindow === window);
      if (!primaryFixture) {
        throw new Error("primary held-tab fixture disappeared");
      }
      primaryFixture.tab.setAttribute("pending", "true");
      primaryFixture.inserted = false;
      const primaryCallsBefore = primaryFixture.calls;
      Services.prefs.setStringPref(MATCH_PREF, "post-close-primary-sweep");
      await waitFor(
        "primary post-close fixture insertion",
        () => primaryFixture.calls === primaryCallsBefore + 1,
      );
      const primaryActiveOwner = workOwner.snapshot();
      releaseFixture(primaryFixture);
      await waitFor(
        "primary post-close work drain",
        () => workOwner.snapshot().activeCount === 0 && workOwner.snapshot().keyRecords === 0,
      );
      const primaryIdleOwner = workOwner.snapshot();
      report.work.postClose = {
        active: primaryActiveOwner,
        idle: primaryIdleOwner,
        secondaryCalls: secondaryFixture.calls,
      };
      check(
        "primary application work still runs after secondary close",
        primaryActiveOwner.registrationCount === 1 &&
          primaryActiveOwner.activeCount === 1 &&
          primaryFixture.calls === primaryCallsBefore + 1 &&
          secondaryFixture.calls === secondaryCallsAfterClose &&
          primaryIdleOwner.registrationCount === 1 &&
          primaryIdleOwner.activeCount === 0 &&
          primaryIdleOwner.keyRecords === 0,
        JSON.stringify(report.work.postClose),
      );

      if (enabled) {
        progress("disabling production mod through Sine");
        await manager.toggleTheme(await sineUtils.getMods(), options.modId);
        enabled = false;
        await waitFor(
          "production disable cleanup",
          () => !window.zenKeepLoaded?.controller &&
            !CustomizableUI.getWidget(BUTTON_ID) &&
            workOwner.snapshot().registrationCount === 0,
        );
      }
      const disabledOwner = workOwner.snapshot();
      report.work.disabledOwner = disabledOwner;
      check(
        "production application owner drains after disable",
        disabledOwner.registrationCount === 0 &&
          disabledOwner.activeCount === 0 &&
          disabledOwner.keyRecords === 0 &&
          disabledOwner.readyCount === 0 &&
          disabledOwner.trailingCount === 0 &&
          disabledOwner.drainingCount === 0,
        JSON.stringify(disabledOwner),
      );
      progress("probe complete");
    } catch (error) {
      report.fatal = String(error?.stack ?? error);
      if (enabled && manager && sineUtils) {
        try {
          await manager.toggleTheme(await sineUtils.getMods(), options.modId);
        } catch {}
      }
    }
    try {
      for (const fixture of fixtures) {
        if (fixture.targetWindow.closed) continue;
        fixture.targetWindow.gBrowser._insertBrowser = fixture.originalInsert;
        if (fixture.originalLinkedPanel) {
          Object.defineProperty(
            fixture.tab,
            "linkedPanel",
            fixture.originalLinkedPanel,
          );
        } else {
          delete fixture.tab.linkedPanel;
        }
        fixture.tab.removeAttribute("pending");
        if (fixture.tab.isConnected) {
          fixture.targetWindow.gBrowser.removeTab(fixture.tab, { animate: false });
        }
      }
      if (originalMatch !== null) {
        if (originalMatchHadUserValue) {
          Services.prefs.setStringPref(MATCH_PREF, originalMatch);
        } else {
          Services.prefs.clearUserPref(MATCH_PREF);
        }
      }
      report.cleanup = { fixtures: fixtures.length, matchRestored: true };
    } catch (error) {
      report.cleanup = { error: String(error?.stack ?? error), matchRestored: false };
      report.fatal ??= report.cleanup.error;
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
