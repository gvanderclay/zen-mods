#!/usr/bin/env node

/**
 * Drives the committed Sidebar bundle through the installed Sine loader in an exact,
 * isolated Zen chrome window. This is intentionally an explicit platform check rather
 * than part of `pnpm run check`: it needs the stamped local Zen/Sine installation and,
 * in headed mode, creates a native macOS menu for visual inspection.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectVerdicts, summarizeTimings } from "@zen-mods/live-harness/core";
import { openMarionette } from "@zen-mods/live-harness/marionette";
import { validatePlatformStamp } from "@zen-mods/live-harness/platform-stamp";
import { launchLiveZen } from "@zen-mods/live-harness/zen-launcher";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MOD_DIRECTORY = resolve(DIRECTORY, "../..");
const REPOSITORY_ROOT = resolve(MOD_DIRECTORY, "../..");
const BUNDLE = resolve(MOD_DIRECTORY, "dist/sidebar-context-menu-customizer.uc.mjs");
const MANIFEST = resolve(MOD_DIRECTORY, "theme.json");
const outputPath = options => {
  const suffix = options.record ? "" : options.headed ? ".headed" : ".smoke";
  return resolve(
    REPOSITORY_ROOT,
    `.benchmarks/live/sidebar-context-menu-customizer${suffix}.json`,
  );
};

const parseArguments = arguments_ => {
  let headed = false;
  let record = false;
  let samples = 5;
  let samplesWereSpecified = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--headed") {
      headed = true;
    } else if (argument === "--record") {
      record = true;
    } else if (argument === "--samples") {
      const value = Number(arguments_[index + 1]);
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        throw new Error("--samples must be an integer from 1 through 100");
      }
      samples = value;
      samplesWereSpecified = true;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (record && headed) {
    throw new Error("--record and --headed are separate evidence modes");
  }
  if (record && samplesWereSpecified) {
    throw new Error("--record always captures exactly 30 samples");
  }
  return { headed, record, samples: record ? 30 : samples };
};

const requiredAssertionNames = options => {
  const names = [
    "exact Zen version",
    "real browser popup set",
    "leak detector catches a retained sentinel",
    "leak detector clears released sentinels",
    "mod starts disabled",
    "exact Sine enable installs one generation",
    "Customize action uses context-menu wording",
    "tracker attributes real mod listeners",
    "popup session owns one observer while open",
    "popup close releases its observer",
    "target-before-mod mutation is finalized synchronously",
    "target-after-mod mutation is finalized synchronously",
    "document mutation is finalized synchronously",
    "window mutation is finalized synchronously",
    "rapid reopen replaces the prior session",
    "repeated session close is harmless",
    "all-selected presentation hides More actions",
    "all-browser-hidden excluded presentation hides More actions",
    "regular tab context preserves every browser action",
    "multiselect context preserves every browser action",
    "pinned tab context preserves every browser action",
    "essential tab context preserves every browser action",
    "grouped tab context preserves every browser action",
    "Share submenu preserves its browser identity and state",
    "moved commands stay live",
    "late excluded action is adopted",
    "same-key late replacement is adopted",
    "late replacement restores to the browser slot",
    "late replacement command stays live",
    "reloaded generation completes a popup restoration cycle",
    "teardown fixture begins with an active presentation",
    "teardown restores the active presentation exactly",
    "exact Sine teardown releases every tracked resource",
    "teardown clears the window-persistent generation",
    "lifecycle produces no unhandled mod errors",
    "post-teardown events and mutations do no mod work",
    "harness removes every fixture from the real menu",
  ];
  if (!options.headed) {
    names.push(
      "editor omits submenu promotion controls",
      "tracker attributes real mod animation frames",
      "compact mode keeps the editor anchor visible",
      "compact mode releases the editor visibility hold",
      "RAF gate leaves unrelated browser frames live",
      "menu replaces a queued editor-open frame",
      "menu teardown cancels the queued editor-open frame",
      "stale editor-open delivery does no work",
      "editor replaces queued post-render focus",
      "editor teardown cancels queued post-render focus",
      "stale editor focus delivery does no work",
      "panel replaces queued shown focus",
      "panel teardown cancels queued shown focus",
      "stale shown focus delivery does no work",
      "panel replaces queued hidden focus",
      "panel teardown cancels queued hidden focus",
      "stale hidden focus delivery does no work",
      "repeated stale generation stop is harmless",
      "exact Sine re-enable installs one working generation",
      "post-C02 teardown releases every tracked resource",
      "C02 lifecycle produces no unhandled mod errors",
    );
  }
  for (let index = 1; index <= options.samples; index += 1) {
    names.push(
      `popup event order sample ${index}`,
      `presentation finalizes synchronously at window sample ${index}`,
      `excluded live nodes move without cloning sample ${index}`,
      `browser-owned state survives presentation sample ${index}`,
      `popup close restores exact root order sample ${index}`,
      `popup close restores fixture state sample ${index}`,
      `exact Sine reload orders unload before ready sample ${index}`,
      `reload replaces rather than duplicates sample ${index}`,
    );
    if (!options.headed) {
      names.push(`editor uses the real popup set sample ${index}`);
    }
  }
  return names;
};

const validateProbeResult = (result, options) => {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("live-XUL probe returned no result object");
  }
  if (!Array.isArray(result.assertions) || result.assertions.length === 0) {
    throw new Error("live-XUL probe returned no assertions");
  }
  const assertionNames = new Set(result.assertions.map(assertion => assertion?.name));
  const missingAssertions = requiredAssertionNames(options).filter(
    name => !assertionNames.has(name),
  );
  if (missingAssertions.length > 0) {
    throw new Error(`live-XUL probe omitted assertions: ${missingAssertions.join(", ")}`);
  }
  const expectedSamples = {
    editorOpen: options.headed ? 0 : options.samples,
    install: 1,
    popup: options.samples,
    reload: options.samples,
    teardown: 1,
  };
  for (const [name, expectedCount] of Object.entries(expectedSamples)) {
    const samples = result.samples?.[name];
    if (
      !Array.isArray(samples) ||
      samples.length !== expectedCount ||
      samples.some(sample => !Number.isFinite(sample) || sample < 0)
    ) {
      throw new Error(
        `live-XUL ${name} samples must contain ${expectedCount} finite non-negative values`,
      );
    }
  }
};

// Exact loader lifecycle: https://github.com/CosmoCreeper/Sine/blob/1d2879b4d2c69d11a84e447be994431376e6576b/src/core/manager.sys.mjs#L21-L65
// Native Cocoa snapshots after popupshowing: https://github.com/mozilla-firefox/firefox/blob/FIREFOX_153_0_3_RELEASE/widget/cocoa/nsMenuX.mm#L1032-L1080
const PROBE = `
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  const MOD_ID = "sidebar-context-menu-customizer";
  const OWNED_PREFIX = MOD_ID;
  const MENU_ID = "tabContextMenu";
  const CUSTOMIZE_ID = MOD_ID + "-tab-menu";
  const MORE_POPUP_ID = MOD_ID + "-more-actions-popup";
  const PANEL_ID = MOD_ID + "-editor-panel";
  const INITIALIZED_PREF = "zen." + MOD_ID + ".tab.opt-in-initialized";
  const EXCLUDED_PREF = "zen." + MOD_ID + ".tab.excluded-root-items";
  const FIXTURE_PREFIX = "sidebar-context-menu-harness-";
  const TARGET_SOURCE = "/" + MOD_ID + "/dist/";
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const report = {
    assertions: [],
    events: [],
    logs: [],
    samples: {
      editorOpen: [],
      install: [],
      mainThreadGap: [],
      popup: [],
      reload: [],
      teardown: [],
    },
  };
  const check = (name, condition, detail) => {
    report.assertions.push({ name, ok: Boolean(condition), detail });
    return condition;
  };
  const waitFor = async (name, read, timeout = 20000) => {
    const deadline = Date.now() + timeout;
    let value;
    while (Date.now() < deadline) {
      value = read();
      if (value) return value;
      await wait(25);
    }
    throw new Error("timed out waiting for " + name + "; last value: " + String(value));
  };
  const waitForEvent = (target, type, timeout = 10000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        target.removeEventListener(type, listener);
        reject(new Error("timed out waiting for " + type));
      }, timeout);
      const listener = event => {
        clearTimeout(timer);
        resolve(event);
      };
      target.addEventListener(type, listener, { once: true });
    });
  const flushMutationDelivery = async () => {
    await Promise.resolve();
    await wait(0);
  };
  const ownedNodes = () => [
    ...document.querySelectorAll('[id^="' + OWNED_PREFIX + '"]'),
  ];
  const browserChildren = menu =>
    [...menu.children].filter(node => !node.id.startsWith(OWNED_PREFIX));
  const sameIdentityOrder = (left, right) =>
    left.length === right.length && left.every((node, index) => node === right[index]);
  const nodeState = node => ({
    attributes: [...node.attributes]
      .map(attribute => [attribute.name, attribute.value])
      .sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0),
    checked: node.checked === true,
    children: [...node.children],
    disabled: node.disabled === true,
    hidden: node.hidden === true,
  });
  const sameNodeState = (left, right) =>
    left.hidden === right.hidden &&
    left.disabled === right.disabled &&
    left.checked === right.checked &&
    left.attributes.length === right.attributes.length &&
    left.attributes.every(
      (attribute, index) =>
        attribute[0] === right.attributes[index]?.[0] &&
        attribute[1] === right.attributes[index]?.[1],
    ) &&
    sameIdentityOrder(left.children, right.children);

  (async () => {
    const menu = await waitFor("the real tab context menu", () => document.getElementById(MENU_ID));
    const popupSet = document.getElementById("mainPopupSet");
    const manager = ChromeUtils.importESModule(
      "chrome://userscripts/content/core/manager.sys.mjs",
    ).default;
    const sineUtils = ChromeUtils.importESModule(
      "chrome://userscripts/content/core/utils.sys.mjs",
    ).default;
    await waitFor("Sine's window interface", () => typeof window.addUnloadListener === "function");

    report.platform = {
      zenVersion: Services.appinfo.version,
      buildId: Services.appinfo.appBuildID,
      geckoVersion: Services.appinfo.platformVersion,
      sineVersion: options.sineVersion,
    };
    check(
      "exact Zen version",
      Services.appinfo.version === options.zenVersion &&
        Services.appinfo.appBuildID === options.buildId &&
        Services.appinfo.platformVersion === options.geckoVersion,
      Services.appinfo.version + " / " + Services.appinfo.appBuildID +
        " / Gecko " + Services.appinfo.platformVersion,
    );
    check(
      "real browser popup set",
      Boolean(popupSet && menu.parentElement === popupSet),
      "#tabContextMenu is a direct child of #mainPopupSet",
    );

    const native = {
      add: EventTarget.prototype.addEventListener,
      remove: EventTarget.prototype.removeEventListener,
      MutationObserver: window.MutationObserver,
      requestAnimationFrame: window.requestAnimationFrame,
      cancelAnimationFrame: window.cancelAnimationFrame,
      consoleInfo: console.info,
    };
    const tracker = {
      attributed: { frames: 0, listeners: 0, observers: 0 },
      frameGate: {
        enabled: false,
        nextSyntheticHandle: -1,
        passTargetFrames: 0,
      },
      force: false,
      listeners: [],
      observers: [],
      frames: [],
    };
    const runtimeErrors = [];
    const onRuntimeError = event => {
      const detail = String(event.error?.stack || event.message || event.error || "");
      if (String(event.filename || "").includes(TARGET_SOURCE) || detail.includes(MOD_ID)) {
        runtimeErrors.push(detail);
      }
    };
    const onUnhandledRejection = event => {
      const detail = String(event.reason?.stack || event.reason || "");
      if (detail.includes(MOD_ID)) runtimeErrors.push(detail);
    };
    window.addEventListener("error", onRuntimeError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    const capture = options =>
      typeof options === "boolean" ? options : Boolean(options && options.capture);
    const calledFromTarget = () => {
      if (tracker.force) return true;
      try {
        let frame = Components.stack;
        while (frame) {
          if (String(frame.filename || "").includes(TARGET_SOURCE)) return true;
          frame = frame.caller;
        }
      } catch {}
      return String(new Error().stack || "").includes(TARGET_SOURCE);
    };
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (calledFromTarget()) {
        tracker.attributed.listeners += 1;
        const record = {
          active: true,
          capture: capture(options),
          listener,
          target: this,
          type,
        };
        tracker.listeners.push(record);
        if (options && typeof options === "object" && options.signal) {
          native.add.call(
            options.signal,
            "abort",
            () => { record.active = false; },
            { once: true },
          );
        }
      }
      return native.add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      const useCapture = capture(options);
      const record = tracker.listeners.findLast(candidate =>
        candidate.active &&
        candidate.target === this &&
        candidate.type === type &&
        candidate.listener === listener &&
        candidate.capture === useCapture
      );
      if (record) record.active = false;
      return native.remove.call(this, type, listener, options);
    };
    window.MutationObserver = function (callback) {
      const observer = new native.MutationObserver(callback);
      const targetOwned = calledFromTarget();
      if (targetOwned) tracker.attributed.observers += 1;
      const record = { active: false, observer, targetOwned };
      tracker.observers.push(record);
      const observe = observer.observe.bind(observer);
      const disconnect = observer.disconnect.bind(observer);
      observer.observe = (...arguments_) => {
        if (record.targetOwned || calledFromTarget()) {
          if (!record.targetOwned) tracker.attributed.observers += 1;
          record.targetOwned = true;
          record.active = true;
        }
        return observe(...arguments_);
      };
      observer.disconnect = () => {
        record.active = false;
        return disconnect();
      };
      return observer;
    };
    window.MutationObserver.prototype = native.MutationObserver.prototype;
    window.requestAnimationFrame = callback => {
      const targetOwned = calledFromTarget();
      if (targetOwned) tracker.attributed.frames += 1;
      const hold =
        targetOwned && tracker.frameGate.enabled && tracker.frameGate.passTargetFrames === 0;
      if (targetOwned && tracker.frameGate.enabled && tracker.frameGate.passTargetFrames > 0) {
        tracker.frameGate.passTargetFrames -= 1;
      }
      const record = {
        canceled: false,
        canceledByTarget: false,
        delivered: false,
        handle: null,
        held: hold,
        pending: true,
        targetOwned,
      };
      const wrapped = timestamp => {
        record.delivered = true;
        record.pending = false;
        return callback(timestamp);
      };
      record.invoke = wrapped;
      if (hold) {
        record.handle = tracker.frameGate.nextSyntheticHandle;
        tracker.frameGate.nextSyntheticHandle -= 1;
      } else {
        record.handle = native.requestAnimationFrame.call(window, wrapped);
      }
      tracker.frames.push(record);
      return record.handle;
    };
    window.cancelAnimationFrame = handle => {
      const record = tracker.frames.findLast(
        candidate => candidate.handle === handle && candidate.pending,
      );
      if (record) {
        record.canceled = true;
        record.canceledByTarget = calledFromTarget();
        record.pending = false;
        if (record.held) return;
      }
      return native.cancelAnimationFrame.call(window, handle);
    };
    console.info = (...arguments_) => {
      if (String(arguments_[0] || "").startsWith("[" + MOD_ID + "]")) {
        report.logs.push({ at: performance.now(), text: arguments_.join(" ") });
      }
      return native.consoleInfo.apply(console, arguments_);
    };
    const leaks = () => {
      const persistentListenerRecords = tracker.listeners.filter(record =>
        record.active &&
        (!(record.target instanceof Node) || record.target === menu || record.target.isConnected)
      );
      return {
        frames: tracker.frames.filter(record => record.targetOwned && record.pending),
        listeners: persistentListenerRecords,
        observers: tracker.observers.filter(record => record.targetOwned && record.active),
        ownedNodes: ownedNodes(),
      };
    };
    const leakCounts = value => ({
      frames: value.frames.length,
      listeners: value.listeners.length,
      observers: value.observers.length,
      ownedNodes: value.ownedNodes.length,
    });
    const beginHeldTargetFrames = (passTargetFrames = 0) => {
      tracker.frameGate.enabled = true;
      tracker.frameGate.passTargetFrames = passTargetFrames;
      return tracker.frames.length;
    };
    const targetFramesSince = mark =>
      tracker.frames.slice(mark).filter(record => record.targetOwned);
    const heldTargetFramesSince = mark =>
      targetFramesSince(mark).filter(record => record.held);
    const waitForHeldTargetFrames = (name, mark, count) =>
      waitFor(name, () => {
        const records = heldTargetFramesSince(mark);
        return records.length >= count ? records : null;
      });
    const forceStaleFrame = record => {
      try {
        record.invoke(performance.now());
        return null;
      } catch (error) {
        return String(error?.stack || error);
      }
    };
    const finishHeldTargetFrames = mark => {
      tracker.frameGate.enabled = false;
      tracker.frameGate.passTargetFrames = 0;
      for (const record of heldTargetFramesSince(mark)) {
        if (record.pending) {
          record.canceled = true;
          record.canceledByHarness = true;
          record.pending = false;
        }
      }
    };
    const flushNativeFrame = () =>
      new Promise(resolve => native.requestAnimationFrame.call(window, resolve));
    const observeDetachedWork = target => {
      let delivered = 0;
      const observer = new native.MutationObserver(records => {
        delivered += records.length;
      });
      observer.observe(target, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
      return {
        disconnect: () => observer.disconnect(),
        read: () => {
          delivered += observer.takeRecords().length;
          return delivered;
        },
        reset: () => {
          observer.takeRecords();
          delivered = 0;
        },
      };
    };
    const spyMethod = (target, name) => {
      const ownDescriptor = target ? Object.getOwnPropertyDescriptor(target, name) : null;
      const original = target?.[name];
      const spy = { calls: 0, installed: false };
      if (!target || typeof original !== "function") {
        return { ...spy, restore: () => {} };
      }
      const replacement = function () {
        spy.calls += 1;
      };
      try {
        Object.defineProperty(target, name, {
          configurable: true,
          value: replacement,
          writable: true,
        });
        spy.installed = target[name] === replacement;
      } catch {}
      return {
        get calls() { return spy.calls; },
        get installed() { return spy.installed; },
        restore: () => {
          if (!spy.installed) return;
          if (ownDescriptor) {
            Object.defineProperty(target, name, ownDescriptor);
          } else {
            delete target[name];
          }
        },
      };
    };

    // Negative control: prove the ledger notices all four resource classes before it
    // is trusted to pronounce the real teardown clean.
    tracker.force = true;
    const sentinelListener = () => {};
    const sentinelWindowListener = () => {};
    menu.addEventListener("sidebar-harness-sentinel", sentinelListener);
    window.addEventListener("sidebar-harness-window-sentinel", sentinelWindowListener);
    const sentinelObserver = new MutationObserver(() => {});
    sentinelObserver.observe(menu, { childList: true });
    const sentinelFrame = requestAnimationFrame(() => {});
    const sentinelNode = document.createXULElement("menuitem");
    sentinelNode.id = OWNED_PREFIX + "-sentinel";
    menu.append(sentinelNode);
    tracker.force = false;
    const dirtySentinel = leakCounts(leaks());
    check(
      "leak detector catches a retained sentinel",
      dirtySentinel.listeners === 2 &&
        dirtySentinel.observers === 1 &&
        dirtySentinel.frames === 1 &&
        dirtySentinel.ownedNodes === 1,
      JSON.stringify(dirtySentinel),
    );
    menu.removeEventListener("sidebar-harness-sentinel", sentinelListener);
    window.removeEventListener("sidebar-harness-window-sentinel", sentinelWindowListener);
    sentinelObserver.disconnect();
    cancelAnimationFrame(sentinelFrame);
    sentinelNode.remove();
    const cleanSentinel = leakCounts(leaks());
    check(
      "leak detector clears released sentinels",
      Object.values(cleanSentinel).every(count => count === 0),
      JSON.stringify(cleanSentinel),
    );
    tracker.attributed = { frames: 0, listeners: 0, observers: 0 };

    const contextTab = gBrowser.selectedTab;
    const warmShown = waitForEvent(menu, "popupshown");
    menu.openPopup(contextTab, "after_start", 0, 0, true, false);
    await warmShown;
    const warmHidden = waitForEvent(menu, "popuphidden");
    menu.hidePopup();
    await warmHidden;
    const untouchedBrowserRoot = [...menu.children];

    const fixture = (localName, id, label) => {
      const node = document.createXULElement(localName);
      node.id = FIXTURE_PREFIX + id;
      if (label) node.setAttribute("label", label);
      return node;
    };
    const separatorBefore = fixture("menuseparator", "before");
    const selected = fixture("menuitem", "selected", "Harness selected action");
    const ordinary = fixture("menuitem", "ordinary", "Harness ordinary action");
    ordinary.setAttribute("checked", "true");
    ordinary.setAttribute("data-l10n-id", "sidebar-harness-ordinary");
    const browserHidden = fixture(
      "menuitem",
      "browser-hidden",
      "Harness browser-hidden action",
    );
    browserHidden.hidden = true;
    browserHidden.setAttribute("disabled", "true");
    const submenu = fixture("menu", "submenu", "Harness submenu");
    const submenuPopup = fixture("menupopup", "submenu-popup");
    const submenuChild = fixture("menuitem", "submenu-child", "Harness child command");
    submenuPopup.append(submenuChild);
    submenu.append(submenuPopup);
    const separatorAfter = fixture("menuseparator", "after");
    const beforeModAction = fixture(
      "menuitem",
      "target-before-mod",
      "Harness target-before-mod action",
    );
    const afterModAction = fixture(
      "menuitem",
      "target-after-mod",
      "Harness target-after-mod action",
    );
    const documentAction = fixture(
      "menuitem",
      "document-late",
      "Harness document action",
    );
    const windowAction = fixture(
      "menuitem",
      "window-late",
      "Harness window action",
    );
    menu.append(
      separatorBefore,
      selected,
      ordinary,
      browserHidden,
      submenu,
      separatorAfter,
    );
    let ordinaryCommands = 0;
    let submenuCommands = 0;
    ordinary.addEventListener("command", () => { ordinaryCommands += 1; });
    submenuChild.addEventListener("command", () => { submenuCommands += 1; });

    const futureKey = FIXTURE_PREFIX + "late";
    const excluded = [
      ordinary.id,
      browserHidden.id,
      submenu.id,
      futureKey,
      beforeModAction.id,
      afterModAction.id,
      documentAction.id,
      windowAction.id,
    ];
    Services.prefs.setBoolPref(INITIALIZED_PREF, true);
    Services.prefs.setStringPref(EXCLUDED_PREF, JSON.stringify(excluded));

    const preModSnapshots = [];
    let listenerMutationRound = false;
    const preModShowing = event => {
      if (event.target !== menu) return;
      report.events.push("pre-mod-target");
      if (listenerMutationRound && !beforeModAction.isConnected) {
        menu.insertBefore(
          beforeModAction,
          document.getElementById(MOD_ID + "-tab-separator"),
        );
      }
      preModSnapshots.push({
        order: browserChildren(menu),
        states: new Map(browserChildren(menu).map(node => [node, nodeState(node)])),
      });
      report.targetGapStartedAt = performance.now();
    };
    menu.addEventListener("popupshowing", preModShowing);

    check("mod starts disabled", ownedNodes().length === 0, "zero owned nodes before enable");
    const installedMods = await sineUtils.getMods();
    const enableStart = performance.now();
    await manager.toggleTheme(installedMods, MOD_ID);
    const customize = await waitFor(
      "Sine to import the enabled bundle",
      () => document.getElementById(CUSTOMIZE_ID),
    );
    report.samples.install.push(performance.now() - enableStart);
    check(
      "exact Sine enable installs one generation",
      document.querySelectorAll("#" + CSS.escape(CUSTOMIZE_ID)).length === 1 &&
        window.zenSidebarContextMenuCustomizer?.isLive?.() === true,
      ownedNodes().length + " owned DOM nodes; generation live=" +
        String(window.zenSidebarContextMenuCustomizer?.isLive?.()),
    );
    check(
      "Customize action uses context-menu wording",
      customize.getAttribute("label") === "Customize context menu…",
      String(customize.getAttribute("label")),
    );
    check(
      "tracker attributes real mod listeners",
      tracker.attributed.listeners > 0 && tracker.attributed.observers === 0,
      JSON.stringify(tracker.attributed),
    );

    let finalizerObservations = 0;
    const postModShowing = event => {
      if (event.target !== menu) return;
      report.lastTargetGap = performance.now() - report.targetGapStartedAt;
      report.events.push("post-mod-target");
      if (listenerMutationRound && !afterModAction.isConnected) {
        menu.insertBefore(
          afterModAction,
          document.getElementById(MOD_ID + "-tab-separator"),
        );
      }
      report.lastTargetUnmoved =
        ordinary.parentElement === menu &&
        browserHidden.parentElement === menu &&
        submenu.parentElement === menu;
      report.lastTargetBrowserStatePreserved = browserStateIsPreserved(
        preModSnapshots.at(-1),
      );
      const sourceEvent = event;
      const afterFinalizer = observedEvent => {
        if (observedEvent !== sourceEvent) return;
        window.removeEventListener("popupshowing", afterFinalizer);
        report.lastWindowGap = performance.now() - report.windowGapStartedAt;
        finalizerObservations += 1;
        report.events.push("post-finalizer-window");
        report.lastFinalizerMoved =
          ordinary.parentElement?.id === MORE_POPUP_ID &&
          browserHidden.parentElement?.id === MORE_POPUP_ID &&
          submenu.parentElement?.id === MORE_POPUP_ID &&
          selected.parentElement === menu;
        report.lastFinalizerBrowserStatePreserved = browserStateIsPreserved(
          preModSnapshots.at(-1),
        );
      };
      window.addEventListener("popupshowing", afterFinalizer);
    };
    const documentShowing = event => {
      if (event.target !== menu) return;
      report.events.push("document-bubble");
      if (listenerMutationRound && !documentAction.isConnected) {
        menu.insertBefore(
          documentAction,
          document.getElementById(MOD_ID + "-tab-separator"),
        );
      }
    };
    const windowShowing = event => {
      if (event.target !== menu) return;
      report.events.push("window-bubble");
      if (listenerMutationRound && !windowAction.isConnected) {
        menu.insertBefore(
          windowAction,
          document.getElementById(MOD_ID + "-tab-separator"),
        );
      }
      report.windowGapStartedAt = performance.now();
    };
    menu.addEventListener("popupshowing", postModShowing);
    document.addEventListener("popupshowing", documentShowing);
    window.addEventListener("popupshowing", windowShowing);

    const openRealMenu = async () => {
      report.events.length = 0;
      const shown = waitForEvent(menu, "popupshown").then(() => {
        report.events.push("popupshown");
      });
      const rect = contextTab.getBoundingClientRect();
      contextTab.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          clientX: rect.left + Math.max(1, rect.width / 2),
          clientY: rect.top + Math.max(1, rect.height / 2),
        }),
      );
      await shown;
      report.openingPath = "tab contextmenu event";
    };
    const closeRealMenu = async () => {
      if (menu.state === "closed") {
        report.events.push("popuphidden");
        await flushMutationDelivery();
        return;
      }
      const hidden = waitForEvent(menu, "popuphidden");
      menu.hidePopup();
      await hidden;
      report.events.push("popuphidden");
      await flushMutationDelivery();
    };
    const browserStateIsPreserved = snapshot =>
      [...snapshot.states].every(([node, state]) => sameNodeState(state, nodeState(node)));
    const checkRealContext = async (name, expected) => {
      await openRealMenu();
      const snapshot = preModSnapshots.at(-1);
      const expectedState = expected();
      check(
        name,
        expectedState && report.lastFinalizerBrowserStatePreserved === true,
        JSON.stringify({
          browserActions: snapshot.states.size,
          expectedState,
          preservedAtFinalizer: report.lastFinalizerBrowserStatePreserved,
        }),
      );
      await closeRealMenu();
    };
    const addMatrixTab = label => {
      const tab = gBrowser.addTab("about:blank", {
        inBackground: true,
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
      tab.setAttribute("label", label);
      return tab;
    };

    // Warm the one intentional proxy placement, then capture a stable full root order.
    await openRealMenu();
    check(
      "popup session owns one observer while open",
      tracker.attributed.observers === 1 && leaks().observers.length === 1,
      JSON.stringify({
        attributed: tracker.attributed.observers,
        active: leaks().observers.length,
      }),
    );
    await closeRealMenu();
    check(
      "popup close releases its observer",
      leaks().observers.length === 0,
      JSON.stringify(leakCounts(leaks())),
    );

    listenerMutationRound = true;
    await openRealMenu();
    check(
      "target-before-mod mutation is finalized synchronously",
      beforeModAction.parentElement?.id === MORE_POPUP_ID,
      String(beforeModAction.parentElement?.id),
    );
    check(
      "target-after-mod mutation is finalized synchronously",
      afterModAction.parentElement?.id === MORE_POPUP_ID,
      String(afterModAction.parentElement?.id),
    );
    check(
      "document mutation is finalized synchronously",
      documentAction.parentElement?.id === MORE_POPUP_ID,
      String(documentAction.parentElement?.id),
    );
    check(
      "window mutation is finalized synchronously",
      windowAction.parentElement?.id === MORE_POPUP_ID,
      String(windowAction.parentElement?.id),
    );
    await closeRealMenu();
    listenerMutationRound = false;
    beforeModAction.remove();
    afterModAction.remove();
    documentAction.remove();
    windowAction.remove();

    Services.prefs.setStringPref(EXCLUDED_PREF, "[]");
    await openRealMenu();
    check(
      "all-selected presentation hides More actions",
      document.getElementById(MOD_ID + "-more-actions-menu").hidden &&
        ordinary.parentElement === menu,
      JSON.stringify({
        hidden: document.getElementById(MOD_ID + "-more-actions-menu").hidden,
        ordinaryParent: ordinary.parentElement?.id,
      }),
    );
    await closeRealMenu();

    Services.prefs.setStringPref(EXCLUDED_PREF, JSON.stringify([browserHidden.id]));
    await openRealMenu();
    check(
      "all-browser-hidden excluded presentation hides More actions",
      document.getElementById(MOD_ID + "-more-actions-menu").hidden &&
        browserHidden.parentElement?.id === MORE_POPUP_ID,
      JSON.stringify({
        hidden: document.getElementById(MOD_ID + "-more-actions-menu").hidden,
        browserHiddenParent: browserHidden.parentElement?.id,
      }),
    );
    await closeRealMenu();
    Services.prefs.setStringPref(EXCLUDED_PREF, JSON.stringify(excluded));

    const rapidRootOrder = [...menu.children];
    await openRealMenu();
    const firstRapidObserver = leaks().observers[0]?.observer;
    const rapidFinalizersBefore = finalizerObservations;
    menu.dispatchEvent(new Event("popupshowing", { bubbles: true }));
    check(
      "rapid reopen replaces the prior session",
      finalizerObservations === rapidFinalizersBefore + 1 &&
        leaks().observers.length === 1 &&
        leaks().observers[0]?.observer !== firstRapidObserver &&
        ordinary.parentElement?.id === MORE_POPUP_ID,
      JSON.stringify({
        finalizerDelta: finalizerObservations - rapidFinalizersBefore,
        activeObservers: leaks().observers.length,
      }),
    );
    menu.dispatchEvent(new Event("popuphidden", { bubbles: true }));
    menu.dispatchEvent(new Event("popuphidden", { bubbles: true }));
    check(
      "repeated session close is harmless",
      leaks().observers.length === 0 &&
        sameIdentityOrder(rapidRootOrder, [...menu.children]),
      JSON.stringify({
        activeObservers: leaks().observers.length,
        rootChildren: menu.children.length,
      }),
    );
    await closeRealMenu();

    const stableRootOrder = [...menu.children];
    const stableBrowserOrder = browserChildren(menu);
    const stableFixtureStates = new Map(
      [
        selected,
        ordinary,
        browserHidden,
        submenu,
        submenuPopup,
        submenuChild,
        separatorBefore,
        separatorAfter,
      ].map(node => [node, { parent: node.parentElement, state: nodeState(node) }]),
    );

    for (let index = 0; index < options.samples; index += 1) {
      const finalizersBefore = finalizerObservations;
      const start = performance.now();
      await openRealMenu();
      report.samples.popup.push(performance.now() - start);
      report.samples.mainThreadGap.push(
        Math.max(report.lastTargetGap, report.lastWindowGap),
      );
      check(
        "popup event order sample " + (index + 1),
        report.events.join(",") ===
          "pre-mod-target,post-mod-target,document-bubble,window-bubble," +
            "post-finalizer-window,popupshown",
        report.events.join(" -> "),
      );
      check(
        "presentation finalizes synchronously at window sample " + (index + 1),
        report.lastTargetUnmoved === true &&
          report.lastFinalizerMoved === true &&
          finalizerObservations === finalizersBefore + 1,
        JSON.stringify({
          targetUnmoved: report.lastTargetUnmoved,
          finalizerMoved: report.lastFinalizerMoved,
          finalizerDelta: finalizerObservations - finalizersBefore,
        }),
      );
      check(
        "excluded live nodes move without cloning sample " + (index + 1),
        ordinary.parentElement?.id === MORE_POPUP_ID &&
          browserHidden.parentElement?.id === MORE_POPUP_ID &&
          submenu.parentElement?.id === MORE_POPUP_ID &&
          selected.parentElement === menu &&
          submenuPopup.parentElement === submenu &&
          submenuPopup.firstElementChild === submenuChild,
        JSON.stringify({
          ordinaryParent: ordinary.parentElement?.id,
          hiddenParent: browserHidden.parentElement?.id,
          submenuParent: submenu.parentElement?.id,
          selectedParent: selected.parentElement?.id,
          submenuPopupSame: submenu.firstElementChild === submenuPopup,
          submenuPopupParentSame: submenuPopup.parentElement === submenu,
          submenuChildren: [...submenu.children].map(node => ({
            id: node.id,
            localName: node.localName,
          })),
          submenuChildSame: submenuPopup.firstElementChild === submenuChild,
        }),
      );
      check(
        "browser-owned state survives presentation sample " + (index + 1),
        report.lastTargetBrowserStatePreserved === true &&
          report.lastFinalizerBrowserStatePreserved === true,
        JSON.stringify({
          browserActions: preModSnapshots.at(-1).states.size,
          targetPreserved: report.lastTargetBrowserStatePreserved,
          finalizerPreserved: report.lastFinalizerBrowserStatePreserved,
          hidden: browserHidden.hidden,
          disabled: browserHidden.hasAttribute("disabled"),
          checked: ordinary.getAttribute("checked"),
        }),
      );
      if (index === 0) {
        ordinary.dispatchEvent(new Event("command", { bubbles: true }));
        submenuChild.dispatchEvent(new Event("command", { bubbles: true }));
      }
      await closeRealMenu();
      check(
        "popup close restores exact root order sample " + (index + 1),
        sameIdentityOrder(stableRootOrder, [...menu.children]) &&
          sameIdentityOrder(stableBrowserOrder, browserChildren(menu)),
        "root has " + menu.children.length + " live children",
      );
      check(
        "popup close restores fixture state sample " + (index + 1),
        [...stableFixtureStates].every(([node, expected]) =>
          node.parentElement === expected.parent &&
          sameNodeState(expected.state, nodeState(node))
        ),
        "parents, full attributes, properties, child identities, and separators restored",
      );
    }

    await checkRealContext(
      "regular tab context preserves every browser action",
      () =>
        !document.getElementById("context_reloadTab").hidden &&
        document.getElementById("context_reloadSelectedTabs").hidden,
    );
    await checkRealContext(
      "Share submenu preserves its browser identity and state",
      () => {
        const share = [...menu.children].find(node =>
          node.classList.contains("share-tab-url-item"),
        );
        return Boolean(
          share &&
            share.parentElement === menu &&
            [...share.children].some(child => child.localName === "menupopup"),
        );
      },
    );

    const multiselectTab = addMatrixTab("Sidebar harness multiselect");
    gBrowser.addToMultiSelectedTabs(contextTab);
    gBrowser.addToMultiSelectedTabs(multiselectTab);
    await checkRealContext(
      "multiselect context preserves every browser action",
      () =>
        document.getElementById("context_reloadTab").hidden &&
        !document.getElementById("context_reloadSelectedTabs").hidden,
    );
    gBrowser.clearMultiSelectedTabs();
    gBrowser.removeTab(multiselectTab, { animate: false, skipPermitUnload: true });

    gBrowser.pinTab(contextTab);
    await checkRealContext(
      "pinned tab context preserves every browser action",
      () =>
        contextTab.pinned &&
        document.getElementById("context_pinTab").hidden &&
        !document.getElementById("context_unpinTab").hidden,
    );
    contextTab.setAttribute("zen-essential", "true");
    await checkRealContext(
      "essential tab context preserves every browser action",
      () =>
        document.getElementById("context_closeTab").hidden &&
        !document.getElementById("context_zen-remove-essential").hidden,
    );
    contextTab.removeAttribute("zen-essential");
    gBrowser.unpinTab(contextTab);

    const groupedTab = addMatrixTab("Sidebar harness group");
    const group = gBrowser.addTabGroup([contextTab, groupedTab], {
      insertBefore: contextTab,
      label: "Sidebar harness group",
    });
    await checkRealContext(
      "grouped tab context preserves every browser action",
      () =>
        Boolean(
          group &&
            contextTab.group === group,
        ),
    );
    gBrowser.ungroupTab(contextTab);
    gBrowser.ungroupTab(groupedTab);
    gBrowser.removeTab(groupedTab, { animate: false, skipPermitUnload: true });

    check(
      "moved commands stay live",
      ordinaryCommands === 1 && submenuCommands === 1,
      ordinaryCommands + " ordinary / " + submenuCommands + " nested command(s)",
    );

    // The current observer path must adopt a direct-root insertion and its same-key
    // replacement while preserving the browser-chosen slot on restoration.
    await openRealMenu();
    const boundary = document.getElementById(MOD_ID + "-tab-separator");
    const late = fixture("menuitem", "late", "Harness late action");
    menu.insertBefore(late, boundary);
    await flushMutationDelivery();
    check(
      "late excluded action is adopted",
      late.parentElement?.id === MORE_POPUP_ID,
      "late action parent is " + late.parentElement?.id,
    );
    const replacement = fixture("menuitem", "late", "Harness replacement action");
    let replacementCommands = 0;
    replacement.addEventListener("command", () => { replacementCommands += 1; });
    late.remove();
    menu.insertBefore(replacement, boundary);
    await flushMutationDelivery();
    check(
      "same-key late replacement is adopted",
      !late.isConnected && replacement.parentElement?.id === MORE_POPUP_ID,
      "old disconnected and replacement moved live",
    );
    replacement.dispatchEvent(new Event("command", { bubbles: true }));
    await closeRealMenu();
    check(
      "late replacement restores to the browser slot",
      replacement.parentElement === menu && replacement.nextElementSibling === boundary,
      "replacement returned immediately before the customizer boundary",
    );
    check(
      "late replacement command stays live",
      replacementCommands === 1,
      replacementCommands + " replacement command(s)",
    );
    replacement.remove();

    // The real Customize command must cross its requestAnimationFrame boundary and
    // open the real panel under #mainPopupSet. Frames are drained before teardown;
    // C02 deliberately tests destroying between scheduling and delivery.
    const editorSamples = options.headed ? 0 : options.samples;
    for (let index = 0; index < editorSamples; index += 1) {
      const panel = document.getElementById(PANEL_ID);
      const shown = waitForEvent(panel, "popupshown");
      const start = performance.now();
      customize.dispatchEvent(new Event("command", { bubbles: true }));
      await shown;
      report.samples.editorOpen.push(performance.now() - start);
      check(
        "editor uses the real popup set sample " + (index + 1),
        panel.parentElement === popupSet && panel.state === "open",
        "panel state " + panel.state,
      );
      if (index === 0) {
        check(
          "editor omits submenu promotion controls",
          !panel.querySelector('[data-action-key="promotion-copy-links"]') &&
            !panel.textContent.includes("From submenus"),
          "no Copy Link promotion row or From submenus section",
        );
      }
      const hidden = waitForEvent(panel, "popuphidden");
      panel.hidePopup();
      await hidden;
      await new Promise(resolve => requestAnimationFrame(() => resolve()));
    }
    if (!options.headed) {
      check(
        "tracker attributes real mod animation frames",
        tracker.attributed.frames > 0,
        JSON.stringify(tracker.attributed),
      );

      const compactSidebar = document.getElementById("navigator-toolbox");
      const compactWasEnabled = gZenCompactModeManager.preference;
      const hideTabbarPref = "zen.view.compact.hide-tabbar";
      const hadHideTabbarPref = Services.prefs.prefHasUserValue(hideTabbarPref);
      const hideTabbarValue = Services.prefs.getBoolPref(hideTabbarPref, false);
      const compactStartupPref = "zen.view.compact.enable-at-startup";
      const hadCompactStartupPref = Services.prefs.prefHasUserValue(compactStartupPref);
      const compactStartupValue = Services.prefs.getBoolPref(compactStartupPref, false);
      Services.prefs.setBoolPref(hideTabbarPref, true);
      if (!compactWasEnabled) {
        const toggled = waitForEvent(window, "ZenCompactMode:Toggled");
        gZenCompactModeManager.preference = true;
        await toggled;
      }
      for (const attribute of [
        "flash-popup",
        "has-popup-menu",
        "movingtab",
        "zen-compact-mode-active",
        "zen-has-empty-tab",
        "zen-has-hover",
        "zen-user-show",
      ]) {
        compactSidebar.removeAttribute(attribute);
      }
      const collapseDeadline = Date.now() + 1_000;
      while (contextTab.getBoundingClientRect().right > 1 && Date.now() < collapseDeadline) {
        await flushNativeFrame();
      }
      const collapsedTabRect = contextTab.getBoundingClientRect();
      const compactActiveGuard = new native.MutationObserver(() => {
        const marker = document.getElementById(MOD_ID + "-compact-mode-marker");
        if (
          !marker?.hasAttribute("open") &&
          compactSidebar.hasAttribute("zen-compact-mode-active")
        ) {
          compactSidebar.removeAttribute("zen-compact-mode-active");
        }
      });
      compactActiveGuard.observe(compactSidebar, {
        attributes: true,
        attributeFilter: ["zen-compact-mode-active"],
      });
      customize.dispatchEvent(new Event("command", { bubbles: true }));
      const compactPanel = document.getElementById(PANEL_ID);
      const compactDeadline = Date.now() + 1_000;
      while (compactPanel.state !== "open" && Date.now() < compactDeadline) {
        await flushNativeFrame();
      }
      const compactPanelRect = compactPanel.getBoundingClientRect();
      const compactTabRect = contextTab.getBoundingClientRect();
      const compactMatches = [
        ...compactSidebar.querySelectorAll(
          ":where([panelopen], [open], [breakout-extend])" +
            ":not(#urlbar[zen-floating-urlbar='true']):not(tab)" +
            ":not(.zen-compact-mode-ignore)",
        ),
      ].map(node => node.id || node.localName);
      check(
        "compact mode keeps the editor anchor visible",
        compactPanel.state === "open" &&
          compactSidebar.hasAttribute("zen-compact-mode-active"),
        "panel=" + compactPanel.state +
          "; active=" + compactSidebar.hasAttribute("zen-compact-mode-active") +
          "; panelRect=" + JSON.stringify(compactPanelRect.toJSON()) +
          "; tabRect=" + JSON.stringify(compactTabRect.toJSON()) +
          "; collapsedTabRect=" + JSON.stringify(collapsedTabRect.toJSON()) +
          "; matches=" + JSON.stringify(compactMatches),
      );
      if (compactPanel.state === "open") {
        const hidden = waitForEvent(compactPanel, "popuphidden");
        compactPanel.hidePopup();
        await hidden;
      }
      await flushMutationDelivery();
      const compactMarker = document.getElementById(MOD_ID + "-compact-mode-marker");
      check(
        "compact mode releases the editor visibility hold",
        !compactMarker?.hasAttribute("open") &&
          !compactSidebar.hasAttribute("zen-compact-mode-active"),
        "marker=" + compactMarker?.hasAttribute("open") +
          "; active=" + compactSidebar.hasAttribute("zen-compact-mode-active"),
      );
      compactActiveGuard.disconnect();
      if (!compactWasEnabled) {
        const toggled = waitForEvent(window, "ZenCompactMode:Toggled");
        gZenCompactModeManager.preference = false;
        await toggled;
      }
      if (hadHideTabbarPref) {
        Services.prefs.setBoolPref(hideTabbarPref, hideTabbarValue);
      } else {
        Services.prefs.clearUserPref(hideTabbarPref);
      }
      if (hadCompactStartupPref) {
        Services.prefs.setBoolPref(compactStartupPref, compactStartupValue);
      } else {
        Services.prefs.clearUserPref(compactStartupPref);
      }
      await flushMutationDelivery();
    }

    // Rebuild through the exact Sine loader. Its cache-busted import is intentionally
    // fire-and-forget, so readiness is observed rather than inferred from await.
    for (let index = 0; index < options.samples; index += 1) {
      const oldCustomize = document.getElementById(CUSTOMIZE_ID);
      const logStart = report.logs.length;
      const reloadStart = performance.now();
      await manager.rebuildMods(true, false);
      await waitFor(
        "old Sine generation to unload and the new one to become ready",
        () => {
          const messages = report.logs.slice(logStart).map(entry => entry.text);
          const current = document.getElementById(CUSTOMIZE_ID);
          return messages.some(line => line.includes("unloaded")) &&
            messages.some(line => line.includes("ready")) &&
            current && current !== oldCustomize;
        },
      );
      report.samples.reload.push(performance.now() - reloadStart);
      const reloadMessages = report.logs.slice(logStart).map(entry => entry.text);
      check(
        "exact Sine reload orders unload before ready sample " + (index + 1),
        reloadMessages.findIndex(line => line.includes("unloaded")) >= 0 &&
          reloadMessages.findIndex(line => line.includes("unloaded")) <
            reloadMessages.findIndex(line => line.includes("ready")),
        reloadMessages.join(" -> "),
      );
      check(
        "reload replaces rather than duplicates sample " + (index + 1),
        !oldCustomize.isConnected &&
          document.querySelectorAll("#" + CSS.escape(CUSTOMIZE_ID)).length === 1 &&
          window.zenSidebarContextMenuCustomizer?.isLive?.() === true,
        "old disconnected; one current node and live generation",
      );
    }
    await openRealMenu();
    await closeRealMenu();
    check(
      "reloaded generation completes a popup restoration cycle",
      ordinary.parentElement === menu && browserHidden.parentElement === menu,
      "fixture actions restored to the real root",
    );

    if (options.headed) {
      await openRealMenu();
      report.nativeSmoke = {
        opened: menu.state === "open",
        secondsVisible: 10,
      };
      await wait(10_000);
      await closeRealMenu();
    }

    const teardownBrowserOrder = browserChildren(menu);
    const teardownFixtureStates = new Map(
      [...stableFixtureStates.keys()].map(node => [
        node,
        { parent: node.parentElement, state: nodeState(node) },
      ]),
    );
    await openRealMenu();
    check(
      "teardown fixture begins with an active presentation",
      ordinary.parentElement?.id === MORE_POPUP_ID &&
        submenu.parentElement?.id === MORE_POPUP_ID,
      "excluded fixtures are live inside More actions",
    );
    const disableMods = await sineUtils.getMods();
    const teardownStart = performance.now();
    const teardownLogStart = report.logs.length;
    await manager.toggleTheme(disableMods, MOD_ID);
    await waitFor(
      "exact Sine disable teardown",
      () =>
        report.logs.slice(teardownLogStart).some(entry => entry.text.includes("unloaded")) &&
        ownedNodes().length === 0,
    );
    report.samples.teardown.push(performance.now() - teardownStart);
    await flushMutationDelivery();
    check(
      "teardown restores the active presentation exactly",
      sameIdentityOrder(teardownBrowserOrder, browserChildren(menu)) &&
        [...teardownFixtureStates].every(([node, expected]) =>
          node.parentElement === expected.parent &&
          sameNodeState(expected.state, nodeState(node))
        ),
      "browser action identities, order, parents, state, and separator overrides restored",
    );
    if (menu.state === "open") {
      await closeRealMenu();
    }
    await new Promise(resolve => requestAnimationFrame(() => resolve()));
    const finalLeaks = leakCounts(leaks());
    check(
      "exact Sine teardown releases every tracked resource",
      Object.values(finalLeaks).every(count => count === 0),
      JSON.stringify(finalLeaks),
    );
    check(
      "teardown clears the window-persistent generation",
      window.zenSidebarContextMenuCustomizer === undefined,
      String(window.zenSidebarContextMenuCustomizer),
    );
    check(
      "lifecycle produces no unhandled mod errors",
      runtimeErrors.length === 0,
      runtimeErrors.join(" | "),
    );

    const afterTeardownOrder = [...menu.children];
    menu.dispatchEvent(new Event("popupshowing", { bubbles: true }));
    menu.dispatchEvent(new Event("popuphidden", { bubbles: true }));
    const postTeardown = fixture("menuitem", "post-teardown", "Post teardown");
    menu.append(postTeardown);
    await flushMutationDelivery();
    check(
      "post-teardown events and mutations do no mod work",
      sameIdentityOrder(afterTeardownOrder, [...menu.children].slice(0, -1)) &&
        postTeardown.parentElement === menu &&
        ownedNodes().length === 0,
      "no owned nodes and the new action remains at root",
    );
    postTeardown.remove();

    if (!options.headed) {
      // C02 starts only after C01's timed lifecycle has completed. Target-attributed
      // frames are held without pausing browser or harness animation callbacks, then
      // their preserved callbacks are deliberately invoked after teardown. That proves
      // both native cancellation and the owner's destroyed-generation delivery guard.
      const c02RuntimeErrorStart = runtimeErrors.length;
      const c02ForcedErrors = [];
      const currentGeneration = () => ({
        customize: document.getElementById(CUSTOMIZE_ID),
        panel: document.getElementById(PANEL_ID),
      });
      const enableGeneration = async (name, previousCustomize = null) => {
        const mods = await sineUtils.getMods();
        const logStart = report.logs.length;
        await manager.toggleTheme(mods, MOD_ID);
        return waitFor(name, () => {
          const messages = report.logs.slice(logStart).map(entry => entry.text);
          const generation = currentGeneration();
          return messages.some(line => line.includes("ready")) &&
              generation.customize &&
              generation.customize !== previousCustomize &&
              generation.panel
            ? generation
            : null;
        });
      };
      const reloadGeneration = async (name, previousCustomize) => {
        const logStart = report.logs.length;
        await manager.rebuildMods(true, false);
        return waitFor(name, () => {
          const messages = report.logs.slice(logStart).map(entry => entry.text);
          const generation = currentGeneration();
          return messages.some(line => line.includes("unloaded")) &&
              messages.some(line => line.includes("ready")) &&
              generation.customize &&
              generation.customize !== previousCustomize &&
              generation.panel
            ? generation
            : null;
        });
      };
      const disableGeneration = async name => {
        const mods = await sineUtils.getMods();
        const logStart = report.logs.length;
        await manager.toggleTheme(mods, MOD_ID);
        await waitFor(name, () =>
          report.logs.slice(logStart).some(entry => entry.text.includes("unloaded")) &&
          ownedNodes().length === 0 &&
          window.zenSidebarContextMenuCustomizer === undefined
        );
      };
      const openCurrentEditor = async generation => {
        const shown = waitForEvent(generation.panel, "popupshown");
        generation.customize.dispatchEvent(new Event("command", { bubbles: true }));
        await shown;
        await flushNativeFrame();
        await flushMutationDelivery();
        return generation.panel;
      };
      const closeCurrentEditor = async panel => {
        const hidden = waitForEvent(panel, "popuphidden");
        panel.hidePopup();
        await hidden;
        await flushNativeFrame();
        await flushMutationDelivery();
      };

      let generation = await enableGeneration("C02 setup generation to become ready");

      // Source 1: the menu installer's deferred editor open. A second command must
      // replace the first handle, and exact Sine reload must cancel the survivor.
      {
        const oldGeneration = generation;
        const oldPanel = oldGeneration.panel;
        const detachedWork = observeDetachedWork(oldPanel);
        const openPopupSpy = spyMethod(oldPanel, "openPopup");
        const mark = beginHeldTargetFrames();
        oldGeneration.customize.dispatchEvent(new Event("command", { bubbles: true }));
        oldGeneration.customize.dispatchEvent(new Event("command", { bubbles: true }));
        const frames = await waitForHeldTargetFrames(
          "two deferred editor-open frames",
          mark,
          2,
        );
        let unrelatedFrameDelivered = false;
        await new Promise(resolve => {
          window.requestAnimationFrame(() => {
            unrelatedFrameDelivered = true;
            resolve();
          });
        });
        check(
          "RAF gate leaves unrelated browser frames live",
          unrelatedFrameDelivered && frames[1]?.pending === true,
          "unrelated delivered " + unrelatedFrameDelivered +
            "; latest target pending " + frames[1]?.pending,
        );
        check(
          "menu replaces a queued editor-open frame",
          frames[0]?.canceledByTarget === true &&
            frames[0]?.pending === false &&
            frames[1]?.pending === true,
          JSON.stringify(frames.map(record => ({
            canceledByTarget: record.canceledByTarget,
            pending: record.pending,
          }))),
        );
        generation = await reloadGeneration(
          "editor-open generation to unload and reload",
          oldGeneration.customize,
        );
        await flushMutationDelivery();
        detachedWork.reset();
        check(
          "menu teardown cancels the queued editor-open frame",
          frames[1]?.canceledByTarget === true && frames[1]?.pending === false,
          JSON.stringify({
            canceledByTarget: frames[1]?.canceledByTarget,
            pending: frames[1]?.pending,
          }),
        );
        const errors = frames.map(forceStaleFrame).filter(Boolean);
        c02ForcedErrors.push(...errors);
        await flushNativeFrame();
        await flushMutationDelivery();
        const staleMutations = detachedWork.read();
        const currentPanel = document.getElementById(PANEL_ID);
        check(
          "stale editor-open delivery does no work",
          openPopupSpy.installed &&
            openPopupSpy.calls === 0 &&
            staleMutations === 0 &&
            errors.length === 0 &&
            !oldPanel.isConnected &&
            currentPanel === generation.panel &&
            (!currentPanel.state || currentPanel.state === "closed") &&
            targetFramesSince(mark).every(record => !record.pending),
          JSON.stringify({
            openPopupCalls: openPopupSpy.calls,
            staleMutations,
            errors,
            oldConnected: oldPanel.isConnected,
            currentState: currentPanel?.state,
          }),
        );
        finishHeldTargetFrames(mark);
        detachedWork.disconnect();
        openPopupSpy.restore();
      }

      // Source 2: the editor's shared post-render/filter focus owner. Queue filter
      // focus, then replace it with an action-row focus/scroll before reloading.
      {
        const oldGeneration = generation;
        const oldPanel = await openCurrentEditor(oldGeneration);
        const storedExcluded = Services.prefs.getStringPref(EXCLUDED_PREF, "[]");
        const mark = beginHeldTargetFrames();
        const activeFilter = await waitFor(
          "the active editor filter",
          () => oldPanel.querySelector('[role="tab"][aria-selected="true"]'),
        );
        activeFilter.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
        );
        await waitForHeldTargetFrames("the editor filter-focus frame", mark, 1);
        const actionToggle = await waitFor(
          "an action in the filtered editor",
          () => oldPanel.querySelector(".sidebar-menu-editor-action-toggle"),
        );
        actionToggle.click();
        const frames = await waitForHeldTargetFrames(
          "the replacement editor action-focus frame",
          mark,
          2,
        );
        Services.prefs.setStringPref(EXCLUDED_PREF, storedExcluded);
        const focusSpies = [...oldPanel.querySelectorAll("button, input")].map(node =>
          spyMethod(node, "focus")
        );
        const scrollSpies = [
          ...oldPanel.querySelectorAll(".sidebar-menu-editor-action"),
        ].map(node => spyMethod(node, "scrollIntoView"));
        const detachedWork = observeDetachedWork(oldPanel);
        check(
          "editor replaces queued post-render focus",
          frames[0]?.canceledByTarget === true &&
            frames[0]?.pending === false &&
            frames[1]?.pending === true,
          JSON.stringify(frames.map(record => ({
            canceledByTarget: record.canceledByTarget,
            pending: record.pending,
          }))),
        );
        generation = await reloadGeneration(
          "editor-focus generation to unload and reload",
          oldGeneration.customize,
        );
        await flushMutationDelivery();
        detachedWork.reset();
        check(
          "editor teardown cancels queued post-render focus",
          frames[1]?.canceledByTarget === true && frames[1]?.pending === false,
          JSON.stringify({
            canceledByTarget: frames[1]?.canceledByTarget,
            pending: frames[1]?.pending,
          }),
        );
        const activeBeforeDelivery = document.activeElement;
        const errors = frames.map(forceStaleFrame).filter(Boolean);
        c02ForcedErrors.push(...errors);
        await flushNativeFrame();
        await flushMutationDelivery();
        const focusCalls = focusSpies.reduce((sum, spy) => sum + spy.calls, 0);
        const scrollCalls = scrollSpies.reduce((sum, spy) => sum + spy.calls, 0);
        const staleMutations = detachedWork.read();
        check(
          "stale editor focus delivery does no work",
          focusSpies.some(spy => spy.installed) &&
            scrollSpies.some(spy => spy.installed) &&
            focusCalls === 0 &&
            scrollCalls === 0 &&
            staleMutations === 0 &&
            document.activeElement === activeBeforeDelivery &&
            errors.length === 0 &&
            targetFramesSince(mark).every(record => !record.pending),
          JSON.stringify({
            focusCalls,
            scrollCalls,
            staleMutations,
            errors,
            pendingTargets: targetFramesSince(mark).filter(record => record.pending).length,
          }),
        );
        finishHeldTargetFrames(mark);
        detachedWork.disconnect();
        for (const spy of [...focusSpies, ...scrollSpies]) spy.restore();
      }

      // Source 3: allow only the menu's editor-open frame through. The real panel
      // popupshown event then queues its search-focus frame behind the gate.
      {
        const oldGeneration = generation;
        const oldPanel = oldGeneration.panel;
        const searchInput = oldPanel.querySelector(".zen-editor-search");
        const searchFocusSpy = spyMethod(searchInput, "focus");
        const detachedWork = observeDetachedWork(oldPanel);
        const mark = beginHeldTargetFrames(1);
        const shown = waitForEvent(oldPanel, "popupshown");
        oldGeneration.customize.dispatchEvent(new Event("command", { bubbles: true }));
        await shown;
        let frames = await waitForHeldTargetFrames(
          "the real popupshown search-focus frame",
          mark,
          1,
        );
        oldPanel.dispatchEvent(new Event("popupshown"));
        frames = await waitForHeldTargetFrames(
          "the replacement popupshown search-focus frame",
          mark,
          2,
        );
        check(
          "panel replaces queued shown focus",
          frames[0]?.canceledByTarget === true &&
            frames[0]?.pending === false &&
            frames[1]?.pending === true,
          JSON.stringify(frames.map(record => ({
            canceledByTarget: record.canceledByTarget,
            pending: record.pending,
          }))),
        );
        generation = await reloadGeneration(
          "shown-focus generation to unload and reload",
          oldGeneration.customize,
        );
        await flushMutationDelivery();
        detachedWork.reset();
        check(
          "panel teardown cancels queued shown focus",
          frames[1]?.canceledByTarget === true && frames[1]?.pending === false,
          JSON.stringify({
            canceledByTarget: frames[1]?.canceledByTarget,
            pending: frames[1]?.pending,
          }),
        );
        const activeBeforeDelivery = document.activeElement;
        const errors = frames.map(forceStaleFrame).filter(Boolean);
        c02ForcedErrors.push(...errors);
        await flushNativeFrame();
        await flushMutationDelivery();
        const staleMutations = detachedWork.read();
        check(
          "stale shown focus delivery does no work",
          searchFocusSpy.installed &&
            searchFocusSpy.calls === 0 &&
            staleMutations === 0 &&
            document.activeElement === activeBeforeDelivery &&
            errors.length === 0 &&
            targetFramesSince(mark).every(record => !record.pending),
          JSON.stringify({
            focusCalls: searchFocusSpy.calls,
            staleMutations,
            errors,
            pendingTargets: targetFramesSince(mark).filter(record => record.pending).length,
          }),
        );
        finishHeldTargetFrames(mark);
        detachedWork.disconnect();
        searchFocusSpy.restore();
      }

      // Source 4: close, retain the opener-focus frame, then reopen before delivery.
      // Reopening must replace that frame; a second close queues the survivor that
      // exact Sine teardown must cancel.
      {
        const oldGeneration = generation;
        const expectedOpener =
          window.TabContextMenu?.contextTab ??
          document.getElementById("tabbrowser-tabs") ??
          document.documentElement;
        const oldPanel = await openCurrentEditor(oldGeneration);
        const detachedWork = observeDetachedWork(oldPanel);
        const mark = beginHeldTargetFrames();
        const hidden = waitForEvent(oldPanel, "popuphidden");
        const doneButton = await waitFor(
          "the editor Done button",
          () => oldPanel.querySelector(".sidebar-menu-editor-button-primary"),
        );
        doneButton.click();
        await hidden;
        const [firstOpenerFrame] = await waitForHeldTargetFrames(
          "the first popuphidden opener-focus frame",
          mark,
          1,
        );

        tracker.frameGate.passTargetFrames = 1;
        const reopened = waitForEvent(oldPanel, "popupshown");
        oldGeneration.customize.dispatchEvent(new Event("command", { bubbles: true }));
        await reopened;
        let heldFrames = await waitForHeldTargetFrames(
          "the reopened panel search-focus frame",
          mark,
          2,
        );
        const reopenedSearchFrame = heldFrames[1];
        check(
          "panel replaces queued hidden focus",
          firstOpenerFrame?.canceledByTarget === true &&
            firstOpenerFrame?.pending === false &&
            reopenedSearchFrame?.pending === true &&
            oldPanel.state === "open",
          JSON.stringify({
            firstCanceledByTarget: firstOpenerFrame?.canceledByTarget,
            firstPending: firstOpenerFrame?.pending,
            searchPending: reopenedSearchFrame?.pending,
            panelState: oldPanel.state,
          }),
        );

        const hiddenAgain = waitForEvent(oldPanel, "popuphidden");
        doneButton.click();
        await hiddenAgain;
        heldFrames = await waitForHeldTargetFrames(
          "the replacement popuphidden opener-focus frame",
          mark,
          3,
        );
        const survivingOpenerFrame = heldFrames[2];
        const staleGeneration = window.zenSidebarContextMenuCustomizer;
        await disableGeneration("hidden-focus generation to disable");
        await flushMutationDelivery();
        detachedWork.reset();
        check(
          "panel teardown cancels queued hidden focus",
          survivingOpenerFrame?.canceledByTarget === true &&
            survivingOpenerFrame?.pending === false,
          JSON.stringify({
            canceledByTarget: survivingOpenerFrame?.canceledByTarget,
            pending: survivingOpenerFrame?.pending,
          }),
        );

        const focusReset = document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "button",
        );
        focusReset.tabIndex = -1;
        focusReset.textContent = "focus reset";
        document.documentElement.append(focusReset);
        focusReset.focus();
        const resetReceivedFocus = document.activeElement === focusReset;
        focusReset.remove();
        const neutralFocus =
          document.activeElement === document.documentElement ||
          document.activeElement === document.body;
        const openerFocusSpy = spyMethod(expectedOpener, "focus");
        const searchFocusSpy = spyMethod(
          oldPanel.querySelector(".zen-editor-search"),
          "focus",
        );
        const activeBeforeDelivery = document.activeElement;
        const errors = heldFrames.map(forceStaleFrame).filter(Boolean);
        c02ForcedErrors.push(...errors);
        await flushNativeFrame();
        await flushMutationDelivery();
        const staleMutations = detachedWork.read();
        check(
          "stale hidden focus delivery does no work",
          resetReceivedFocus &&
            neutralFocus &&
            openerFocusSpy.installed &&
            openerFocusSpy.calls === 0 &&
            searchFocusSpy.installed &&
            searchFocusSpy.calls === 0 &&
            staleMutations === 0 &&
            document.activeElement === activeBeforeDelivery &&
            errors.length === 0 &&
            targetFramesSince(mark).every(record => !record.pending),
          JSON.stringify({
            resetReceivedFocus,
            neutralFocus,
            openerFocusCalls: openerFocusSpy.calls,
            searchFocusCalls: searchFocusSpy.calls,
            staleMutations,
            errors,
            pendingTargets: targetFramesSince(mark).filter(record => record.pending).length,
          }),
        );
        finishHeldTargetFrames(mark);
        detachedWork.disconnect();
        openerFocusSpy.restore();
        searchFocusSpy.restore();

        const repeatErrors = [];
        const repeatResults = [];
        for (let index = 0; index < 2; index += 1) {
          try {
            repeatResults.push(staleGeneration?.stop("manual"));
          } catch (repeatError) {
            repeatErrors.push(String(repeatError?.stack || repeatError));
          }
        }
        await flushMutationDelivery();
        const repeatedLeaks = leakCounts(leaks());
        check(
          "repeated stale generation stop is harmless",
          Boolean(staleGeneration) &&
            repeatErrors.length === 0 &&
            repeatResults.every(result => result === false) &&
            Object.values(repeatedLeaks).every(count => count === 0) &&
            window.zenSidebarContextMenuCustomizer === undefined,
          JSON.stringify({ repeatErrors, repeatResults, repeatedLeaks }),
        );

        generation = await enableGeneration(
          "the clean C02 generation to re-enable",
          oldGeneration.customize,
        );
        await openRealMenu();
        const reenabledPresentation =
          ordinary.parentElement?.id === MORE_POPUP_ID && submenu.parentElement?.id === MORE_POPUP_ID;
        await closeRealMenu();
        const reenabledRestoration = ordinary.parentElement === menu && submenu.parentElement === menu;
        const reenabledPanel = await openCurrentEditor(generation);
        const reenabledPanelOpened =
          reenabledPanel.parentElement === popupSet && reenabledPanel.state === "open";
        await closeCurrentEditor(reenabledPanel);
        check(
          "exact Sine re-enable installs one working generation",
          document.querySelectorAll("#" + CSS.escape(CUSTOMIZE_ID)).length === 1 &&
            document.querySelectorAll("#" + CSS.escape(PANEL_ID)).length === 1 &&
            window.zenSidebarContextMenuCustomizer?.isLive?.() === true &&
            reenabledPresentation &&
            reenabledRestoration &&
            reenabledPanelOpened,
          JSON.stringify({
            customizeCount: document.querySelectorAll("#" + CSS.escape(CUSTOMIZE_ID)).length,
            panelCount: document.querySelectorAll("#" + CSS.escape(PANEL_ID)).length,
            generationLive: window.zenSidebarContextMenuCustomizer?.isLive?.(),
            reenabledPresentation,
            reenabledRestoration,
            reenabledPanelOpened,
          }),
        );
        await disableGeneration("the clean C02 generation to disable again");
        await flushNativeFrame();
        await flushMutationDelivery();
      }

      const c02Leaks = leakCounts(leaks());
      check(
        "post-C02 teardown releases every tracked resource",
        Object.values(c02Leaks).every(count => count === 0) &&
          window.zenSidebarContextMenuCustomizer === undefined,
        JSON.stringify(c02Leaks),
      );
      const c02RuntimeErrors = runtimeErrors.slice(c02RuntimeErrorStart);
      check(
        "C02 lifecycle produces no unhandled mod errors",
        c02RuntimeErrors.length === 0 && c02ForcedErrors.length === 0,
        [...c02RuntimeErrors, ...c02ForcedErrors].join(" | "),
      );
    }

    menu.removeEventListener("popupshowing", preModShowing);
    menu.removeEventListener("popupshowing", postModShowing);
    document.removeEventListener("popupshowing", documentShowing);
    window.removeEventListener("popupshowing", windowShowing);
    separatorBefore.remove();
    selected.remove();
    ordinary.remove();
    browserHidden.remove();
    submenu.remove();
    separatorAfter.remove();
    check(
      "harness removes every fixture from the real menu",
      sameIdentityOrder(untouchedBrowserRoot, [...menu.children]),
      "the final real-menu child array matches its pre-fixture array",
    );
    window.removeEventListener("error", onRuntimeError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
    EventTarget.prototype.addEventListener = native.add;
    EventTarget.prototype.removeEventListener = native.remove;
    window.MutationObserver = native.MutationObserver;
    window.requestAnimationFrame = native.requestAnimationFrame;
    window.cancelAnimationFrame = native.cancelAnimationFrame;
    console.info = native.consoleInfo;

    done(report);
  })().catch(error => {
    report.fatal = String(error) + "\\n" + String(error?.stack || "");
    done(report);
  });
`;

const atomicWriteJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
};

const sha256 = contents => createHash("sha256").update(contents).digest("hex");
const git = arguments_ =>
  execFileSync("git", arguments_, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  }).trim();

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const bundle = await readFile(BUNDLE);
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  const zen = await launchLiveZen({
    headless: !options.headed,
    stagedMod: {
      enabled: false,
      manifest,
      relativePaths: ["dist", "styles"],
      sourceDirectory: MOD_DIRECTORY,
    },
  });
  let client;
  try {
    client = await openMarionette({ port: zen.port });
    await client.setScriptTimeout(options.headed ? 180_000 : 120_000);
    if (options.headed) zen.activate();
    const result = await client.executeAsync(PROBE, [
      {
        ...options,
        buildId: zen.platformStamp.zen.buildId,
        geckoVersion: zen.platformStamp.zen.geckoVersion,
        sineVersion: zen.platformStamp.sine.version,
        zenVersion: zen.platformStamp.zen.version,
      },
    ]);
    validateProbeResult(result, options);
    const stampValidation = validatePlatformStamp(zen.platformStamp);
    if (!stampValidation.ok) {
      throw new Error(
        `invalid platform stamp: ${JSON.stringify(stampValidation.errors)}`,
      );
    }
    const verdicts = collectVerdicts(result?.assertions ?? []);
    const timingSummaries = Object.fromEntries(
      Object.entries(result?.samples ?? {}).map(([name, samples]) => [
        name,
        summarizeTimings(samples),
      ]),
    );
    const artifact = {
      recordedAt: new Date().toISOString(),
      source: {
        commit: git(["rev-parse", "HEAD"]),
        status: git(["status", "--porcelain=v1"]),
      },
      bundle: { bytes: bundle.length, sha256: sha256(bundle) },
      stamp: zen.platformStamp,
      marionette: client.hello,
      runner: {
        options,
        node: process.version,
        v8: process.versions.v8,
        os: { platform: platform(), release: release(), arch: arch() },
      },
      result: { ...result, timingSummaries, verdicts },
    };
    const output = outputPath(options);
    await atomicWriteJson(output, artifact);

    console.log(
      `Zen ${result?.platform?.zenVersion ?? "?"} / Sine ${result?.platform?.sineVersion ?? "?"}`,
    );
    for (const assertion of result?.assertions ?? []) {
      console.log(`  ${assertion.ok ? "PASS" : "FAIL"}  ${assertion.name}`);
      if (!assertion.ok) console.log(`        ${assertion.detail}`);
    }
    if (result?.fatal) {
      console.error(result.fatal);
    }
    console.log(`Raw lifecycle evidence: ${output}`);
    console.log(`${verdicts.counts.passed}/${verdicts.counts.total} assertions passed`);
    if (result?.fatal || !verdicts.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`live-XUL harness failed: ${error.stack ?? error.message}`);
    console.error(zen.output.join("").slice(-4000));
    process.exitCode = 1;
  } finally {
    try {
      await client?.quit();
    } finally {
      await zen.stop();
    }
  }
};

await main();
