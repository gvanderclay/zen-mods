#!/usr/bin/env node

/** Seeded application-owner and shipped-bundle stress lanes for Keep Loaded. */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { openMarionette } from "@zen-mods/live-harness/marionette";
import {
  installShutdownSignals,
  launchLiveZen,
} from "@zen-mods/live-harness/zen-launcher";
import { build } from "esbuild";
import {
  parseStressArguments,
  resolveBrowserReloadCounts,
  validateStressArtifact,
} from "./stress-core.mjs";
import { startWakeTransactionServer } from "./wake-transaction-server.mjs";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MOD_DIRECTORY = resolve(DIRECTORY, "../..");
const REPOSITORY_ROOT = resolve(MOD_DIRECTORY, "../..");
const MODEL_ENTRY = resolve(DIRECTORY, "application-stress.ts");
const MANIFEST_PATH = resolve(MOD_DIRECTORY, "theme.json");
const PRODUCTION_PATHS = [
  "dist/keep-loaded.sys.mjs",
  "dist/keep-loaded.uc.mjs",
  "preferences.json",
  "styles/chrome.css",
];
const execFileAsync = promisify(execFile);

const BROWSER_PROBE = String.raw`
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  const OWNER_URI = "chrome://sine/content/keep-loaded/dist/keep-loaded.sys.mjs";
  const FLAG = "zenKeepLoaded";
  const PROBE_VALUE = "keepLoadedStress";
  const ON_DEMAND_PREF = "browser.sessionstore.restore_pinned_tabs_on_demand";
  const LAZY_PREF = "zen.keep-loaded.lazy-pinned";
  const MATCH_PREF = "zen.keep-loaded.match";
  const FRESHEN_PREF = "zen.keep-loaded.freshen-seconds";
  const nativeNow = Date.now.bind(Date);
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const report = {
    activeDisable: null,
    completedEvents: 0,
    controllers: null,
    eventLoop: { intervalMs: 50, maxDelayMs: 0, samples: 0 },
    expectedEvents: options.expectedEvents,
    fatal: null,
    finalOwner: null,
    maxActive: 0,
    maxKeyRecords: 0,
    platform: null,
    preferenceDrift: null,
    processSamples: [],
    reloadLatenciesMs: [],
    resourcesDrained: false,
    rounds: [],
    traceTail: [],
  };
  let nextEventLoopTick = nativeNow() + report.eventLoop.intervalMs;
  const eventLoopTimer = window.setInterval(() => {
    const now = nativeNow();
    report.eventLoop.maxDelayMs = Math.max(
      report.eventLoop.maxDelayMs,
      Math.max(0, now - nextEventLoopTick),
    );
    report.eventLoop.samples += 1;
    nextEventLoopTick = now + report.eventLoop.intervalMs;
  }, report.eventLoop.intervalMs);
  const trace = (type, detail = {}) => {
    report.traceTail.push({ at: nativeNow(), type, ...detail });
    if (report.traceTail.length > 200) report.traceTail.shift();
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  const browserWindows = () => {
    const windows = [];
    const enumerator = Services.wm.getEnumerator("navigator:browser");
    while (enumerator.hasMoreElements()) windows.push(enumerator.getNext());
    return windows.filter(candidate => !candidate.closed && candidate.gBrowser);
  };
  let owner = null;
  const sampleOwner = label => {
    if (!owner) return null;
    const snapshot = clone(owner.snapshot());
    report.maxActive = Math.max(report.maxActive, snapshot.activeCount);
    report.maxKeyRecords = Math.max(report.maxKeyRecords, snapshot.keyRecords);
    if (snapshot.activeCount > 1) {
      throw new Error("application work overlapped at " + label + ": " + JSON.stringify(snapshot));
    }
    return snapshot;
  };
  const waitFor = async (label, read, timeout = 60000) => {
    const deadline = nativeNow() + timeout;
    let value;
    while (nativeNow() < deadline) {
      sampleOwner(label);
      value = await read();
      if (value) return value;
      await wait(25);
    }
    throw new Error("timed out waiting for " + label + "; last=" + JSON.stringify(value));
  };
  const controllerReady = targetWindow => {
    try {
      const facade = targetWindow.zenKeepLoaded;
      return facade?.controller?.isLive() === true &&
        facade.controller.state?.kind === "live" &&
        Boolean(facade.application?.().registrationId);
    } catch {
      return false;
    }
  };
  const ownerIdle = expectedRegistrations => {
    const snapshot = sampleOwner("owner idle");
    return snapshot?.protocol === options.expectedProtocol &&
      snapshot.registrationCount === expectedRegistrations &&
      snapshot.activeCount === 0 &&
      snapshot.drainingCount === 0 &&
      snapshot.keyRecords === 0 &&
      snapshot.wakeCandidates === 0 &&
      snapshot.wakePhase === "idle";
  };
  const serverSnapshot = async () => {
    const response = await fetch(options.serverBaseUrl + "/control/snapshot", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("server snapshot failed: " + response.status);
    return response.json();
  };
  const releaseAll = async () => {
    const response = await fetch(options.serverBaseUrl + "/control/release-all", {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("server release failed: " + response.status);
    return response.json();
  };
  const processSample = async label => {
    try {
      const info = await ChromeUtils.requestProcInfo();
      const resident = processInfo => Number(
        processInfo?.residentSetSize ?? processInfo?.memory ?? 0,
      );
      const children = Array.isArray(info?.children) ? info.children : [];
      const sample = {
        at: nativeNow(),
        childCount: children.length,
        label,
        residentBytes: resident(info) + children.reduce(
          (total, child) => total + resident(child),
          0,
        ),
      };
      report.processSamples.push(sample);
      return sample;
    } catch (error) {
      const sample = { at: nativeNow(), error: String(error), label, residentBytes: null };
      report.processSamples.push(sample);
      return sample;
    }
  };

  (async () => {
    const fixtures = [];
    const secondaryWindows = [];
    const controllers = new Set();
    const savedPreferences = new Map();
    let enabled = false;
    let manager = null;
    let sineUtils = null;
    let initialOnDemand = null;
    const saveBool = name => {
      const hadUserValue = Services.prefs.prefHasUserValue(name);
      savedPreferences.set(name, {
        hadUserValue,
        kind: "bool",
        value: hadUserValue ? Services.prefs.getBoolPref(name) : null,
      });
    };
    const saveString = name => {
      const hadUserValue = Services.prefs.prefHasUserValue(name);
      savedPreferences.set(name, {
        hadUserValue,
        kind: "string",
        value: hadUserValue ? Services.prefs.getStringPref(name) : null,
      });
    };
    try {
      manager = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/manager.sys.mjs"
      ).default;
      sineUtils = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/utils.sys.mjs"
      ).default;
      const { SessionStore } = ChromeUtils.importESModule(
        "resource:///modules/sessionstore/SessionStore.sys.mjs"
      );
      report.platform = {
        buildId: Services.appinfo.appBuildID,
        geckoVersion: Services.appinfo.platformVersion,
        sineVersion: options.sineVersion,
        zenVersion: Services.appinfo.version,
      };
      if (Services.appinfo.version !== options.zenVersion ||
          Services.appinfo.appBuildID !== options.buildId ||
          Services.appinfo.platformVersion !== options.geckoVersion) {
        throw new Error("exact Zen platform stamp mismatch");
      }
      const mods = await sineUtils.getMods();
      if (mods[options.modId]?.enabled !== false || window.zenKeepLoaded) {
        throw new Error("production stress mod did not start disabled");
      }

      saveBool(ON_DEMAND_PREF);
      saveBool(LAZY_PREF);
      saveString(MATCH_PREF);
      saveString(FRESHEN_PREF);
      Services.prefs.setBoolPref(ON_DEMAND_PREF, true);
      Services.prefs.setBoolPref(LAZY_PREF, true);
      Services.prefs.setStringPref(MATCH_PREF, "stress-initial.invalid");
      Services.prefs.setStringPref(FRESHEN_PREF, "0");
      initialOnDemand = Services.prefs.getBoolPref(ON_DEMAND_PREF);

      const maximumWindows = Math.max(...options.rounds.map(round => round.windows));
      while (browserWindows().length < maximumWindows) {
        const opened = OpenBrowserWindow({ openerWindow: window });
        secondaryWindows.push(opened);
        await waitFor("new browser window", () =>
          !opened.closed && opened.gBrowser &&
          typeof opened.addUnloadListener === "function" &&
          opened.gZenWorkspaces?._hasInitializedTabsStrip === true
        );
      }
      const windows = browserWindows().slice(0, maximumWindows);
      await Promise.all(windows.map(targetWindow =>
        targetWindow.gZenWorkspaces?.promiseInitialized ?? Promise.resolve()
      ));

      const makeFixture = (targetWindow, id, kind = "fast") => {
        const url = options.serverBaseUrl + "/" + kind + "/" + String(id);
        const uri = Services.io.newURI(url);
        const principal = Services.scriptSecurityManager.createContentPrincipal(uri, {});
        const tab = targetWindow.gBrowser.addTab(url, {
          createLazyBrowser: true,
          inBackground: true,
          lazyTabTitle: "Keep Loaded stress " + String(id),
          skipRoute: true,
          triggeringPrincipal: principal,
        });
        if (!tab) throw new Error("Zen refused stress fixture " + String(id));
        targetWindow.gBrowser.pinTab(tab);
        SessionStore.setCustomTabValue(tab, FLAG, "true");
        SessionStore.setCustomTabValue(tab, PROBE_VALUE, options.nonce + ":" + id);
        targetWindow.gZenWorkspaces._allStoredTabs = null;
        const fixture = { id, kind, tab, targetWindow, url };
        fixtures.push(fixture);
        return fixture;
      };
      const isGenuineLazy = fixture =>
        fixture.tab.isConnected &&
        fixture.tab.hasAttribute("pending") &&
        !fixture.tab.linkedPanel &&
        SessionStore.getCustomTabValue(fixture.tab, FLAG) === "true";
      const removeFixtures = list => {
        for (const fixture of list) {
          if (fixture.tab.isConnected && !fixture.targetWindow.closed) {
            fixture.targetWindow.gBrowser.removeTab(fixture.tab, { animate: false });
          }
          const index = fixtures.indexOf(fixture);
          if (index >= 0) fixtures.splice(index, 1);
        }
      };

      let nextFixtureId = 1;
      let activeWindows = windows.slice(0, options.rounds[0].windows);
      const firstRoundFixtures = [];
      for (let index = 0; index < options.rounds[0].tabs; index += 1) {
        firstRoundFixtures.push(
          makeFixture(activeWindows[index % activeWindows.length], nextFixtureId++),
        );
      }
      const firstRoundLazy = firstRoundFixtures.filter(isGenuineLazy).length;
      if (firstRoundLazy !== firstRoundFixtures.length) {
        throw new Error("first stress round did not begin as genuine lazy tabs");
      }
      trace("enable", { tabs: firstRoundFixtures.length, windows: activeWindows.length });
      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = true;
      await waitFor("all production controllers", () =>
        activeWindows.every(controllerReady)
      );
      owner = ChromeUtils.importESModule(OWNER_URI);
      await waitFor("initial application drain", () => ownerIdle(activeWindows.length), 120000);
      await processSample("initial-drain");
      for (const targetWindow of activeWindows) controllers.add(targetWindow.zenKeepLoaded.controller);

      const waitForFastRequests = async (ids, label) =>
        waitFor(label, async () => {
          const snapshot = await serverSnapshot();
          const requested = new Set(
            snapshot.events
              .filter(entry => entry.type === "fast-request")
              .map(entry => entry.id),
          );
          const requestedCount = ids.filter(id => requested.has(id)).length;
          const previous = report.traceTail.at(-1);
          if (previous?.type !== "network-progress" ||
              previous.requested !== requestedCount ||
              previous.total !== ids.length) {
            trace("network-progress", {
              owner: sampleOwner(label),
              pendingByWindow: browserWindows().map(targetWindow => ({
                pending: fixtures.filter(fixture =>
                  fixture.targetWindow === targetWindow &&
                  ids.includes(fixture.id) &&
                  fixture.tab.hasAttribute("pending")
                ).length,
                window: browserWindows().indexOf(targetWindow),
              })),
              requested: requestedCount,
              total: ids.length,
            });
          }
          return ids.every(id => requested.has(id));
        }, 120000);
      await waitForFastRequests(firstRoundFixtures.map(fixture => fixture.id), "first round network starts");
      const firstRoundServer = await serverSnapshot();

      const reloadCounts = options.reloadsByRound;
      for (let roundIndex = 0; roundIndex < options.rounds.length; roundIndex += 1) {
        const round = options.rounds[roundIndex];
        activeWindows = windows.slice(0, round.windows);
        let roundFixtures = roundIndex === 0 ? firstRoundFixtures : [];
        let roundLazyBeforeWake = firstRoundLazy;
        let roundServer = firstRoundServer;
        if (roundIndex > 0) {
          for (let index = 0; index < round.tabs; index += 1) {
            roundFixtures.push(
              makeFixture(activeWindows[index % activeWindows.length], nextFixtureId++),
            );
          }
          roundLazyBeforeWake = roundFixtures.filter(isGenuineLazy).length;
          if (roundLazyBeforeWake !== roundFixtures.length) {
            throw new Error("stress round did not begin as genuine lazy tabs");
          }
          Services.prefs.setStringPref(
            MATCH_PREF,
            "stress-round-" + String(roundIndex) + ".invalid",
          );
          await waitForFastRequests(
            roundFixtures.map(fixture => fixture.id),
            "round " + String(roundIndex + 1) + " network starts",
          );
          roundServer = await serverSnapshot();
          await waitFor("round application drain", () => ownerIdle(activeWindows.length), 120000);
        }
        const roundIds = new Set(roundFixtures.map(fixture => fixture.id));
        const roundFastRequests = roundServer.events.filter(
          entry => entry.type === "fast-request" && roundIds.has(entry.id),
        ).length;
        const roundEvidence = {
          expectedReloads: reloadCounts[roundIndex],
          fastRequests: roundFastRequests,
          index: roundIndex + 1,
          lazyBeforeWake: roundLazyBeforeWake,
          reloads: 0,
          tabs: round.tabs,
          windows: round.windows,
        };
        report.completedEvents += 1;

        for (let reloadIndex = 0; reloadIndex < reloadCounts[roundIndex]; reloadIndex += 1) {
          const selected = roundFixtures[(reloadIndex * 17 + options.seed) % roundFixtures.length];
          if (selected?.tab.isConnected) {
            selected.targetWindow.gBrowser.selectedTab = selected.tab;
            selected.targetWindow.gBrowser.unpinTab(selected.tab);
            selected.targetWindow.gBrowser.pinTab(selected.tab);
            SessionStore.setCustomTabValue(selected.tab, FLAG, "true");
            selected.targetWindow.gZenWorkspaces._allStoredTabs = null;
          }
          Services.prefs.setStringPref(
            MATCH_PREF,
            "stress-reload-" + String(roundIndex) + "-" + String(reloadIndex) + ".invalid",
          );
          const oldControllers = activeWindows.map(targetWindow => targetWindow.zenKeepLoaded.controller);
          const oldRegistrations = activeWindows.map(
            targetWindow => targetWindow.zenKeepLoaded.application().registrationId,
          );
          const startedAt = nativeNow();
          await manager.rebuildMods(true, false);
          await waitFor("replacement controllers", () =>
            activeWindows.every((targetWindow, index) =>
              controllerReady(targetWindow) &&
              targetWindow.zenKeepLoaded.controller !== oldControllers[index] &&
              targetWindow.zenKeepLoaded.application().registrationId !== oldRegistrations[index]
            ) && ownerIdle(activeWindows.length),
            120000,
          );
          for (const controller of oldControllers) {
            if (controller.isLive() || controller.pendingTimers !== 0 || controller.pendingWaits !== 0) {
              throw new Error("replaced controller retained stress resources");
            }
            controllers.add(controller);
          }
          for (const targetWindow of activeWindows) controllers.add(targetWindow.zenKeepLoaded.controller);
          const latency = nativeNow() - startedAt;
          report.reloadLatenciesMs.push(latency);
          roundEvidence.reloads += 1;
          report.completedEvents += 1;
          trace("reload", { latency, round: roundIndex + 1 });
          if (options.cycleDelayMs > 0) await wait(options.cycleDelayMs);
        }
        report.rounds.push(roundEvidence);
        await processSample("round-" + String(roundIndex + 1));
        removeFixtures(roundFixtures);
        await waitFor("post-round owner drain", () => ownerIdle(activeWindows.length), 120000);
      }

      activeWindows = windows;
      const held = [0, 1, 2, 3].map(index =>
        makeFixture(activeWindows[index % activeWindows.length], nextFixtureId++, "hold")
      );
      Services.prefs.setStringPref(MATCH_PREF, "stress-held.invalid");
      await waitFor("active final wake transaction", () => {
        const snapshot = sampleOwner("held final wake");
        return snapshot?.activeCount === 1 &&
          snapshot.activeKind === "sweep" &&
          snapshot.wakePhase === "waiting" &&
          snapshot.wakeCandidates >= 1 &&
          Services.prefs.getBoolPref(ON_DEMAND_PREF) === false;
      }, 120000);
      const activeDisableBefore = sampleOwner("active disable precondition");
      report.activeDisable = {
        beforeOwner: activeDisableBefore,
        heldCandidates: held.filter(fixture => fixture.tab.isConnected).length,
        prefHeld: Services.prefs.getBoolPref(ON_DEMAND_PREF),
      };
      const liveControllers = activeWindows.map(targetWindow => targetWindow.zenKeepLoaded.controller);
      const disable = Promise.resolve(manager.toggleTheme(await sineUtils.getMods(), options.modId));
      await waitFor("active Sine disable", () => {
        const snapshot = sampleOwner("active disable");
        return liveControllers.every(controller => !controller.isLive()) &&
          snapshot?.registrationCount === 0 &&
          snapshot.activeCount === 0 &&
          snapshot.keyRecords === 0 &&
          snapshot.wakeCandidates === 0 &&
          snapshot.wakePhase === "idle";
      }, 120000);
      await releaseAll();
      await disable;
      enabled = false;
      for (const controller of liveControllers) controllers.add(controller);
      report.completedEvents += 1;
      report.finalOwner = sampleOwner("final owner");
      report.activeDisable.afterOwner = report.finalOwner;
      report.preferenceDrift = Services.prefs.getBoolPref(ON_DEMAND_PREF) !== initialOnDemand;
      const retainedControllers = [...controllers];
      report.controllers = {
        pendingTimers: retainedControllers.reduce(
          (total, controller) => total + controller.pendingTimers,
          0,
        ),
        pendingWaits: retainedControllers.reduce(
          (total, controller) => total + controller.pendingWaits,
          0,
        ),
        retained: retainedControllers.length,
        stopped: retainedControllers.filter(controller => !controller.isLive()).length,
      };
      report.resourcesDrained = retainedControllers.every(controller =>
        !controller.isLive() && controller.pendingTimers === 0 && controller.pendingWaits === 0
      ) &&
        report.finalOwner.registrationCount === 0 &&
        report.finalOwner.statusWidgetLeases === 0 &&
        report.finalOwner.statusWidgetPhase === "absent";
      await processSample("final-disable");
      removeFixtures(held);
    } catch (error) {
      report.fatal = String(error) + "\n" + String(error?.stack ?? "");
    } finally {
      window.clearInterval(eventLoopTimer);
      try {
        await releaseAll();
      } catch {}
      try {
        if (enabled && manager && sineUtils) {
          await manager.toggleTheme(await sineUtils.getMods(), options.modId);
        }
      } catch (error) {
        report.fatal = report.fatal ?? String(error) + "\n" + String(error?.stack ?? "");
      }
      try {
        for (const fixture of [...fixtures]) {
          if (fixture.tab.isConnected && !fixture.targetWindow.closed) {
            fixture.targetWindow.gBrowser.removeTab(fixture.tab, { animate: false });
          }
        }
      } catch {}
      try {
        for (const [name, saved] of savedPreferences) {
          if (!saved.hadUserValue) Services.prefs.clearUserPref(name);
          else if (saved.kind === "bool") Services.prefs.setBoolPref(name, saved.value);
          else Services.prefs.setStringPref(name, saved.value);
        }
      } catch (error) {
        report.fatal = report.fatal ?? String(error) + "\n" + String(error?.stack ?? "");
      }
      done(report);
    }
  })();
`;

const usage = `Keep Loaded stress runner

  pnpm --filter @zen-mods/keep-loaded stress --profile quick
  pnpm --filter @zen-mods/keep-loaded stress --profile standard --seed 184467
  pnpm --filter @zen-mods/keep-loaded stress --profile soak --minutes 60

Options: --seed N --events N --minutes N --replay-event N --tabs N --windows N
         --reloads N --model-only --browser-only`;

const atomicWriteJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
};

const loadModelModule = async () => {
  const result = await build({
    bundle: true,
    entryPoints: [MODEL_ENTRY],
    format: "esm",
    platform: "node",
    target: "node24",
    write: false,
  });
  const output = result.outputFiles?.[0]?.contents;
  if (!output) throw new Error("esbuild did not return the application stress module");
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
};

const runBrowserStress = async ({ configuration, expectedProtocol }) => {
  await execFileAsync("pnpm", ["run", "build"], { cwd: MOD_DIRECTORY });
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  let server;
  let zen;
  try {
    server = await startWakeTransactionServer();
    zen = await launchLiveZen({
      stagedMod: {
        enabled: false,
        manifest,
        relativePaths: PRODUCTION_PATHS,
        sourceDirectory: MOD_DIRECTORY,
      },
    });
  } catch (error) {
    await server?.stop().catch(() => {});
    await zen?.stop().catch(() => {});
    throw error;
  }
  let client = null;
  let shutdownPromise = null;
  const cleanup = { profileRemoved: false, serverStopped: false, zenStopped: false };
  const shutdown = async () => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      const failures = [];
      await client?.quit().catch(() => {});
      try {
        await server.stop();
        cleanup.serverStopped = true;
      } catch (error) {
        failures.push(error);
      }
      try {
        await zen.stop();
        cleanup.zenStopped = true;
      } catch (error) {
        failures.push(error);
      }
      try {
        await access(zen.profile);
      } catch (error) {
        if (error?.code === "ENOENT") cleanup.profileRemoved = true;
        else throw error;
      }
      if (failures.length > 0) {
        throw new AggregateError(failures, "stress cleanup failed");
      }
    })();
    return shutdownPromise;
  };
  const removeSignals = installShutdownSignals({
    label: "Keep Loaded stress runner",
    shutdown,
  });
  let result = null;
  let fatal = null;
  try {
    const laneTimeout = Math.max(
      300_000,
      ((configuration.minutes ?? (configuration.profile === "standard" ? 15 : 2)) + 10) *
        60_000,
    );
    client = await openMarionette({
      commandTimeoutMilliseconds: laneTimeout,
      port: zen.port,
    });
    await client.setScriptTimeout(laneTimeout);
    const reloadsByRound = resolveBrowserReloadCounts(configuration);
    const expectedEvents =
      configuration.browserRounds.length +
      reloadsByRound.reduce((total, count) => total + count, 0) +
      1;
    result = await client.executeAsync(BROWSER_PROBE, [
      {
        buildId: zen.platformStamp.zen.buildId,
        cycleDelayMs: configuration.profile === "soak" ? 10_000 : 0,
        expectedEvents,
        expectedProtocol,
        geckoVersion: zen.platformStamp.zen.geckoVersion,
        modId: manifest.id,
        nonce: `${configuration.seed}-${Date.now()}`,
        reloadsByRound,
        rounds: configuration.browserRounds,
        seed: configuration.seed,
        serverBaseUrl: server.baseUrl,
        sineVersion: zen.platformStamp.sine.version,
        zenVersion: zen.platformStamp.zen.version,
      },
    ]);
  } catch (error) {
    fatal = String(error?.stack ?? error);
  } finally {
    try {
      await shutdown();
    } finally {
      removeSignals();
    }
  }
  if (fatal) {
    result ??= {};
    result.fatal = fatal;
  }
  return {
    cleanup,
    httpFixture: server.snapshot(),
    result,
    stagedMod: zen.stagedMod,
    stamp: zen.platformStamp,
    zenOutputTail: zen.output.join("").slice(-8000),
  };
};

const main = async () => {
  let configuration;
  try {
    configuration = parseStressArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage);
    process.exitCode = 2;
    return;
  }
  if (configuration.help) {
    console.log(usage);
    return;
  }
  const modelModule = await loadModelModule();
  let model = null;
  let browserRun = null;
  let fatal = null;
  try {
    if (configuration.model) {
      model = await modelModule.runApplicationStress({
        events: configuration.events,
        replayEvent: configuration.replayEvent,
        seed: configuration.seed,
        tabs: configuration.profile === "quick" ? 64 : 512,
      });
      console.log(
        `model ${model.completedEvents}/${model.expectedEvents}; ` +
          `max active ${model.maxActive}; max keys ${model.maxKeyRecords}`,
      );
    }
    if (configuration.browser) {
      browserRun = await runBrowserStress({
        configuration,
        expectedProtocol: modelModule.APPLICATION_COORDINATOR_PROTOCOL,
      });
      console.log(
        `browser ${browserRun.result?.completedEvents ?? 0}/` +
          `${browserRun.result?.expectedEvents ?? 0}; ` +
          `max active ${browserRun.result?.maxActive ?? "?"}`,
      );
    }
  } catch (error) {
    fatal = String(error?.stack ?? error);
  }
  const evidence = {
    browser: browserRun?.result ?? null,
    cleanup: browserRun?.cleanup ?? null,
    fatal: fatal ?? browserRun?.result?.fatal ?? null,
    model,
    profile: configuration.profile,
    seed: configuration.seed,
  };
  const configurationHash = createHash("sha256")
    .update(JSON.stringify(configuration))
    .digest("hex")
    .slice(0, 10);
  const output = resolve(
    REPOSITORY_ROOT,
    `.benchmarks/stress/keep-loaded-${configuration.profile}-${configuration.seed}-${configurationHash}.json`,
  );
  const artifact = {
    command: process.argv,
    configuration,
    evidence,
    recordedAt: new Date().toISOString(),
    runner: {
      node: process.version,
      ownerProtocol: modelModule.APPLICATION_COORDINATOR_PROTOCOL,
      os: { arch: arch(), platform: platform(), release: release() },
      v8: process.versions.v8,
    },
    stagedProduction: browserRun?.stagedMod ?? null,
    stamp: browserRun?.stamp ?? null,
    diagnostics: browserRun
      ? {
          httpFixture: browserRun.httpFixture,
          zenOutputTail: browserRun.zenOutputTail,
        }
      : null,
  };
  const validation = validateStressArtifact(artifact);
  await atomicWriteJson(output, { ...artifact, validation });
  console.log(`stress artifact: ${output}`);
  if (!validation.ok) {
    for (const failure of validation.failures) console.error(`FAIL ${failure}`);
    process.exitCode = 1;
  } else {
    console.log("PASS all requested stress lanes drained cleanly");
  }
};

await main();
