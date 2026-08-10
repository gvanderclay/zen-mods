#!/usr/bin/env node

/** Drive a synthetic two-window fixture through the exact installed Zen/Sine loader. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditLifecycle,
  collectVerdicts,
  validateAssertionManifest,
} from "./live-core.mjs";
import { openMarionette } from "./live-marionette.mjs";
import { LIVE_MOD_ID, launchLiveZen } from "./live-zen.mjs";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MOD_DIRECTORY = resolve(DIRECTORY, "../..");
const REPOSITORY_ROOT = resolve(MOD_DIRECTORY, "../..");
const OUTPUT = resolve(
  REPOSITORY_ROOT,
  ".benchmarks/live/keep-loaded-lifecycle.smoke.json",
);
const INITIAL_ALIASING_DIAGNOSTIC = resolve(
  REPOSITORY_ROOT,
  ".benchmarks/live/keep-loaded-lifecycle.simultaneous-collision.json",
);
const FIXTURES = {
  carrier: resolve(DIRECTORY, "fixtures/lifecycle-carrier.sys.mjs"),
  window: resolve(DIRECTORY, "fixtures/lifecycle-window.uc.mjs"),
};

const REQUIRED_ASSERTIONS = [
  "exact Zen version",
  "fixture starts disabled",
  "second browser window reaches Sine",
  "window A leak sentinel is attributed",
  "window A leak sentinel is released",
  "window B leak sentinel is attributed",
  "window B leak sentinel is released",
  "exact Sine enable installs both window generations",
  "per-window owner identities are distinct",
  "per-window module tokens are distinct",
  "fixed-timestamp two-window enable preserves distinct imports",
  "application carrier identity is shared",
  "application carrier state crosses windows",
  "listener mutations stay in their owning windows",
  "both old continuations reach their gates",
  "both replacement readiness gates are reached",
  "reload stops each old generation before its replacement",
  "reload cleanup releases every old listener and timer before forced delivery",
  "both replacement generations become ready",
  "both stale continuations are forced after stop",
  "stale continuations skip every mutation",
  "canceled callbacks are force-delivered without mutation or re-arm",
  "reload leaves one generation and one resource set per window",
  "close diagnostics observe domwindowclosed then unload without beforeunload",
  "second-window close stops its generation before close completion",
  "second-window close records exactly one terminal stop",
  "second browser window leaves the window mediator",
  "closing window B releases B resources",
  "closing window B unregisters only B",
  "window A remains live after B closes",
  "exact Sine disable unloads window A",
  "later mod-scoped disable delivers retained window B cleanup",
  "later retained Sine cleanup is an idempotent no-op",
  "disabling releases A resources",
  "final carrier has no active instance or gate",
  "lifecycle produces no fixture runtime errors",
  "lifecycle trace has contiguous sequence numbers",
  "each generation stops exactly once through its owning cleanup",
  "lifecycle has no overlap stale callback or wrong-window mutation",
  "carrier reset succeeds after cleanup",
];

// Exact loader lifecycle: Sine 2.3.3.0 manager.sys.mjs lines 21-65, 107-167,
// 791-809. `toggleTheme` and `rebuildMods` schedule dynamic imports without awaiting
// readiness, so the carrier trace below is the synchronization source.
const PROBE = `
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  const MOD_ID = options.modId;
  const API_KEY = "__zenKeepLoadedLifecycleHarness";
  const TARGET_SOURCE = "/" + MOD_ID + "/fixtures/lifecycle-window.uc.mjs";
  const CARRIER_URI = "chrome://sine/content/" + MOD_ID +
    "/fixtures/lifecycle-carrier.sys.mjs";
  const EXPECTED_RESOURCES = {
    listeners: [
      { capture: false, once: false, type: "keep-loaded-lifecycle-ping" },
      { capture: false, once: true, type: "unload" },
    ],
    timer: 1,
  };
  const nativeNow = Date.now.bind(Date);
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const report = {
    assertions: [],
    auditEvidence: null,
    carrier: null,
    closeSignals: [],
    fatal: null,
    platform: null,
    resources: null,
    runtimeErrors: [],
    simultaneousImportControl: null,
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
  const captureOption = value =>
    typeof value === "boolean" ? value : Boolean(value && value.capture);

  const createTrackerHub = () => {
    const records = [];
    const trackedWindows = [];
    const prototypePatches = [];
    let forcedOwner = null;
    const calledFromFixture = () => {
      if (forcedOwner) return true;
      try {
        let frame = Components.stack;
        while (frame) {
          if (String(frame.filename || "").includes(TARGET_SOURCE)) return true;
          frame = frame.caller;
        }
      } catch {}
      return String(new Error().stack || "").includes(TARGET_SOURCE);
    };
    const ownerForTarget = target => {
      for (const tracked of trackedWindows) {
        if (target === tracked.targetWindow) return tracked.owner;
      }
      try {
        const ownerWindow = target?.ownerGlobal ?? target?.ownerDocument?.defaultView;
        return trackedWindows.find(tracked => tracked.targetWindow === ownerWindow)?.owner ?? null;
      } catch {
        return null;
      }
    };
    const patchEvents = targetWindow => {
      const eventPrototype = targetWindow.EventTarget.prototype;
      const existing = prototypePatches.find(patch => patch.prototype === eventPrototype);
      if (existing) return existing;
      const patch = {
        add: eventPrototype.addEventListener,
        prototype: eventPrototype,
        remove: eventPrototype.removeEventListener,
      };
      prototypePatches.push(patch);
      eventPrototype.addEventListener = function (type, listener, options_) {
        const owner = forcedOwner ?? ownerForTarget(this);
        if (owner && calledFromFixture()) {
          const record = {
            active: true,
            capture: captureOption(options_),
            deliveries: 0,
            forcedDeliveries: 0,
            kind: "listener",
            listener,
            once: Boolean(options_ && typeof options_ === "object" && options_.once),
            owner,
            target: this,
            type,
          };
          record.installedListener = function (event) {
            record.deliveries += 1;
            if (record.once) record.active = false;
            return typeof listener === "function"
              ? listener.call(this, event)
              : listener.handleEvent(event);
          };
          record.invoke = () => {
            record.forcedDeliveries += 1;
            const tracked = trackedWindows.find(candidate => candidate.owner === record.owner);
            return record.installedListener.call(
              record.target,
              new tracked.targetWindow.Event(record.type),
            );
          };
          records.push(record);
          if (options_ && typeof options_ === "object" && options_.signal) {
            patch.add.call(
              options_.signal,
              "abort",
              () => { record.active = false; },
              { once: true },
            );
          }
          return patch.add.call(this, type, record.installedListener, options_);
        }
        return patch.add.call(this, type, listener, options_);
      };
      eventPrototype.removeEventListener = function (type, listener, options_) {
        const useCapture = captureOption(options_);
        const record = records.findLast(candidate =>
          candidate.kind === "listener" && candidate.active &&
          candidate.target === this && candidate.type === type &&
          candidate.listener === listener && candidate.capture === useCapture
        );
        if (record) {
          record.active = false;
          return patch.remove.call(this, type, record.installedListener, options_);
        }
        return patch.remove.call(this, type, listener, options_);
      };
      return patch;
    };
    const viewFor = tracked => {
      const counts = () => ({
        listener: records.filter(record =>
          record.owner === tracked.owner && record.kind === "listener" && record.active
        ).length,
        timer: records.filter(record =>
          record.owner === tracked.owner && record.kind === "timer" && record.active
        ).length,
      });
      return {
        activeInventory: () => ({
          listeners: records
            .filter(
              record =>
                record.owner === tracked.owner &&
                record.kind === "listener" &&
                record.active,
            )
            .map(record => ({
              capture: record.capture,
              once: record.once,
              type: record.type,
            }))
            .sort(
              (left, right) =>
                left.type.localeCompare(right.type) ||
                Number(left.capture) - Number(right.capture) ||
                Number(left.once) - Number(right.once),
            ),
          timer: records.filter(
            record =>
              record.owner === tracked.owner && record.kind === "timer" && record.active,
          ).length,
        }),
        counts,
        errors: tracked.errors,
        evidence: () => records
          .filter(record => record.owner === tracked.owner)
          .map(record => ({
            active: record.active,
            deliveries: record.deliveries,
            forcedDeliveries: record.forcedDeliveries,
            kind: record.kind,
            owner: record.owner,
            ...(record.kind === "listener"
              ? { capture: record.capture, once: record.once, type: record.type }
              : {}),
          })),
        activeCallbacks: () =>
          records.filter(record => record.owner === tracked.owner && record.active),
        forceCallbacks: callbacks => {
          for (const callback of callbacks) callback.invoke();
        },
        sentinel: () => {
          const before = counts();
          forcedOwner = tracked.owner;
          const listener = () => {};
          tracked.targetWindow.addEventListener("keep-loaded-lifecycle-sentinel", listener);
          const timer = tracked.targetWindow.setTimeout(() => {}, 600000);
          forcedOwner = null;
          const dirty = {
            listener: records.filter(record =>
              record.owner === tracked.owner && record.kind === "listener" && record.active
            ).length,
            timer: records.filter(record =>
              record.owner === tracked.owner && record.kind === "timer" && record.active
            ).length,
          };
          tracked.targetWindow.removeEventListener("keep-loaded-lifecycle-sentinel", listener);
          tracked.targetWindow.clearTimeout(timer);
          const clean = {
            listener: records.filter(record =>
              record.owner === tracked.owner && record.kind === "listener" && record.active
            ).length,
            timer: records.filter(record =>
              record.owner === tracked.owner && record.kind === "timer" && record.active
            ).length,
          };
          return { before, dirty, clean };
        },
      };
    };
    const addWindow = (targetWindow, owner) => {
      const existing = trackedWindows.find(tracked => tracked.targetWindow === targetWindow);
      if (existing) return viewFor(existing);
      const eventPatch = patchEvents(targetWindow);
      const tracked = {
        clearTimeout: targetWindow.clearTimeout,
        errors: [],
        eventPatch,
        owner,
        setTimeout: targetWindow.setTimeout,
        targetWindow,
      };
      trackedWindows.push(tracked);
      targetWindow.setTimeout = function (callback, delay, ...arguments_) {
        const owned = calledFromFixture();
        const record = {
          active: true,
          deliveries: 0,
          forcedDeliveries: 0,
          handle: null,
          kind: "timer",
          owner,
          owned,
        };
        const wrapped = (...callbackArguments) => {
          record.active = false;
          record.deliveries += 1;
          return callback(...callbackArguments);
        };
        record.invoke = () => {
          record.forcedDeliveries += 1;
          return wrapped();
        };
        record.handle = tracked.setTimeout.call(targetWindow, wrapped, delay, ...arguments_);
        if (owned) records.push(record);
        return record.handle;
      };
      targetWindow.clearTimeout = function (handle) {
        const record = records.findLast(candidate =>
          candidate.owner === owner && candidate.kind === "timer" &&
          candidate.active && candidate.handle === handle
        );
        if (record) record.active = false;
        return tracked.clearTimeout.call(targetWindow, handle);
      };
      tracked.onError = event => {
        const detail = String(event.error?.stack || event.message || event.error || "");
        if (String(event.filename || "").includes(TARGET_SOURCE) || detail.includes(MOD_ID)) {
          tracked.errors.push(detail);
        }
      };
      tracked.onRejection = event => {
        const detail = String(event.reason?.stack || event.reason || "");
        if (detail.includes(MOD_ID)) tracked.errors.push(detail);
      };
      eventPatch.add.call(targetWindow, "error", tracked.onError);
      eventPatch.add.call(targetWindow, "unhandledrejection", tracked.onRejection);
      return viewFor(tracked);
    };
    return {
      addWindow,
      restore: () => {
        for (const tracked of trackedWindows) {
          try {
            tracked.eventPatch.remove.call(tracked.targetWindow, "error", tracked.onError);
            tracked.eventPatch.remove.call(
              tracked.targetWindow,
              "unhandledrejection",
              tracked.onRejection,
            );
            tracked.targetWindow.setTimeout = tracked.setTimeout;
            tracked.targetWindow.clearTimeout = tracked.clearTimeout;
          } catch {}
        }
        for (const patch of prototypePatches) {
          patch.prototype.addEventListener = patch.add;
          patch.prototype.removeEventListener = patch.remove;
        }
      },
    };
  };

  const exactResources = (instance, tracker) => {
    const actual = tracker.activeInventory();
    const expected = EXPECTED_RESOURCES;
    return {
      actual,
      expected,
      matches: Boolean(instance) && JSON.stringify(actual) === JSON.stringify(expected),
    };
  };

  let trackerHub;
  let manager;
  let sineUtils;
  let carrier;
  let secondWindow;
  let trackerA;
  let trackerB;
  let enabled = false;

  const closeSecondWindow = async instance => {
    if (!secondWindow || secondWindow.closed) return;
    const signalListeners = [];
    if (instance && carrier) {
      for (const [target, targetName] of [
        [secondWindow, "window"],
        [secondWindow.document, "document"],
      ]) {
        for (const type of ["beforeunload", "pagehide", "unload"]) {
          const listener = event => {
            const observed = {
              target: targetName,
              targetIsWindow: event.target === secondWindow,
              type,
            };
            report.closeSignals.push(observed);
            carrier.event(
              "window-close-signal",
              {
                generation: instance.generation,
                windowId: instance.windowId,
              },
              { ...observed, signal: type },
            );
          };
          signalListeners.push({ listener, target, type });
          target.addEventListener(type, listener, { once: true });
        }
      }
    }
    const closed = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        Services.obs.removeObserver(observer, "domwindowclosed");
        reject(new Error("timed out waiting for domwindowclosed"));
      }, 15000);
      const observer = {
        observe(subject) {
          if (subject !== secondWindow) return;
          clearTimeout(timeout);
          Services.obs.removeObserver(observer, "domwindowclosed");
          if (instance && carrier) {
            carrier.event("domwindowclosed", {
              generation: instance.generation,
              windowId: instance.windowId,
            });
          }
          resolve();
        },
      };
      Services.obs.addObserver(observer, "domwindowclosed");
    });
    const closeCommand = secondWindow.document.getElementById("cmd_closeWindow");
    if (!closeCommand || typeof closeCommand.doCommand !== "function") {
      throw new Error("the browser window has no executable cmd_closeWindow command");
    }
    closeCommand.doCommand();
    try {
      await closed;
      await wait(250);
    } finally {
      for (const { listener, target, type } of signalListeners) {
        try { target.removeEventListener(type, listener); } catch {}
      }
    }
  };
  (async () => {
    try {
      manager = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/manager.sys.mjs"
      ).default;
      sineUtils = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/utils.sys.mjs"
      ).default;
      await waitFor("window A Sine interface", () => typeof window.addUnloadListener === "function");
      report.platform = {
        buildId: Services.appinfo.appBuildID,
        geckoVersion: Services.appinfo.platformVersion,
        sineVersion: options.sineVersion,
        zenVersion: Services.appinfo.version,
      };
      check(
        "exact Zen version",
        Services.appinfo.version === options.zenVersion &&
          Services.appinfo.appBuildID === options.buildId &&
          Services.appinfo.platformVersion === options.geckoVersion,
        Services.appinfo.version + " / " + Services.appinfo.appBuildID +
          " / Gecko " + Services.appinfo.platformVersion,
      );
      const initialMods = await sineUtils.getMods();
      check(
        "fixture starts disabled",
        initialMods[MOD_ID]?.enabled === false && !window[API_KEY],
        "enabled=" + String(initialMods[MOD_ID]?.enabled) + ", api=" + String(Boolean(window[API_KEY])),
      );

      trackerHub = createTrackerHub();
      trackerA = trackerHub.addWindow(window, "A");
      const sentinelA = trackerA.sentinel();
      check(
        "window A leak sentinel is attributed",
        sentinelA.dirty.listener === sentinelA.before.listener + 1 &&
          sentinelA.dirty.timer === sentinelA.before.timer + 1,
        JSON.stringify(sentinelA),
      );
      check(
        "window A leak sentinel is released",
        sentinelA.clean.listener === sentinelA.before.listener &&
          sentinelA.clean.timer === sentinelA.before.timer,
        JSON.stringify(sentinelA),
      );

      const initialWindowCount = browserWindows().length;
      secondWindow = OpenBrowserWindow({ openerWindow: window });
      await waitFor(
        "window B Sine interface",
        () => !secondWindow.closed && secondWindow.gBrowser &&
          typeof secondWindow.addUnloadListener === "function" &&
          browserWindows().length === initialWindowCount + 1,
      );
      check(
        "second browser window reaches Sine",
        secondWindow !== window && !secondWindow.closed &&
          secondWindow.location.href === "chrome://browser/content/browser.xhtml" &&
          typeof secondWindow.addUnloadListener === "function",
        secondWindow.location.href + " / " + browserWindows().length + " browser windows",
      );
      trackerB = trackerHub.addWindow(secondWindow, "B");
      const sentinelB = trackerB.sentinel();
      check(
        "window B leak sentinel is attributed",
        sentinelB.dirty.listener === sentinelB.before.listener + 1 &&
          sentinelB.dirty.timer === sentinelB.before.timer + 1,
        JSON.stringify(sentinelB),
      );
      check(
        "window B leak sentinel is released",
        sentinelB.clean.listener === sentinelB.before.listener &&
          sentinelB.clean.timer === sentinelB.before.timer,
        JSON.stringify(sentinelB),
      );

      const fixedTimestamp = 123456789;
      const originalNowA = window.Date.now;
      const originalNowB = secondWindow.Date.now;
      let firstA;
      let firstB;
      try {
        window.Date.now = () => fixedTimestamp;
        secondWindow.Date.now = () => fixedTimestamp;
        await manager.toggleTheme(await sineUtils.getMods(), MOD_ID);
        enabled = true;
        [firstA, firstB] = await Promise.all([
          waitFor("window A initial fixture generation", () =>
            window[API_KEY]?.ready && window[API_KEY]
          ),
          waitFor("window B initial fixture generation", () =>
            secondWindow[API_KEY]?.ready && secondWindow[API_KEY]
          ),
        ]);
      } finally {
        window.Date.now = originalNowA;
        secondWindow.Date.now = originalNowB;
      }
      carrier = ChromeUtils.importESModule(CARRIER_URI).default;
      const fixedTimestampTrace = carrier.snapshot().trace;
      report.simultaneousImportControl = {
        conclusion: "refuted: identical cache-busting timestamps still produced distinct window imports",
        exactPath: "manager.toggleTheme -> manager.rebuildMods -> module_loader.mjs",
        fixedTimestamp,
        hypothesis: "identical Date.now cache-busting values alias .uc.mjs across windows",
        enable: {
          A: {
            applicationId: firstA.applicationId,
            generation: firstA.generation,
            moduleToken: firstA.moduleToken,
            windowId: firstA.windowId,
          },
          B: {
            applicationId: firstB.applicationId,
            generation: firstB.generation,
            moduleToken: firstB.moduleToken,
            windowId: firstB.windowId,
          },
          trace: fixedTimestampTrace.map(event => ({ ...event })),
        },
        ordinaryRebuild: null,
      };
      check(
        "exact Sine enable installs both window generations",
        firstA && firstB && exactResources(firstA, trackerA).matches &&
          exactResources(firstB, trackerB).matches,
        JSON.stringify({
          A: exactResources(firstA, trackerA),
          B: exactResources(firstB, trackerB),
        }),
      );
      check(
        "per-window owner identities are distinct",
        firstA.windowId !== firstB.windowId && firstA.generation !== firstB.generation,
        firstA.windowId + "/g" + firstA.generation + " vs " +
          firstB.windowId + "/g" + firstB.generation,
      );
      check(
        "per-window module tokens are distinct",
        firstA.moduleToken !== firstB.moduleToken,
        firstA.moduleToken + " vs " + firstB.moduleToken,
      );
      check(
        "fixed-timestamp two-window enable preserves distinct imports",
        firstA.windowId !== firstB.windowId && firstA.generation !== firstB.generation &&
          firstA.moduleToken !== firstB.moduleToken,
        JSON.stringify(report.simultaneousImportControl.enable),
      );
      check(
        "application carrier identity is shared",
        firstA.applicationId === carrier.applicationId &&
          firstB.applicationId === carrier.applicationId &&
          carrier.snapshot().carrierLoads === 1,
        String(carrier.applicationId) + " / one carrier module load",
      );
      firstA.writeShared("written-by-A");
      const readInB = firstB.readShared();
      firstB.writeShared("written-by-B");
      check(
        "application carrier state crosses windows",
        readInB === "written-by-A" && firstA.readShared() === "written-by-B",
        String(readInB) + " / " + String(firstA.readShared()),
      );

      const beforePingA = firstA.mutations;
      const beforePingB = firstB.mutations;
      firstA.ping();
      const afterAPing = { A: firstA.mutations, B: firstB.mutations };
      firstB.ping();
      check(
        "listener mutations stay in their owning windows",
        afterAPing.A === beforePingA + 1 && afterAPing.B === beforePingB &&
          firstA.mutations === beforePingA + 1 && firstB.mutations === beforePingB + 1,
        JSON.stringify({ A: firstA.mutations, B: firstB.mutations }),
      );

      firstA.pauseContinuation("stale-work");
      firstB.pauseContinuation("stale-work");
      const canceledCallbacksA = trackerA.activeCallbacks();
      const canceledCallbacksB = trackerB.activeCallbacks();
      await waitFor("both old work gates", () => {
        const gates = carrier.snapshot().pendingGates;
        return gates.some(gate => gate.generation === firstA.generation && gate.label === "stale-work") &&
          gates.some(gate => gate.generation === firstB.generation && gate.label === "stale-work");
      });
      check(
        "both old continuations reach their gates",
        carrier.snapshot().pendingGates.filter(gate => gate.label === "stale-work").length === 2,
        JSON.stringify(carrier.snapshot().pendingGates),
      );

      carrier.holdNextReadiness(firstA.windowId);
      carrier.holdNextReadiness(firstB.windowId);
      const rebuildTraceStart = carrier.snapshot().trace.at(-1)?.seq ?? 0;
      await manager.rebuildMods(true, false);
      const [replacementA, replacementB] = await Promise.all([
        waitFor(
          "window A replacement import",
          () => window[API_KEY]?.generation !== firstA.generation && window[API_KEY],
        ),
        waitFor(
          "window B replacement import",
          () => secondWindow[API_KEY]?.generation !== firstB.generation && secondWindow[API_KEY],
        ),
      ]);
      await waitFor("both replacement readiness gates", () => {
        const gates = carrier.snapshot().pendingGates;
        return gates.some(gate => gate.generation === replacementA.generation && gate.label === "readiness") &&
          gates.some(gate => gate.generation === replacementB.generation && gate.label === "readiness");
      });
      check(
        "both replacement readiness gates are reached",
        !replacementA.ready && !replacementB.ready &&
          carrier.snapshot().pendingGates.filter(gate => gate.label === "readiness").length === 2,
        JSON.stringify(carrier.snapshot().pendingGates),
      );

      carrier.release(replacementA.generation, "readiness");
      carrier.release(replacementB.generation, "readiness");
      await waitFor("both replacement generations ready", () => replacementA.ready && replacementB.ready);
      const reloadTrace = carrier.snapshot().trace;
      report.simultaneousImportControl.ordinaryRebuild = {
        A: {
          applicationId: replacementA.applicationId,
          generation: replacementA.generation,
          moduleToken: replacementA.moduleToken,
          windowId: replacementA.windowId,
        },
        B: {
          applicationId: replacementB.applicationId,
          generation: replacementB.generation,
          moduleToken: replacementB.moduleToken,
          windowId: replacementB.windowId,
        },
        trace: reloadTrace.filter(event => event.seq > rebuildTraceStart).map(event => ({ ...event })),
      };
      const orderedReplacement = (oldApi, replacement) => {
        const stopped = reloadTrace.find(event => event.type === "stop" && event.generation === oldApi.generation);
        const imported = reloadTrace.find(event => event.type === "import" && event.generation === replacement.generation);
        const ready = reloadTrace.find(event => event.type === "ready" && event.generation === replacement.generation);
        return stopped && imported && ready && stopped.seq < imported.seq && imported.seq < ready.seq;
      };
      check(
        "reload stops each old generation before its replacement",
        orderedReplacement(firstA, replacementA) && orderedReplacement(firstB, replacementB),
        "checked per-window carrier sequence",
      );
      const resourcesAtReloadStop = [
        ...canceledCallbacksA.map(record => ({
          active: record.active,
          kind: record.kind,
          owner: record.owner,
          type: "resource-at-stop",
        })),
        ...canceledCallbacksB.map(record => ({
          active: record.active,
          kind: record.kind,
          owner: record.owner,
          type: "resource-at-stop",
        })),
      ];
      check(
        "reload cleanup releases every old listener and timer before forced delivery",
        canceledCallbacksA.length > 0 && canceledCallbacksB.length > 0 &&
          resourcesAtReloadStop.every(resource => !resource.active),
        JSON.stringify(resourcesAtReloadStop),
      );
      check(
        "both replacement generations become ready",
        replacementA.ready && replacementB.ready &&
          replacementA.generation !== firstA.generation &&
          replacementB.generation !== firstB.generation,
        "A g" + replacementA.generation + ", B g" + replacementB.generation,
      );

      const staleMutationA = firstA.mutations;
      const staleMutationB = firstB.mutations;
      const releasedA = carrier.release(firstA.generation, "stale-work");
      const releasedB = carrier.release(firstB.generation, "stale-work");
      await waitFor("both stale continuations to resume and skip", () => {
        const trace = carrier.snapshot().trace;
        return trace.some(event => event.type === "continuation-skipped" && event.generation === firstA.generation) &&
          trace.some(event => event.type === "continuation-skipped" && event.generation === firstB.generation);
      });
      const staleTrace = carrier.snapshot().trace;
      check(
        "both stale continuations are forced after stop",
        releasedA && releasedB &&
          staleTrace.some(event => event.type === "continuation-resumed" && event.generation === firstA.generation) &&
          staleTrace.some(event => event.type === "continuation-resumed" && event.generation === firstB.generation),
        "both stopped promises were explicitly released",
      );
      const mutatedAfterStop = oldApi => {
        const stop = staleTrace.find(event => event.type === "stop" && event.generation === oldApi.generation);
        return staleTrace.some(event => event.type === "mutation" &&
          event.generation === oldApi.generation && event.seq > stop.seq);
      };
      check(
        "stale continuations skip every mutation",
        firstA.mutations === staleMutationA && firstB.mutations === staleMutationB &&
          !mutatedAfterStop(firstA) && !mutatedAfterStop(firstB),
        JSON.stringify({ A: firstA.mutations, B: firstB.mutations }),
      );
      const beforeForcedA = firstA.mutations;
      const beforeForcedB = firstB.mutations;
      trackerA.forceCallbacks(canceledCallbacksA);
      trackerB.forceCallbacks(canceledCallbacksB);
      await waitFor("forced canceled callbacks to reach their guards", () => {
        const trace = carrier.snapshot().trace;
        return [firstA.generation, firstB.generation].every(generation =>
          trace.some(event => event.type === "listener-skipped" && event.generation === generation) &&
          trace.some(event => event.type === "timer-skipped" && event.generation === generation)
        );
      });
      check(
        "canceled callbacks are force-delivered without mutation or re-arm",
        firstA.mutations === beforeForcedA && firstB.mutations === beforeForcedB &&
          canceledCallbacksA.every(record => record.forcedDeliveries === 1 && !record.active) &&
          canceledCallbacksB.every(record => record.forcedDeliveries === 1 && !record.active) &&
          exactResources(replacementA, trackerA).matches &&
          exactResources(replacementB, trackerB).matches,
        JSON.stringify({
          A: exactResources(replacementA, trackerA),
          B: exactResources(replacementB, trackerB),
        }),
      );
      const activeAfterReload = carrier.snapshot().active;
      check(
        "reload leaves one generation and one resource set per window",
        activeAfterReload.length === 2 &&
          activeAfterReload.some(item => item.generation === replacementA.generation && item.ready) &&
          activeAfterReload.some(item => item.generation === replacementB.generation && item.ready) &&
          exactResources(replacementA, trackerA).matches &&
          exactResources(replacementB, trackerB).matches,
        JSON.stringify({
          active: activeAfterReload,
          A: exactResources(replacementA, trackerA),
          B: exactResources(replacementB, trackerB),
        }),
      );

      carrier.event("close-request", {
        generation: replacementB.generation,
        windowId: replacementB.windowId,
      });
      await closeSecondWindow(replacementB);
      carrier.event("close-observed", {
        generation: replacementB.generation,
        windowId: replacementB.windowId,
      });
      const closeTrace = carrier.snapshot().trace;
      const closeRequest = closeTrace.find(event => event.type === "close-request" &&
        event.generation === replacementB.generation);
      const closeStop = closeTrace.find(event => event.type === "stop" &&
        event.generation === replacementB.generation);
      const closeStops = closeTrace.filter(event => event.type === "stop" &&
        event.generation === replacementB.generation);
      const nativeCloseTeardown = closeTrace.find(event =>
        event.type === "teardown-call" &&
        event.generation === replacementB.generation &&
        event.source === "native-unload"
      );
      const closedEvent = closeTrace.find(event => event.type === "domwindowclosed" &&
        event.generation === replacementB.generation);
      const unloadEvent = closeTrace.find(event => event.type === "window-close-signal" &&
        event.signal === "unload" && event.generation === replacementB.generation);
      const beforeUnloadEvent = closeTrace.find(event => event.type === "window-close-signal" &&
        event.signal === "beforeunload" && event.generation === replacementB.generation);
      const closeObserved = closeTrace.find(event => event.type === "close-observed" &&
        event.generation === replacementB.generation);
      check(
        "close diagnostics observe domwindowclosed then unload without beforeunload",
        closeRequest && closedEvent && unloadEvent && closeObserved && !beforeUnloadEvent &&
          closeRequest.seq < closedEvent.seq && closedEvent.seq < unloadEvent.seq &&
          unloadEvent.seq < closeObserved.seq,
        "checked the exact browser-window close signal sequence",
      );
      check(
        "second-window close stops its generation before close completion",
        closeRequest && closedEvent && nativeCloseTeardown && closeStop &&
          unloadEvent && closeObserved &&
          closeRequest.seq < closedEvent.seq &&
          closedEvent.seq < nativeCloseTeardown.seq &&
          nativeCloseTeardown.seq < closeStop.seq &&
          closeStop.seq < unloadEvent.seq && unloadEvent.seq < closeObserved.seq,
        "checked B carrier sequence",
      );
      check(
        "second-window close records exactly one terminal stop",
        closeStops.length === 1 && nativeCloseTeardown?.stopped === false &&
          closeStops[0] === closeStop,
        JSON.stringify({ nativeCloseTeardown, stops: closeStops }),
      );
      check(
        "second browser window leaves the window mediator",
        secondWindow.closed && !browserWindows().some(candidate => candidate === secondWindow),
        String(browserWindows().length) + " browser window(s) remain",
      );
      check(
        "closing window B releases B resources",
        JSON.stringify(trackerB.activeInventory()) ===
          JSON.stringify({ listeners: [], timer: 0 }),
        JSON.stringify(trackerB.activeInventory()),
      );
      const activeAfterClose = carrier.snapshot().active;
      check(
        "closing window B unregisters only B",
        activeAfterClose.length === 1 &&
          activeAfterClose[0].windowId === replacementA.windowId &&
          activeAfterClose[0].generation === replacementA.generation,
        JSON.stringify(activeAfterClose),
      );
      const beforeFinalPing = replacementA.mutations;
      replacementA.ping();
      check(
        "window A remains live after B closes",
        replacementA.ready && replacementA.mutations === beforeFinalPing + 1 &&
          exactResources(replacementA, trackerA).matches,
        JSON.stringify({
          mutations: replacementA.mutations,
          resources: exactResources(replacementA, trackerA),
        }),
      );

      carrier.event("disable-request", {
        generation: replacementA.generation,
        windowId: replacementA.windowId,
      });
      await manager.toggleTheme(await sineUtils.getMods(), MOD_ID);
      enabled = false;
      await waitFor("window A exact Sine disable", () =>
        carrier.snapshot().active.length === 0 && !window[API_KEY]
      );
      const disableTrace = carrier.snapshot().trace;
      const disableRequest = disableTrace.find(event => event.type === "disable-request" &&
        event.generation === replacementA.generation);
      const disableStop = disableTrace.find(event => event.type === "stop" &&
        event.generation === replacementA.generation);
      const retainedBTeardownCall = disableTrace.find(event =>
        event.type === "teardown-call" && event.generation === replacementB.generation &&
        event.seq > disableRequest?.seq
      );
      const finalBStops = disableTrace.filter(event =>
        event.type === "stop" && event.generation === replacementB.generation
      );
      check(
        "exact Sine disable unloads window A",
        disableRequest && disableStop && disableRequest.seq < disableStop.seq && !window[API_KEY],
        "checked A carrier sequence",
      );
      check(
        "later mod-scoped disable delivers retained window B cleanup",
        closeObserved && disableRequest && retainedBTeardownCall &&
          closeObserved.seq < disableRequest.seq &&
          disableRequest.seq < retainedBTeardownCall.seq &&
          trackerB.counts().listener === 0 && trackerB.counts().timer === 0,
        JSON.stringify({
          closeObserved: closeObserved?.seq,
          disableRequest: disableRequest?.seq,
          retainedBTeardownCall: retainedBTeardownCall?.seq,
          resources: trackerB.counts(),
        }),
      );
      check(
        "later retained Sine cleanup is an idempotent no-op",
        retainedBTeardownCall?.source === "sine" &&
          retainedBTeardownCall.stopped === true &&
          finalBStops.length === 1 && finalBStops[0].seq === closeStop?.seq,
        JSON.stringify({ retainedBTeardownCall, stops: finalBStops }),
      );
      check(
        "disabling releases A resources",
        trackerA.counts().listener === 0 && trackerA.counts().timer === 0,
        JSON.stringify(trackerA.counts()),
      );
      const finalSnapshot = carrier.snapshot();
      check(
        "final carrier has no active instance or gate",
        finalSnapshot.active.length === 0 && finalSnapshot.pendingGates.length === 0 &&
          finalSnapshot.heldReadiness.length === 0,
        JSON.stringify({
          active: finalSnapshot.active,
          gates: finalSnapshot.pendingGates,
          heldReadiness: finalSnapshot.heldReadiness,
        }),
      );
      report.runtimeErrors = [...trackerA.errors, ...trackerB.errors];
      check(
        "lifecycle produces no fixture runtime errors",
        report.runtimeErrors.length === 0,
        report.runtimeErrors.join(" | "),
      );
      check(
        "lifecycle trace has contiguous sequence numbers",
        finalSnapshot.trace.length > 0 &&
          finalSnapshot.trace.every((event, index) => event.seq === index + 1),
        String(finalSnapshot.trace.length) + " ordered events",
      );
      const expectedGenerations = [
        firstA.generation,
        firstB.generation,
        replacementA.generation,
        replacementB.generation,
      ];
      const stopEvents = finalSnapshot.trace.filter(event => event.type === "stop");
      check(
        "each generation stops exactly once through its owning cleanup",
        stopEvents.length === expectedGenerations.length &&
          expectedGenerations.every(generation => {
            const generationStops = stopEvents.filter(
              event => event.generation === generation,
            );
            return generationStops.length === 1 && generationStops[0].owned === true;
          }),
        JSON.stringify(stopEvents),
      );
      const semanticFaults = finalSnapshot.trace.filter(event =>
        event.type === "overlapping-import" ||
        (event.type === "mutation" &&
          (event.stopped === true || event.windowId !== event.targetWindowId))
      );
      check(
        "lifecycle has no overlap stale callback or wrong-window mutation",
        semanticFaults.length === 0,
        JSON.stringify(semanticFaults),
      );

      report.carrier = finalSnapshot;
      report.resources = {
        A: trackerA.evidence(),
        B: trackerB.evidence(),
      };
      report.auditEvidence = {
        resources: [...report.resources.A, ...report.resources.B],
        events: [
          ...resourcesAtReloadStop,
          ...finalSnapshot.trace
          .filter(event => event.type === "mutation")
          .map(event => ({
            generation: event.generation,
            owner: event.windowId,
            stopped: event.stopped === true,
            targetOwner: event.targetWindowId,
            type: "mutation",
          })),
          ...[...report.resources.A, ...report.resources.B]
            .filter(resource => resource.forcedDeliveries > 0)
            .map(resource => ({
              guarded: true,
              owner: resource.owner,
              stopped: true,
              type: "callback-delivered",
            })),
        ],
      };
      let resetOkay = false;
      try {
        carrier.reset();
        const reset = carrier.snapshot();
        resetOkay = reset.active.length === 0 && reset.pendingGates.length === 0 &&
          reset.trace.length === 0;
      } catch {}
      check(
        "carrier reset succeeds after cleanup",
        resetOkay,
        "the process-global fixture dropped its trace and weak identity map",
      );
    } catch (error) {
      report.fatal = String(error) + "\\n" + String(error?.stack || "");
    } finally {
      if (enabled && manager && sineUtils) {
        try {
          await manager.toggleTheme(await sineUtils.getMods(), MOD_ID);
          enabled = false;
        } catch {}
      }
      try { await closeSecondWindow(); } catch {}
      try {
        trackerHub?.restore();
      } catch (error) {
        report.fatal ??= "tracker restore failed: " + String(error?.stack || error);
      }
      if (!report.carrier && carrier) {
        try { report.carrier = carrier.snapshot(); } catch {}
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

const sha256 = contents => createHash("sha256").update(contents).digest("hex");
const git = arguments_ =>
  execFileSync("git", arguments_, { cwd: REPOSITORY_ROOT, encoding: "utf8" }).trim();

const fixtureEvidence = async () =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(FIXTURES).map(async ([name, path]) => {
        const contents = await readFile(path);
        return [name, { bytes: contents.length, sha256: sha256(contents) }];
      }),
    ),
  );

const initialAliasingEvidence = async () => {
  try {
    const contents = await readFile(INITIAL_ALIASING_DIAGNOSTIC);
    const artifact = JSON.parse(contents);
    const identityAssertion = artifact.result?.assertions?.find(
      assertion => assertion.name === "per-window module identities are distinct",
    );
    return {
      artifact: ".benchmarks/live/keep-loaded-lifecycle.simultaneous-collision.json",
      preserved: true,
      sha256: sha256(contents),
      observedDetail: identityAssertion?.detail ?? null,
      observedFatal: artifact.result?.fatal ?? null,
    };
  } catch {
    return {
      artifact: ".benchmarks/live/keep-loaded-lifecycle.simultaneous-collision.json",
      preserved: false,
      sha256: null,
      observedDetail: null,
      observedFatal: null,
    };
  }
};

const main = async () => {
  const zen = await launchLiveZen();
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
        console.error(`live harness signal cleanup failed: ${error.stack ?? error}`),
      )
      .finally(() => process.exit(code));
  };
  const onInterrupt = () => exitAfterSignal(130);
  const onTerminate = () => exitAfterSignal(143);
  // Keep the handlers installed while asynchronous cleanup runs. A second signal
  // must not restore Node's default immediate exit and orphan the throwaway profile.
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  try {
    client = await openMarionette({ port: zen.port });
    await client.setScriptTimeout(180_000);
    const result = await client.executeAsync(PROBE, [
      {
        buildId: zen.platformStamp.zen.buildId,
        geckoVersion: zen.platformStamp.zen.geckoVersion,
        modId: LIVE_MOD_ID,
        sineVersion: zen.platformStamp.sine.version,
        zenVersion: zen.platformStamp.zen.version,
      },
    ]);

    let assertions = null;
    let audit = null;
    let validationError = null;
    let verdicts = null;
    try {
      assertions = validateAssertionManifest(result, REQUIRED_ASSERTIONS);
      verdicts = collectVerdicts(assertions);
      audit = auditLifecycle(result.auditEvidence);
      if (!audit.ok) {
        throw new Error(`lifecycle audit failed: ${JSON.stringify(audit.violations)}`);
      }
    } catch (error) {
      validationError = String(error?.stack ?? error);
    }

    const artifact = {
      recordedAt: new Date().toISOString(),
      source: {
        commit: git(["rev-parse", "HEAD"]),
        status: git(["status", "--porcelain=v1"]),
      },
      fixtures: await fixtureEvidence(),
      diagnostics: {
        closeLifecycle: {
          exactCommand: "#cmd_closeWindow.doCommand()",
          signals: result.closeSignals,
          summary:
            "Zen closes the chrome window without beforeunload; Sine 2.3.3.0 therefore " +
            "does not call its per-window unload listener on this path. The fixture's " +
            "one-shot native unload fallback reaches the shared terminal stop instead.",
        },
        simultaneousImportCollision: {
          conclusion:
            "refuted: identical Date.now values still produce distinct per-window .uc.mjs imports",
          correctedCause:
            "the initial probe used window-local static .sys.mjs imports and layered trackers",
          initial: await initialAliasingEvidence(),
          control: result.simultaneousImportControl,
        },
      },
      stamp: zen.platformStamp,
      marionette: client.hello,
      runner: {
        node: process.version,
        v8: process.versions.v8,
        os: { platform: platform(), release: release(), arch: arch() },
      },
      contract: { requiredAssertions: REQUIRED_ASSERTIONS },
      validation: { audit, error: validationError, verdicts },
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
    console.log(`Raw lifecycle evidence: ${OUTPUT}`);
    if (validationError) {
      console.error(validationError);
      process.exitCode = 1;
    } else {
      console.log(`${verdicts.counts.passed}/${verdicts.counts.total} assertions passed`);
      if (!verdicts.ok) process.exitCode = 1;
    }
  } catch (error) {
    console.error(`live multi-window harness failed: ${error.stack ?? error.message}`);
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
