#!/usr/bin/env node

/** Exercise the shipped crash-recovery event path across a Sine hot reload. */

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
const OUTPUT = resolve(
  REPOSITORY_ROOT,
  ".benchmarks/live/keep-loaded-production-crash-reload.smoke.json",
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
  "production controller and owner become ready",
  "synthetic crash event enters the production recovery path",
  "recovery attempt leaves no reconciliation queued",
  "first recovery attempt drains without wedging the owner",
  "crash budget survives Sine hot reload",
  "exhausted budget does not mutate the tab again",
  "aged attempt becomes eligible again",
  "closed crashed tab is never reopened",
  "external unload still queues reconciliation",
  "Sine reload keeps the same application owner",
  "production disable drains the application owner",
];

const PROBE = `
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  const OWNER_URI = "chrome://sine/content/keep-loaded/dist/keep-loaded.sys.mjs";
  const FLAG = "zenKeepLoaded";
  const MATCH_PREF = "zen.keep-loaded.match";
  const ATTEMPTS_PREF = "zen.keep-loaded.crash-attempts";
  const WINDOW_PREF = "zen.keep-loaded.crash-window-minutes";
  const ON_DEMAND_PREF = "browser.sessionstore.restore_pinned_tabs_on_demand";
  const CACHE_ID = "appMenu-viewCache";
  const VIEW_ID = "keep-loaded-panelview";
  const WAKE_ID = "keep-loaded-wake-button";
  const nativeNow = Date.now.bind(Date);
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  let SessionStore = null;
  const report = {
    assertions: [],
    events: [],
    fatal: null,
    platform: null,
    snapshots: [],
    tabs: {},
  };
  let sequence = 0;
  const event = (type, detail = {}) => {
    const row = { seq: ++sequence, at: new Date().toISOString(), type, ...detail };
    report.events.push(row);
    return row;
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
  const browserState = tab => ({
    connected: tab.isConnected === true,
    linkedPanel: Boolean(tab.linkedPanel),
    pending: tab.hasAttribute("pending"),
    pinned: tab.pinned === true,
    remote: tab.linkedBrowser?.isRemoteBrowser === true,
    url: tab.linkedBrowser?.currentURI?.spec ?? "",
  });
  const ownerSnapshot = owner => {
    const snapshot = owner.snapshot();
    report.snapshots.push({ at: new Date().toISOString(), snapshot });
    return snapshot;
  };
  const controllerReady = () => {
    try {
      return window.zenKeepLoaded?.controller?.isLive() === true &&
        Boolean(window.zenKeepLoaded?.application?.()?.registrationId);
    } catch {
      return false;
    }
  };
  const dispatchSyntheticCrash = tab => {
    tab.setAttribute("pending", "true");
    const crash = new Event("oop-browser-crashed", { bubbles: true });
    Object.defineProperty(crash, "isTopFrame", { value: true });
    event("synthetic-crash", { state: browserState(tab) });
    tab.linkedBrowser.dispatchEvent(crash);
  };
  const dispatchExternalDiscard = tab => {
    event("external-discard", { state: browserState(tab) });
    tab.dispatchEvent(new Event("TabBrowserDiscarded", { bubbles: true }));
  };
  const cachedView = () =>
    document.getElementById(VIEW_ID) ??
    document.getElementById(CACHE_ID)?.content.querySelector("#" + VIEW_ID) ??
    null;
  const requestSweep = () => {
    const action = cachedView()?.querySelector("#" + WAKE_ID);
    if (!action) throw new Error("production wake action is unavailable");
    action.dispatchEvent(new Event("command", { bubbles: true }));
  };

  (async () => {
    let enabled = false;
    let manager = null;
    let sineUtils = null;
    let owner = null;
    const original = {};
    const remember = name => {
      original[name] = {
        hadUserValue: Services.prefs.prefHasUserValue(name),
        value: Services.prefs.getStringPref(name, ""),
      };
    };
    const restore = name => {
      const value = original[name];
      if (!value) return;
      if (value.hadUserValue) Services.prefs.setStringPref(name, value.value);
      else Services.prefs.clearUserPref(name);
    };
    const fixtureTabs = new Map();
    const blockers = [];
    const tabEvent = eventValue => {
      const tab = eventValue.target;
      const fixture = fixtureTabs.get(tab);
      if (!fixture) return;
      event("tab-event", {
        eventType: eventValue.type,
        id: fixture.id,
        state: browserState(tab),
        owner: owner ? ownerSnapshot(owner) : null,
      });
    };
    const createTab = id => {
      const tab = gBrowser.addTab("data:text/html,<title>Keep Loaded C03 " + id + "</title>", {
        inBackground: true,
        skipRoute: true,
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
      if (!tab) throw new Error("Zen refused to create crash fixture " + id);
      gBrowser.pinTab(tab);
      SessionStore.setCustomTabValue(tab, FLAG, "true");
      gZenWorkspaces._allStoredTabs = null;
      const fixture = { id, tab };
      fixtureTabs.set(tab, fixture);
      report.tabs[id] = { created: browserState(tab) };
      return fixture;
    };
    const createBlocker = id => {
      const tab = gBrowser.addTab("about:blank", {
        createLazyBrowser: true,
        inBackground: true,
        lazyTabTitle: "crash causal blocker " + id,
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
      if (!tab) throw new Error("Zen refused to create blocker " + id);
      gBrowser.pinTab(tab);
      SessionStore.setCustomTabValue(tab, FLAG, "true");
      gZenWorkspaces._allStoredTabs = null;
      const originalInsert = gBrowser._insertBrowser;
      const originalLinkedPanel = Object.getOwnPropertyDescriptor(tab, "linkedPanel");
      const blocker = {
        calls: 0,
        id,
        inserted: false,
        originalInsert,
        originalLinkedPanel,
        tab,
      };
      Object.defineProperty(tab, "linkedPanel", {
        configurable: true,
        get: () => blocker.inserted ? "keep-loaded-crash-blocker-" + id : "",
      });
      const installedInsert = function(candidate) {
        if (candidate === tab) {
          blocker.calls += 1;
          blocker.inserted = true;
          event("blocker-held", { id, owner: ownerSnapshot(owner) });
          return;
        }
        return originalInsert.call(this, candidate);
      };
      blocker.installedInsert = installedInsert;
      gBrowser._insertBrowser = installedInsert;
      blockers.push(blocker);
      return blocker;
    };
    const releaseBlocker = blocker => {
      blocker.tab.removeAttribute("pending");
      event("blocker-release", { id: blocker.id, owner: ownerSnapshot(owner) });
    };
    const destroyBlocker = blocker => {
      if (gBrowser._insertBrowser === blocker.installedInsert) {
        gBrowser._insertBrowser = blocker.originalInsert;
      }
      if (blocker.originalLinkedPanel) {
        Object.defineProperty(blocker.tab, "linkedPanel", blocker.originalLinkedPanel);
      } else {
        delete blocker.tab.linkedPanel;
      }
      if (blocker.tab.isConnected) {
        gBrowser.removeTab(blocker.tab, { animate: false });
      }
    };
    const beginBlockedSweep = async id => {
      await waitFor(
        id + " owner idle",
        () => owner.snapshot().activeCount === 0 && owner.snapshot().keyRecords === 0,
      );
      const blocker = createBlocker(id);
      requestSweep();
      await waitFor(
        id + " active sweep",
        () => blocker.calls === 1 && owner.snapshot().activeKind === "sweep",
      );
      return blocker;
    };
    try {
      manager = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/manager.sys.mjs",
      ).default;
      sineUtils = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/utils.sys.mjs",
      ).default;
      const { SessionStore: store } = ChromeUtils.importESModule(
        "resource:///modules/sessionstore/SessionStore.sys.mjs",
      );
      SessionStore = store;
      await waitFor(
        "primary Sine interface",
        () => typeof window.addUnloadListener === "function" && window.gBrowser,
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
      remember(MATCH_PREF);
      remember(ATTEMPTS_PREF);
      remember(WINDOW_PREF);
      Services.prefs.setStringPref(MATCH_PREF, "");
      Services.prefs.setStringPref(ATTEMPTS_PREF, "1");
      Services.prefs.setStringPref(WINDOW_PREF, "60");
      const tabEvents = [
        "SSTabRestoring",
        "SSTabRestored",
        "TabBrowserDiscarded",
        "TabBrowserInserted",
      ];
      for (const type of tabEvents) document.addEventListener(type, tabEvent, true);

      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = true;
      await waitFor("production controller and owner", controllerReady);
      owner = ChromeUtils.importESModule(OWNER_URI);
      await waitFor(
        "idle production owner",
        () => owner.snapshot().registrationCount === 1 && owner.snapshot().activeCount === 0,
      );
      check(
        "production controller and owner become ready",
        controllerReady() && owner.snapshot().protocol === options.expectedProtocol,
        JSON.stringify(ownerSnapshot(owner)),
      );

      const primary = createTab("primary");
      await waitFor("primary remote fixture", () => primary.tab.linkedBrowser?.isRemoteBrowser);
      await waitFor(
        "primary content fixture",
        () => primary.tab.linkedBrowser?.currentURI?.spec?.startsWith("data:"),
      );
      const initialDiscardCount = () =>
        report.events.filter(
          row => row.type === "tab-event" && row.eventType === "TabBrowserDiscarded" && row.id === "primary",
        ).length;
      const beforeFirstDiscard = initialDiscardCount();
      dispatchSyntheticCrash(primary.tab);
      await waitFor(
        "production recovery operation",
        () => owner.snapshot().activeKind === "recovery" || initialDiscardCount() > beforeFirstDiscard,
      );
      const recoveryStarted = ownerSnapshot(owner);
      check(
        "synthetic crash event enters the production recovery path",
        report.events.some(row => row.type === "synthetic-crash") &&
          (recoveryStarted.activeKind === "recovery" || initialDiscardCount() > beforeFirstDiscard),
        JSON.stringify({ owner: recoveryStarted, state: browserState(primary.tab) }),
      );
      await waitFor(
        "first recovery to settle",
        () => owner.snapshot().activeCount === 0,
        45000,
      );
      report.tabs.primary.first = browserState(primary.tab);
      check(
        "recovery attempt leaves no reconciliation queued",
        owner.snapshot().activeCount === 0 && owner.snapshot().keyRecords === 0,
        JSON.stringify({ owner: ownerSnapshot(owner), state: report.tabs.primary.first }),
      );
      check(
        "first recovery attempt drains without wedging the owner",
        primary.tab.isConnected && primary.tab.pinned && owner.snapshot().activeCount === 0,
        JSON.stringify(report.tabs.primary.first),
      );

      const firstController = window.zenKeepLoaded.controller;
      await manager.rebuildMods(true, false);
      await waitFor(
        "replacement controller",
        () => controllerReady() && window.zenKeepLoaded.controller !== firstController,
      );
      await waitFor("replacement owner idle", () => owner.snapshot().registrationCount === 1 && owner.snapshot().activeCount === 0);
      check(
        "Sine reload keeps the same application owner",
        owner.snapshot().applicationId === window.zenKeepLoaded.application().applicationId,
        JSON.stringify(ownerSnapshot(owner)),
      );

      const discardBeforeExhausted = initialDiscardCount();
      primary.tab.removeAttribute("pending");
      const budgetBlocker = await beginBlockedSweep("budget");
      primary.tab.setAttribute("pending", "true");
      dispatchSyntheticCrash(primary.tab);
      const budgetQueued = await waitFor(
        "budget recovery queued behind blocker",
        () => {
          const snapshot = owner.snapshot();
          return snapshot.activeKind === "sweep" && snapshot.keyRecords === 2 &&
            snapshot.readyCount === 1;
        },
      );
      event("budget-recovery-queued", { owner: ownerSnapshot(owner) });
      releaseBlocker(budgetBlocker);
      await waitFor(
        "budget recovery rejection drain",
        () => owner.snapshot().activeCount === 0 && owner.snapshot().keyRecords === 0,
      );
      destroyBlocker(budgetBlocker);
      const exhaustedState = browserState(primary.tab);
      check(
        "crash budget survives Sine hot reload",
        Boolean(budgetQueued) && owner.snapshot().activeCount === 0 &&
          initialDiscardCount() === discardBeforeExhausted,
        JSON.stringify({ owner: ownerSnapshot(owner), state: exhaustedState }),
      );
      check(
        "exhausted budget does not mutate the tab again",
        initialDiscardCount() === discardBeforeExhausted &&
          report.events.filter(row => row.type === "tab-event" && row.eventType === "TabBrowserInserted" && row.id === "primary").length <= 1,
        JSON.stringify(exhaustedState),
      );

      Services.prefs.setStringPref(WINDOW_PREF, "0.001");
      await wait(100);
      dispatchSyntheticCrash(primary.tab);
      const agedRecoveryStarted = await waitFor(
        "aged recovery operation",
        () => owner.snapshot().activeKind === "recovery",
        5000,
      );
      await waitFor("aged recovery", () => owner.snapshot().activeCount === 0, 45000);
      check(
        "aged attempt becomes eligible again",
        Boolean(agedRecoveryStarted) && owner.snapshot().activeCount === 0,
        JSON.stringify({ owner: ownerSnapshot(owner), state: browserState(primary.tab) }),
      );

      const closed = createTab("closed");
      await waitFor("closed fixture remote browser", () => closed.tab.linkedBrowser?.isRemoteBrowser);
      await waitFor(
        "closed content fixture",
        () => closed.tab.linkedBrowser?.currentURI?.spec?.startsWith("data:"),
      );
      primary.tab.removeAttribute("pending");
      const closeBlocker = await beginBlockedSweep("queued-close");
      dispatchSyntheticCrash(closed.tab);
      const closeQueued = await waitFor(
        "closed recovery queued behind blocker",
        () => owner.snapshot().activeKind === "sweep" &&
          owner.snapshot().keyRecords === 2 && owner.snapshot().readyCount === 1,
      );
      event("closed-recovery-queued", { owner: ownerSnapshot(owner) });
      gBrowser.removeTab(closed.tab, { animate: false });
      await waitFor("closed fixture removal", () => !closed.tab.isConnected && !gBrowser.tabs.includes(closed.tab));
      const closeCanceled = await waitFor(
        "closed recovery invalidated before blocker release",
        () => owner.snapshot().activeKind === "sweep" &&
          owner.snapshot().keyRecords === 1 && owner.snapshot().readyCount === 0,
      );
      event("closed-recovery-canceled", { owner: ownerSnapshot(owner) });
      releaseBlocker(closeBlocker);
      await waitFor(
        "closed recovery owner drain",
        () => owner.snapshot().activeCount === 0 && owner.snapshot().keyRecords === 0,
      );
      destroyBlocker(closeBlocker);
      check(
        "closed crashed tab is never reopened",
        Boolean(closeQueued) && Boolean(closeCanceled) &&
          !closed.tab.isConnected && !gBrowser.tabs.includes(closed.tab) &&
          !report.events.some(row => row.type === "tab-event" && row.id === "closed" && row.eventType === "TabBrowserInserted"),
        JSON.stringify({ connected: closed.tab.isConnected, owner: ownerSnapshot(owner) }),
      );

      primary.tab.removeAttribute("pending");
      const unloadBlocker = await beginBlockedSweep("external-unload");
      dispatchExternalDiscard(primary.tab);
      const unloadTrailing = await waitFor(
        "external unload trailing sweep",
        () => owner.snapshot().activeKind === "sweep" &&
          owner.snapshot().keyRecords === 1 && owner.snapshot().trailingCount === 1,
      );
      event("external-unload-trailing", { owner: ownerSnapshot(owner) });
      releaseBlocker(unloadBlocker);
      await waitFor(
        "external unload reconciliation drain",
        () => owner.snapshot().activeCount === 0 && owner.snapshot().keyRecords === 0,
      );
      destroyBlocker(unloadBlocker);
      check(
        "external unload still queues reconciliation",
        Boolean(unloadTrailing) &&
          report.events.some(row => row.type === "external-discard") &&
          report.events.some(row => row.type === "external-unload-trailing") &&
          owner.snapshot().activeCount === 0,
        JSON.stringify(ownerSnapshot(owner)),
      );
      report.tabs.primary.final = browserState(primary.tab);
      gBrowser.removeTab(primary.tab, { animate: false });
      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = false;
      await waitFor("application owner after disable", () => owner.snapshot().registrationCount === 0 && owner.snapshot().activeCount === 0);
      report.disableOwner = ownerSnapshot(owner);
      check(
        "production disable drains the application owner",
        report.disableOwner.registrationCount === 0 &&
          report.disableOwner.activeCount === 0 &&
          report.disableOwner.keyRecords === 0,
        JSON.stringify(report.disableOwner),
      );
    } finally {
      for (const type of [
        "SSTabRestoring",
        "SSTabRestored",
        "TabBrowserDiscarded",
        "TabBrowserInserted",
      ]) document.removeEventListener(type, tabEvent, true);
      for (const fixture of fixtureTabs.values()) {
        if (fixture.tab.isConnected) {
          try { gBrowser.removeTab(fixture.tab, { animate: false }); } catch {}
        }
      }
      for (const blocker of blockers) {
        try { destroyBlocker(blocker); } catch {}
      }
      if (enabled) {
        try { await manager.toggleTheme(await sineUtils.getMods(), options.modId); } catch {}
      }
      restore(MATCH_PREF);
      restore(ATTEMPTS_PREF);
      restore(WINDOW_PREF);
      SessionStore = null;
    }
  })().then(
    () => done(report),
    error => {
      report.fatal = String(error?.stack ?? error);
      done(report);
    },
  );
`;

const atomicWriteJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
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
  const removeShutdownSignals = installShutdownSignals({
    label: "production crash-reload probe",
    shutdown,
  });
  try {
    client = await openMarionette({
      port: zen.port,
      commandTimeoutMilliseconds: 240_000,
    });
    await client.setScriptTimeout(180_000);
    const result = await client.executeAsync(PROBE, [
      {
        buildId: zen.platformStamp.zen.buildId,
        expectedProtocol: 10,
        geckoVersion: zen.platformStamp.zen.geckoVersion,
        modId: manifest.id,
        sineVersion: zen.platformStamp.sine.version,
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
      contract: {
        requiredAssertions: REQUIRED_ASSERTIONS,
        trigger:
          "synthetic oop-browser-crashed event through production liveness observer",
      },
      validation: { error: validationError, verdicts },
      result,
    };
    await atomicWriteJson(OUTPUT, artifact);
    for (const assertion of result?.assertions ?? []) {
      console.log(`  ${assertion.ok ? "PASS" : "FAIL"}  ${assertion.name}`);
      if (!assertion.ok) console.log(`        ${assertion.detail}`);
    }
    console.log(`Raw production crash-reload evidence: ${OUTPUT}`);
    if (validationError) {
      console.error(validationError);
      process.exitCode = 1;
    } else if (!verdicts.ok) {
      process.exitCode = 1;
    }
  } finally {
    try {
      await shutdown();
    } finally {
      removeShutdownSignals();
    }
  }
};

await main();
