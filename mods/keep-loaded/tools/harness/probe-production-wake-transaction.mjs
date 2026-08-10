#!/usr/bin/env node

/** Exercise the shipped wake transaction against exact Zen SessionStore slots. */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectVerdicts, validateAssertionManifest } from "./live-core.mjs";
import { openMarionette } from "./live-marionette.mjs";
import { launchLiveZen } from "./live-zen.mjs";
import { startWakeTransactionServer } from "./wake-transaction-server.mjs";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MOD_DIRECTORY = resolve(DIRECTORY, "../..");
const REPOSITORY_ROOT = resolve(MOD_DIRECTORY, "../..");
const OUTPUT = resolve(
  REPOSITORY_ROOT,
  ".benchmarks/live/keep-loaded-production-wake-transaction.smoke.json",
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
  "production controller uses the stable application owner",
  "four fixtures begin as genuine remote lazy pinned tabs",
  "real panel command starts one production wake transaction",
  "three genuine restores saturate every exact SessionStore slot",
  "fourth restore stays inserted and pending past the real deadline",
  "timeout rolls the fourth restore back to a genuine lazy tab",
  "timeout queues the configured automatic retry before reload",
  "timeout retry keeps the preference held continuously",
  "setting change updates the final preference target without an early restore",
  "hot reload rolls back the old generation retry",
  "hot reload replaces registration on the same stable owner",
  "replacement generation queues the fourth restore behind occupied slots",
  "releasing one exact slot starts the fourth restore",
  "rollback and retry preserve the fourth tab session state",
  "application owner drains to the latest desired preference",
  "held restore slots drain before subsequent work",
  "a subsequent genuine fast wake still completes",
  "production disable leaves the application owner drained",
  "latest desired preference never regresses during follow-up or disable",
];

const PROBE = `
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  const CACHE_ID = "appMenu-viewCache";
  const VIEW_ID = "keep-loaded-panelview";
  const WAKE_ID = "keep-loaded-wake-button";
  const OWNER_URI = "chrome://sine/content/keep-loaded/dist/keep-loaded.sys.mjs";
  const ON_DEMAND_PREF = "browser.sessionstore.restore_pinned_tabs_on_demand";
  const LAZY_PINNED_PREF = "zen.keep-loaded.lazy-pinned";
  const FLAG = "zenKeepLoaded";
  const PROBE_VALUE = "wakeTransactionProbe";
  const nativeNow = Date.now.bind(Date);
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const report = {
    assertions: [],
    cleanup: null,
    events: [],
    fatal: null,
    fixtures: {},
    owner: {},
    platform: null,
    preferenceTransitions: [],
    server: {},
    timing: {},
  };
  let sequence = 0;
  const progress = label => {
    dump("[keep-loaded production wake transaction probe] " + label + "\\n");
  };
  const event = (type, detail = {}) => {
    const entry = {
      sequence: ++sequence,
      at: new Date().toISOString(),
      atMs: nativeNow(),
      type,
      ...detail,
    };
    report.events.push(entry);
    return entry;
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
  const waitForAsync = async (name, read, timeout = 30000) => {
    const deadline = nativeNow() + timeout;
    let value;
    while (nativeNow() < deadline) {
      value = await read();
      if (value) return value;
      await wait(25);
    }
    throw new Error("timed out waiting for " + name + "; last value: " + String(value));
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  const cachedView = () =>
    document.getElementById(VIEW_ID) ??
    document.getElementById(CACHE_ID)?.content.querySelector("#" + VIEW_ID) ??
    null;
  const controllerReady = () => {
    try {
      const controller = window.zenKeepLoaded?.controller;
      return controller?.isLive() === true &&
        controller.state?.kind === "live" &&
        Boolean(window.zenKeepLoaded?.application?.()?.registrationId) &&
        Boolean(cachedView());
    } catch {
      return false;
    }
  };
  const ownerSnapshot = owner => clone(owner.snapshot());
  const requestPanelWake = label => {
    const view = cachedView();
    if (!view) throw new Error("production panel view is missing");
    window.zenKeepLoaded.fillPanel(view);
    const action = view.querySelector("#" + WAKE_ID);
    if (!action) throw new Error("production panel wake command is missing");
    const started = event("panel-command", {
      disabled: Boolean(action.disabled),
      label,
      text: action.textContent ?? "",
    });
    action.dispatchEvent(new Event("command", { bubbles: true }));
    return started;
  };
  const serverSnapshot = async () => {
    const response = await fetch(options.serverBaseUrl + "/control/snapshot", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("server snapshot failed with " + response.status);
    return response.json();
  };
  const releaseServer = async id => {
    const response = await fetch(
      options.serverBaseUrl + "/control/release/" + String(id),
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error("server release failed with " + response.status);
    return response.json();
  };
  const releaseAllServer = async () => {
    const response = await fetch(options.serverBaseUrl + "/control/release-all", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("server release-all failed with " + response.status);
    return response.json();
  };
  const requestCount = (snapshot, type, id) =>
    snapshot.events.filter(entry => entry.type === type && entry.id === id).length;

  (async () => {
    let enabled = false;
    let fixtures = [];
    let manager = null;
    let owner = null;
    let preferenceObserver = null;
    let sineUtils = null;
    let tabEventHandler = null;
    let reloadPromise = null;
    const originalPreferences = {};
    const rememberPreference = name => {
      originalPreferences[name] = {
        hadUserValue: Services.prefs.prefHasUserValue(name),
        value: Services.prefs.getBoolPref(name, false),
      };
    };
    const restorePreference = name => {
      const original = originalPreferences[name];
      if (!original) return;
      if (original.hadUserValue) Services.prefs.setBoolPref(name, original.value);
      else Services.prefs.clearUserPref(name);
    };
    try {
      progress("importing exact Sine manager");
      manager = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/manager.sys.mjs"
      ).default;
      sineUtils = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/utils.sys.mjs"
      ).default;
      const { SessionStore } = ChromeUtils.importESModule(
        "resource:///modules/sessionstore/SessionStore.sys.mjs"
      );
      await waitFor(
        "primary Sine interface",
        () => typeof window.addUnloadListener === "function" && window.CustomizableUI,
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

      rememberPreference(ON_DEMAND_PREF);
      rememberPreference(LAZY_PINNED_PREF);
      Services.prefs.setBoolPref(ON_DEMAND_PREF, true);
      Services.prefs.setBoolPref(LAZY_PINNED_PREF, true);
      report.preferenceTransitions.push({
        at: new Date().toISOString(),
        atMs: nativeNow(),
        source: "initial",
        value: Services.prefs.getBoolPref(ON_DEMAND_PREF, false),
      });
      preferenceObserver = {
        observe() {
          const transition = {
            at: new Date().toISOString(),
            atMs: nativeNow(),
            source: "observer",
            value: Services.prefs.getBoolPref(ON_DEMAND_PREF, false),
          };
          report.preferenceTransitions.push(transition);
          event("on-demand-pref", { value: transition.value });
        },
      };
      Services.prefs.addObserver(ON_DEMAND_PREF, preferenceObserver);

      progress("enabling staged production mod through Sine");
      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = true;
      await waitFor("production controller", controllerReady);
      owner = ChromeUtils.importESModule(OWNER_URI);
      await waitFor(
        "idle production owner",
        () => {
          const snapshot = owner.snapshot();
          return snapshot.protocol === options.expectedProtocol &&
            snapshot.registrationCount === 1 &&
            snapshot.activeCount === 0 &&
            snapshot.wakePhase === "idle";
        },
      );
      const firstController = window.zenKeepLoaded.controller;
      const firstApplication = window.zenKeepLoaded.application();
      report.owner.initial = ownerSnapshot(owner);
      check(
        "production controller uses the stable application owner",
        firstApplication.applicationId === owner.applicationId &&
          firstApplication.snapshot.applicationId === owner.applicationId &&
          firstApplication.snapshot.protocol === options.expectedProtocol &&
          report.owner.initial.registrationIds.includes(firstApplication.registrationId),
        JSON.stringify({ application: firstApplication, owner: report.owner.initial }),
      );

      const fixtureByTab = new Map();
      tabEventHandler = browserEvent => {
        const fixture = fixtureByTab.get(browserEvent.target);
        if (!fixture) return;
        event("tab-event", {
          discarded: fixture.tab.hasAttribute("discarded"),
          eventType: browserEvent.type,
          flagged: SessionStore.getCustomTabValue(fixture.tab, FLAG),
          id: fixture.id,
          linkedPanel: Boolean(fixture.tab.linkedPanel),
          pending: fixture.tab.hasAttribute("pending"),
          probeValue: SessionStore.getCustomTabValue(fixture.tab, PROBE_VALUE),
          remote: fixture.tab.linkedBrowser.isRemoteBrowser === true,
          workOwner: owner ? ownerSnapshot(owner) : null,
        });
      };
      for (const type of [
        "SSTabRestored",
        "SSTabRestoring",
        "TabBrowserDiscarded",
        "TabBrowserInserted",
      ]) {
        document.addEventListener(type, tabEventHandler, true);
      }

      const makeLazyFixture = (id, kind) => {
        const url = options.serverBaseUrl + "/" + kind + "/" + String(id);
        const uri = Services.io.newURI(url);
        const principal = Services.scriptSecurityManager.createContentPrincipal(uri, {});
        const tab = gBrowser.addTab(url, {
          createLazyBrowser: true,
          inBackground: true,
          lazyTabTitle: "wake transaction " + String(id),
          skipRoute: true,
          triggeringPrincipal: principal,
        });
        if (!tab) throw new Error("Zen refused to create fixture " + String(id));
        gBrowser.pinTab(tab);
        SessionStore.setCustomTabValue(tab, FLAG, "true");
        SessionStore.setCustomTabValue(tab, PROBE_VALUE, options.probeNonce + ":" + id);
        gZenWorkspaces._allStoredTabs = null;
        const fixture = {
          id,
          initialSession: JSON.parse(SessionStore.getTabState(tab)),
          kind,
          tab,
          url,
        };
        fixtureByTab.set(tab, fixture);
        fixtures.push(fixture);
        return fixture;
      };
      const fixtureState = fixture => ({
        connected: fixture.tab.isConnected,
        discarded: fixture.tab.hasAttribute("discarded"),
        flagged: SessionStore.getCustomTabValue(fixture.tab, FLAG),
        id: fixture.id,
        linkedPanel: Boolean(fixture.tab.linkedPanel),
        pending: fixture.tab.hasAttribute("pending"),
        probeValue: SessionStore.getCustomTabValue(fixture.tab, PROBE_VALUE),
        remote: fixture.tab.linkedBrowser.isRemoteBrowser === true,
        session: JSON.parse(SessionStore.getTabState(fixture.tab)),
        url: fixture.url,
      });
      const initialFour = [1, 2, 3, 4].map(id => makeLazyFixture(id, "hold"));
      const initialStates = initialFour.map(fixtureState);
      report.fixtures.initial = initialStates;
      const initialServer = await serverSnapshot();
      report.server.initial = initialServer;
      check(
        "four fixtures begin as genuine remote lazy pinned tabs",
        initialStates.every(state =>
          state.connected &&
          state.flagged === "true" &&
          !state.linkedPanel &&
          state.pending &&
          state.remote &&
          state.session.entries.some(entry => entry.url === state.url)
        ) && initialFour.every(fixture => fixture.tab.pinned) &&
          initialServer.events.every(entry => entry.type !== "hold-request"),
        JSON.stringify({ states: initialStates, server: initialServer }),
      );

      const panelStart = requestPanelWake("saturate");
      await waitForAsync(
        "three occupied restore slots and one queued candidate",
        async () => {
          const snapshot = owner.snapshot();
          const server = await serverSnapshot();
          const firstThreeStarted = initialFour.slice(0, 3).every(
            fixture => Boolean(fixture.tab.linkedPanel) && !fixture.tab.hasAttribute("pending"),
          );
          const fourthQueued = Boolean(initialFour[3].tab.linkedPanel) &&
            initialFour[3].tab.hasAttribute("pending");
          const onlyThreeRequests = [1, 2, 3].every(
            id => requestCount(server, "hold-request", id) === 1,
          ) && requestCount(server, "hold-request", 4) === 0;
          return firstThreeStarted && fourthQueued && onlyThreeRequests &&
            snapshot.activeCount === 1 && snapshot.wakePhase === "waiting" &&
            snapshot.wakeCandidates === 1 &&
            Services.prefs.getBoolPref(ON_DEMAND_PREF, true) === false;
        },
      );
      const saturatedOwner = ownerSnapshot(owner);
      const saturatedServer = await serverSnapshot();
      const saturatedStates = initialFour.map(fixtureState);
      report.owner.saturated = saturatedOwner;
      report.server.saturated = saturatedServer;
      report.fixtures.saturated = saturatedStates;
      check(
        "real panel command starts one production wake transaction",
        panelStart.disabled === false &&
          saturatedOwner.activeCount === 1 &&
          saturatedOwner.activeKind === "sweep" &&
          saturatedOwner.keyRecords === 1 &&
          saturatedOwner.wakePhase === "waiting" &&
          saturatedOwner.wakeCandidates === 1,
        JSON.stringify({ panelStart, owner: saturatedOwner }),
      );
      check(
        "three genuine restores saturate every exact SessionStore slot",
        saturatedStates.slice(0, 3).every(state =>
          state.linkedPanel && !state.pending && state.remote
        ) && [1, 2, 3].every(
          id => requestCount(saturatedServer, "hold-request", id) === 1 &&
            saturatedServer.pending[String(id)] === 1,
        ),
        JSON.stringify({ states: saturatedStates, server: saturatedServer }),
      );

      progress("waiting through the production 20-second wake deadline");
      await waitFor(
        "fourth timeout rollback",
        () => report.events.some(
          entry => entry.type === "tab-event" &&
            entry.eventType === "TabBrowserDiscarded" && entry.id === 4,
        ),
        35000,
      );
      const firstFourthDiscard = report.events.find(
        entry => entry.type === "tab-event" &&
          entry.eventType === "TabBrowserDiscarded" && entry.id === 4,
      );
      report.timing.firstDeadlineMs = firstFourthDiscard.atMs - panelStart.atMs;
      const atFirstRollback = fixtureState(initialFour[3]);
      const atFirstRollbackServer = await serverSnapshot();
      report.fixtures.firstRollback = atFirstRollback;
      report.server.firstRollback = atFirstRollbackServer;
      check(
        "fourth restore stays inserted and pending past the real deadline",
        report.timing.firstDeadlineMs >= options.expectedWakeTimeoutMs &&
          firstFourthDiscard.pending === true &&
          firstFourthDiscard.workOwner?.wakePhase === "rolling-back" &&
          firstFourthDiscard.workOwner?.wakeAttempt === 0 &&
          firstFourthDiscard.workOwner?.wakeCandidates === 1 &&
          requestCount(atFirstRollbackServer, "hold-request", 4) === 0,
        JSON.stringify({ timing: report.timing, event: firstFourthDiscard }),
      );
      check(
        "timeout rolls the fourth restore back to a genuine lazy tab",
        firstFourthDiscard.pending &&
          !firstFourthDiscard.linkedPanel &&
          firstFourthDiscard.remote &&
          firstFourthDiscard.discarded &&
          firstFourthDiscard.flagged === "true" &&
          firstFourthDiscard.probeValue === options.probeNonce + ":4" &&
          requestCount(atFirstRollbackServer, "hold-request", 4) === 0,
        JSON.stringify({ event: firstFourthDiscard, state: atFirstRollback, server: atFirstRollbackServer }),
      );

      await waitFor(
        "one automatic fourth retry",
        () => {
          const inserts = report.events.filter(
            entry => entry.type === "tab-event" &&
              entry.eventType === "TabBrowserInserted" && entry.id === 4,
          );
          const snapshot = owner.snapshot();
          return inserts.length === 2 &&
            Boolean(initialFour[3].tab.linkedPanel) &&
            initialFour[3].tab.hasAttribute("pending") &&
            snapshot.wakeAttempt === 1 &&
            snapshot.wakeCandidates === 1 &&
            snapshot.wakePhase === "waiting";
        },
      );
      const retryOwner = ownerSnapshot(owner);
      const retryServer = await serverSnapshot();
      report.owner.retry = retryOwner;
      report.server.retry = retryServer;
      report.fixtures.retry = fixtureState(initialFour[3]);
      const fourthEventsAtRetry = report.events.filter(
        entry => entry.type === "tab-event" && entry.id === 4,
      );
      check(
        "timeout queues the configured automatic retry before reload",
        fourthEventsAtRetry.filter(entry => entry.eventType === "TabBrowserInserted").length === 2 &&
          fourthEventsAtRetry.filter(entry => entry.eventType === "TabBrowserDiscarded").length === 1 &&
          retryOwner.wakeAttempt === 1 &&
          retryOwner.wakeCandidates === 1 &&
          retryOwner.wakePhase === "waiting" &&
          requestCount(retryServer, "hold-request", 4) === 0,
        JSON.stringify({ events: fourthEventsAtRetry, owner: retryOwner }),
      );
      const timeoutTransitions = report.preferenceTransitions.filter(
        entry => entry.atMs >= panelStart.atMs,
      );
      check(
        "timeout retry keeps the preference held continuously",
        timeoutTransitions.length >= 1 &&
          timeoutTransitions.every(entry => entry.value === false) &&
          Services.prefs.getBoolPref(ON_DEMAND_PREF, true) === false,
        JSON.stringify(timeoutTransitions),
      );

      const settingChanged = event("lazy-pinned-setting", { value: false });
      Services.prefs.setBoolPref(LAZY_PINNED_PREF, false);
      await waitFor(
        "latest desired application preference",
        () => owner.snapshot().desiredOnDemand === false,
      );
      await wait(100);
      const settingOwner = ownerSnapshot(owner);
      report.owner.afterSetting = settingOwner;
      check(
        "setting change updates the final preference target without an early restore",
        settingOwner.desiredOnDemand === false &&
          settingOwner.activeCount === 1 &&
          settingOwner.wakeCandidates === 1 &&
          initialFour[3].tab.hasAttribute("pending") &&
          Boolean(initialFour[3].tab.linkedPanel) &&
          Services.prefs.getBoolPref(ON_DEMAND_PREF, true) === false &&
          report.preferenceTransitions
            .filter(entry => entry.atMs >= settingChanged.atMs)
            .every(entry => entry.value === false),
        JSON.stringify({ owner: settingOwner, transitions: report.preferenceTransitions }),
      );

      progress("hot reloading while the automatic retry is queued in SessionStore");
      const oldController = window.zenKeepLoaded.controller;
      const oldRegistrationId = window.zenKeepLoaded.application().registrationId;
      const reloadRequested = event("reload-requested", {
        oldRegistrationId,
      });
      reloadPromise = Promise.resolve(manager.rebuildMods(true, false));
      await waitFor(
        "old retry rollback during generation stop",
        () => report.events.filter(
          entry => entry.type === "tab-event" &&
            entry.eventType === "TabBrowserDiscarded" && entry.id === 4,
        ).length === 2,
        5000,
      );
      const secondFourthDiscard = report.events.filter(
        entry => entry.type === "tab-event" &&
          entry.eventType === "TabBrowserDiscarded" && entry.id === 4,
      )[1];
      await waitFor(
        "replacement controller facade",
        () => controllerReady() && window.zenKeepLoaded.controller !== oldController,
      );
      const replacementReady = event("replacement-ready", {
        registrationId: window.zenKeepLoaded.application().registrationId,
      });
      const replacementController = window.zenKeepLoaded.controller;
      const replacementApplication = window.zenKeepLoaded.application();
      check(
        "hot reload rolls back the old generation retry",
        oldController.isLive() === false &&
          secondFourthDiscard.pending === true &&
          secondFourthDiscard.linkedPanel === false &&
          secondFourthDiscard.workOwner?.wakePhase === "rolling-back" &&
          secondFourthDiscard.workOwner?.wakeAttempt === 1 &&
          secondFourthDiscard.workOwner?.wakeCandidates === 1 &&
          secondFourthDiscard.sequence > reloadRequested.sequence &&
          secondFourthDiscard.sequence < replacementReady.sequence &&
          report.events.filter(
            entry => entry.type === "tab-event" &&
              entry.eventType === "TabBrowserDiscarded" && entry.id === 4,
          ).length === 2,
        JSON.stringify({ discard: secondFourthDiscard, events: report.events }),
      );

      await waitForAsync(
        "replacement fourth insertion behind held slots",
        async () => {
          const snapshot = owner.snapshot();
          const server = await serverSnapshot();
          const fourthInserts = report.events.filter(
            entry => entry.type === "tab-event" &&
              entry.eventType === "TabBrowserInserted" && entry.id === 4,
          ).length;
          return replacementController.isLive() &&
            replacementApplication.applicationId === owner.applicationId &&
            replacementApplication.registrationId !== oldRegistrationId &&
            snapshot.registrationCount === 1 &&
            snapshot.registrationIds.includes(replacementApplication.registrationId) &&
            snapshot.activeCount === 1 && snapshot.wakePhase === "waiting" &&
            snapshot.wakeCandidates === 1 && fourthInserts === 3 &&
            Boolean(initialFour[3].tab.linkedPanel) &&
            initialFour[3].tab.hasAttribute("pending") &&
            requestCount(server, "hold-request", 4) === 0;
        },
        30000,
      );
      const replacementOwner = ownerSnapshot(owner);
      const replacementServer = await serverSnapshot();
      report.owner.replacement = replacementOwner;
      report.server.replacement = replacementServer;
      report.fixtures.replacement = fixtureState(initialFour[3]);
      check(
        "hot reload replaces registration on the same stable owner",
        replacementApplication.applicationId === firstApplication.applicationId &&
          replacementApplication.applicationId === owner.applicationId &&
          replacementApplication.registrationId !== oldRegistrationId &&
          replacementOwner.registrationCount === 1 &&
          replacementOwner.registrationIds.includes(replacementApplication.registrationId) &&
          replacementOwner.protocol === options.expectedProtocol,
        JSON.stringify({ oldRegistrationId, replacementApplication, replacementOwner }),
      );
      check(
        "replacement generation queues the fourth restore behind occupied slots",
        replacementOwner.activeCount === 1 &&
          replacementOwner.wakePhase === "waiting" &&
          replacementOwner.wakeCandidates === 1 &&
          report.fixtures.replacement.linkedPanel &&
          report.fixtures.replacement.pending &&
          requestCount(replacementServer, "hold-request", 4) === 0 &&
          [1, 2, 3].every(id => replacementServer.pending[String(id)] === 1),
        JSON.stringify({ owner: replacementOwner, server: replacementServer }),
      );

      progress("releasing one of the three exact SessionStore restore slots");
      await releaseServer(1);
      await waitForAsync(
        "fourth restore start and request",
        async () => {
          const server = await serverSnapshot();
          return !initialFour[3].tab.hasAttribute("pending") &&
            Boolean(initialFour[3].tab.linkedPanel) &&
            requestCount(server, "hold-request", 4) === 1;
        },
      );
      await waitFor(
        "replacement owner idle",
        () => {
          const snapshot = owner.snapshot();
          return snapshot.activeCount === 0 &&
            snapshot.keyRecords === 0 && snapshot.wakePhase === "idle";
        },
      );
      await reloadPromise;
      reloadPromise = null;
      const finalFourth = fixtureState(initialFour[3]);
      const releasedOwner = ownerSnapshot(owner);
      const releasedServer = await serverSnapshot();
      report.fixtures.released = finalFourth;
      report.owner.released = releasedOwner;
      report.server.released = releasedServer;
      const sessionUrls = state => state.entries.map(entry => entry.url);
      check(
        "releasing one exact slot starts the fourth restore",
        finalFourth.linkedPanel &&
          !finalFourth.pending &&
          finalFourth.remote &&
          requestCount(releasedServer, "hold-request", 4) === 1 &&
          releasedServer.pending["4"] === 1 &&
          releasedOwner.activeCount === 0 && releasedOwner.wakePhase === "idle",
        JSON.stringify({ state: finalFourth, owner: releasedOwner, server: releasedServer }),
      );
      check(
        "rollback and retry preserve the fourth tab session state",
        JSON.stringify(sessionUrls(finalFourth.session)) ===
          JSON.stringify(sessionUrls(initialFour[3].initialSession)) &&
          finalFourth.session.index === initialFour[3].initialSession.index &&
          finalFourth.flagged === "true" &&
          finalFourth.probeValue === options.probeNonce + ":4",
        JSON.stringify({ initial: initialFour[3].initialSession, final: finalFourth }),
      );
      const transitionsAfterSetting = report.preferenceTransitions.filter(
        entry => entry.atMs >= settingChanged.atMs,
      );
      check(
        "application owner drains to the latest desired preference",
        releasedOwner.activeCount === 0 &&
          releasedOwner.keyRecords === 0 &&
          releasedOwner.wakeCandidates === 0 &&
          releasedOwner.wakeAttempt === null &&
          releasedOwner.wakePhase === "idle" &&
          releasedOwner.desiredOnDemand === false &&
          Services.prefs.getBoolPref(ON_DEMAND_PREF, true) === false &&
          transitionsAfterSetting.every(entry => entry.value === false),
        JSON.stringify({ owner: releasedOwner, transitions: report.preferenceTransitions }),
      );

      await releaseAllServer();
      await waitForAsync(
        "held restore slots to drain",
        async () => {
          const server = await serverSnapshot();
          const restored = [1, 2, 3, 4].every(id =>
            report.events.some(
              entry => entry.type === "tab-event" &&
                entry.eventType === "SSTabRestored" && entry.id === id,
            ),
          );
          return Object.keys(server.pending).length === 0 && restored;
        },
      );
      const drainedServer = await serverSnapshot();
      report.server.drained = drainedServer;
      check(
        "held restore slots drain before subsequent work",
        Object.keys(drainedServer.pending).length === 0 &&
          [1, 2, 3, 4].every(id =>
            report.events.some(
              entry => entry.type === "tab-event" &&
                entry.eventType === "SSTabRestored" && entry.id === id,
            ),
          ),
        JSON.stringify({ events: report.events, server: drainedServer }),
      );

      const fast = makeLazyFixture(5, "fast");
      const fastInitial = fixtureState(fast);
      const fastPanel = requestPanelWake("subsequent-fast");
      await waitForAsync(
        "subsequent fast wake",
        async () => {
          const server = await serverSnapshot();
          const snapshot = owner.snapshot();
          return !fast.tab.hasAttribute("pending") &&
            Boolean(fast.tab.linkedPanel) &&
            requestCount(server, "fast-request", 5) === 1 &&
            report.events.some(
              entry => entry.type === "tab-event" &&
                entry.eventType === "SSTabRestored" && entry.id === 5,
            ) &&
            snapshot.activeCount === 0 && snapshot.wakePhase === "idle";
        },
      );
      const fastFinal = fixtureState(fast);
      const fastOwner = ownerSnapshot(owner);
      const fastServer = await serverSnapshot();
      report.fixtures.fast = { initial: fastInitial, final: fastFinal };
      report.owner.fast = fastOwner;
      report.server.fast = fastServer;
      check(
        "a subsequent genuine fast wake still completes",
        fastPanel.disabled === false &&
          fastInitial.pending && !fastInitial.linkedPanel && fastInitial.remote &&
          !fastFinal.pending && fastFinal.linkedPanel && fastFinal.remote &&
          requestCount(fastServer, "fast-request", 5) === 1 &&
          report.events.some(
            entry => entry.type === "tab-event" &&
              entry.eventType === "SSTabRestored" && entry.id === 5,
          ) &&
          fastOwner.activeCount === 0 && fastOwner.keyRecords === 0 &&
          fastOwner.wakePhase === "idle" &&
          Services.prefs.getBoolPref(ON_DEMAND_PREF, true) === false,
        JSON.stringify({ panel: fastPanel, states: report.fixtures.fast, owner: fastOwner }),
      );

      progress("disabling production mod through Sine");
      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = false;
      await waitFor(
        "production disable drain",
        () => {
          const snapshot = owner.snapshot();
          return !window.zenKeepLoaded?.controller &&
            snapshot.registrationCount === 0 &&
            snapshot.activeCount === 0 &&
            snapshot.keyRecords === 0 &&
            snapshot.wakePhase === "idle";
        },
      );
      const disabledOwner = ownerSnapshot(owner);
      report.owner.disabled = disabledOwner;
      check(
        "production disable leaves the application owner drained",
        disabledOwner.registrationCount === 0 &&
          disabledOwner.activeCount === 0 &&
          disabledOwner.keyRecords === 0 &&
          disabledOwner.readyCount === 0 &&
          disabledOwner.trailingCount === 0 &&
          disabledOwner.drainingCount === 0 &&
          disabledOwner.wakeCandidates === 0 &&
          disabledOwner.wakePhase === "idle",
        JSON.stringify(disabledOwner),
      );
      const finalPostSettingTransitions = report.preferenceTransitions.filter(
        entry => entry.atMs >= settingChanged.atMs,
      );
      check(
        "latest desired preference never regresses during follow-up or disable",
        finalPostSettingTransitions.every(entry => entry.value === false) &&
          Services.prefs.getBoolPref(ON_DEMAND_PREF, true) === false,
        JSON.stringify(finalPostSettingTransitions),
      );
      progress("probe complete");
    } catch (error) {
      report.fatal = String(error?.stack ?? error);
      if (reloadPromise) {
        try {
          await Promise.race([reloadPromise, wait(1000)]);
        } catch {}
        reloadPromise = null;
      }
      if (enabled && manager && sineUtils) {
        try {
          // A failed wake may still be holding a SessionStore candidate.  Sine's
          // teardown path can await that stale generation, so keep probe cleanup
          // bounded and let the outer Zen shutdown own the final sweep.
          await Promise.race([
            manager.toggleTheme(await sineUtils.getMods(), options.modId),
            wait(2000),
          ]);
          enabled = false;
        } catch {}
      }
    }

    const cleanupErrors = [];
    try {
      await releaseAllServer();
    } catch (error) {
      cleanupErrors.push("release-all: " + String(error?.stack ?? error));
    }
    try {
      if (tabEventHandler) {
        for (const type of [
          "SSTabRestored",
          "SSTabRestoring",
          "TabBrowserDiscarded",
          "TabBrowserInserted",
        ]) {
          document.removeEventListener(type, tabEventHandler, true);
        }
      }
      for (const fixture of fixtures) {
        if (fixture.tab.isConnected) {
          gBrowser.removeTab(fixture.tab, { animate: false });
        }
      }
    } catch (error) {
      cleanupErrors.push("tabs: " + String(error?.stack ?? error));
    }
    try {
      if (preferenceObserver) {
        Services.prefs.removeObserver(ON_DEMAND_PREF, preferenceObserver);
      }
      restorePreference(LAZY_PINNED_PREF);
      restorePreference(ON_DEMAND_PREF);
    } catch (error) {
      cleanupErrors.push("preferences: " + String(error?.stack ?? error));
    }
    try {
      report.server.cleanup = await serverSnapshot();
    } catch (error) {
      cleanupErrors.push("server-snapshot: " + String(error?.stack ?? error));
    }
    report.cleanup = {
      errors: cleanupErrors,
      fixtures: fixtures.length,
      ok: cleanupErrors.length === 0,
    };
    if (cleanupErrors.length > 0) report.fatal ??= cleanupErrors.join("\\n");
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
  const server = await startWakeTransactionServer();
  let zen;
  try {
    zen = await launchLiveZen({
      stagedMod: {
        enabled: false,
        manifest,
        relativePaths: PRODUCTION_PATHS,
        sourceDirectory: MOD_DIRECTORY,
      },
    });
  } catch (error) {
    await server.stop();
    throw error;
  }

  let client;
  let shutdownPromise;
  let signalExitCode = null;
  const shutdown = () => {
    shutdownPromise ??= (async () => {
      try {
        await client?.quit();
      } finally {
        try {
          await zen.stop();
        } finally {
          await server.stop();
        }
      }
    })();
    return shutdownPromise;
  };
  const exitAfterSignal = code => {
    if (signalExitCode !== null) return;
    signalExitCode = code;
    void shutdown()
      .catch(error =>
        console.error(`wake transaction probe cleanup failed: ${error.stack ?? error}`),
      )
      .finally(() => process.exit(code));
  };
  const onInterrupt = () => exitAfterSignal(130);
  const onTerminate = () => exitAfterSignal(143);
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);

  try {
    client = await openMarionette({
      port: zen.port,
      commandTimeoutMilliseconds: 240_000,
    });
    await client.setScriptTimeout(180_000);
    const result = await client.executeAsync(PROBE, [
      {
        buildId: zen.platformStamp.zen.buildId,
        expectedProtocol: 5,
        expectedWakeTimeoutMs: 20_000,
        geckoVersion: zen.platformStamp.zen.geckoVersion,
        modId: manifest.id,
        probeNonce: `${process.pid}-${Date.now()}`,
        serverBaseUrl: server.baseUrl,
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
      httpFixture: server.snapshot(),
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
    console.log(`Raw production wake-transaction evidence: ${OUTPUT}`);
    if (validationError) {
      console.error(validationError);
      process.exitCode = 1;
    } else {
      console.log(`${verdicts.counts.passed}/${verdicts.counts.total} assertions passed`);
      if (!verdicts.ok) process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      `production wake transaction probe failed: ${error.stack ?? error.message}`,
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
