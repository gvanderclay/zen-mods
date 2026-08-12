#!/usr/bin/env node

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
const MANIFEST_PATH = resolve(MOD_DIRECTORY, "theme.json");
const OUTPUT = resolve(REPOSITORY_ROOT, ".benchmarks/live/load-bar-pane-seam.smoke.json");
const PRODUCTION_PATHS = [
  "dist/load-bar.uc.mjs",
  "preferences.json",
  "styles/chrome.css",
];

const REQUIRED_ASSERTIONS = [
  "exact stamped platform exposes pane managers",
  "split manager reports the exact two visible browsers",
  "split lifecycle events agree with the manager inventory",
  "Glance replaces only its parent inside an active split",
  "ordinary selection excludes background browsers",
  "Glance selection resolves the exact overlay browser",
  "Glance lifecycle restores the ordinary parent browser",
];

const PROBE = `
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const report = {
    assertions: [],
    fatal: null,
    glance: null,
    platform: null,
    split: null,
  };
  const check = (name, condition, detail) => {
    report.assertions.push({ name, ok: Boolean(condition), detail: String(detail ?? "") });
  };
  const waitFor = async (name, read, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    let value;
    while (Date.now() < deadline) {
      value = read();
      if (value) return value;
      await wait(20);
    }
    throw new Error("timed out waiting for " + name + "; last value: " + String(value));
  };
  const systemPrincipal = Services.scriptSecurityManager.getSystemPrincipal();
  const addTab = () => gBrowser.addTab("about:blank", {
    inBackground: true,
    skipAnimation: true,
    skipRoute: true,
    triggeringPrincipal: systemPrincipal,
  });
  const containerFor = browser => browser?.closest?.(".browserSidebarContainer") ?? null;
  const browserFacts = browser => {
    const container = containerFor(browser);
    return {
      connected: browser?.isConnected === true,
      containerClass: container?.getAttribute("class") ?? null,
      containerId: container?.id ?? null,
      deckSelected: container?.classList.contains("deck-selected") ?? false,
      height: container?.getBoundingClientRect().height ?? 0,
      isSelected: gBrowser.selectedBrowser === browser,
      zenGlanceOverlay: container?.classList.contains("zen-glance-overlay") ?? false,
      zenSplit: container?.getAttribute("zen-split") ?? null,
      width: container?.getBoundingClientRect().width ?? 0,
    };
  };

  (async () => {
    const tabs = [];
    const listeners = [];
    const listen = (name, target = window) => {
      const callback = event => listeners.push({ name, target: event.target?.localName ?? null });
      target.addEventListener(name, callback);
      return () => target.removeEventListener(name, callback);
    };
    const removers = [
      listen("ZenViewSplitter:SplitViewActivated"),
      listen("ZenViewSplitter:SplitViewDeactivated"),
      listen("ZenSplitViewTabsSplit"),
      listen("ZenTabRemovedFromSplit"),
      listen("GlanceOpen"),
      listen("GlanceClose"),
      listen("TabSelect"),
    ];
    const priorTesting = window.gZenUIManager?.testingEnabled;
    try {
      report.platform = {
        buildId: Services.appinfo.appBuildID,
        geckoVersion: Services.appinfo.platformVersion,
        hasGlanceManager: typeof window.gZenGlanceManager?.openGlance === "function",
        hasSplitManager: Array.isArray(window.gZenViewSplitter?.splitViewBrowsers),
        sineVersion: options.sineVersion,
        zenVersion: Services.appinfo.version,
      };
      check(
        "exact stamped platform exposes pane managers",
        report.platform.zenVersion === options.zenVersion &&
          report.platform.buildId === options.buildId &&
          report.platform.geckoVersion === options.geckoVersion &&
          report.platform.hasGlanceManager && report.platform.hasSplitManager,
        JSON.stringify(report.platform),
      );

      const first = addTab();
      const second = addTab();
      const background = addTab();
      tabs.push(first, second, background);
      gBrowser.selectedTab = first;
      await waitFor("first tab selection", () => gBrowser.selectedTab === first);

      const splitData = window.gZenViewSplitter.splitTabs([first, second], "vsep");
      await waitFor("active split inventory", () =>
        splitData && window.gZenViewSplitter.splitViewBrowsers.length === 2
      );
      const splitBrowsers = [...window.gZenViewSplitter.splitViewBrowsers];
      const expectedSplitBrowsers = [first.linkedBrowser, second.linkedBrowser];
      const splitFacts = splitBrowsers.map(browserFacts);
      const splitEvents = listeners.filter(entry => entry.name.startsWith("Zen"));
      report.split = {
        active: window.gZenViewSplitter.splitViewActive,
        exactBrowsers:
          splitBrowsers.length === 2 &&
          expectedSplitBrowsers.every(browser => splitBrowsers.includes(browser)),
        facts: splitFacts,
        events: splitEvents,
        selectedIncluded: splitBrowsers.includes(gBrowser.selectedBrowser),
      };
      check(
        "split manager reports the exact two visible browsers",
        report.split.active && report.split.exactBrowsers && report.split.selectedIncluded &&
          splitFacts.every(fact => fact.connected && fact.zenSplit === "true" &&
            fact.width > 0 && fact.height > 0),
        JSON.stringify(report.split),
      );
      check(
        "split lifecycle events agree with the manager inventory",
        splitEvents.some(entry => entry.name === "ZenSplitViewTabsSplit") &&
          splitEvents.some(entry => entry.name === "ZenViewSplitter:SplitViewActivated"),
        JSON.stringify(splitEvents),
      );

      if (window.gZenUIManager) {
        window.gZenUIManager.testingEnabled = true;
      }
      const splitParent = gBrowser.selectedTab;
      const splitGlanceOpenCount = listeners.filter(entry => entry.name === "GlanceOpen").length;
      const splitGlanceCloseCount = listeners.filter(entry => entry.name === "GlanceClose").length;
      const splitGlanceTab = await window.gZenGlanceManager.openGlance({
        clientX: 0,
        clientY: 0,
        height: 0,
        triggeringPrincipal: systemPrincipal,
        url: "about:blank",
        width: 0,
      });
      await waitFor("split Glance open event", () =>
        splitGlanceTab &&
          listeners.filter(entry => entry.name === "GlanceOpen").length > splitGlanceOpenCount
      );
      const splitGlanceBrowser = splitGlanceTab.linkedBrowser;
      const splitGlanceInventory = [...window.gZenViewSplitter.splitViewBrowsers];
      report.split.glance = {
        active: window.gZenViewSplitter.splitViewActive,
        overlayFacts: browserFacts(splitGlanceBrowser),
        parentBackground: containerFor(splitParent.linkedBrowser)?.classList.contains(
          "zen-glance-background",
        ) ?? false,
        parentInSplit: splitGlanceInventory.includes(splitParent.linkedBrowser),
        selectedIsOverlay: gBrowser.selectedBrowser === splitGlanceBrowser,
        siblingInSplit: splitGlanceInventory.some(
          browser => browser !== splitParent.linkedBrowser,
        ),
        splitIncludesOverlay: splitGlanceInventory.includes(splitGlanceBrowser),
      };
      check(
        "Glance replaces only its parent inside an active split",
        report.split.glance.active && report.split.glance.parentInSplit &&
          report.split.glance.siblingInSplit && !report.split.glance.splitIncludesOverlay &&
          report.split.glance.selectedIsOverlay && report.split.glance.parentBackground &&
          report.split.glance.overlayFacts.zenGlanceOverlay,
        JSON.stringify(report.split.glance),
      );
      await window.gZenGlanceManager.closeGlance({ skipPermitUnload: true });
      await waitFor("split Glance close event", () =>
        listeners.filter(entry => entry.name === "GlanceClose").length > splitGlanceCloseCount &&
          gBrowser.selectedBrowser === splitParent.linkedBrowser &&
          window.gZenViewSplitter.splitViewBrowsers.length === 2
      );

      gBrowser.selectedTab = background;
      await waitFor("split deactivation", () =>
        !window.gZenViewSplitter.splitViewActive &&
          window.gZenViewSplitter.splitViewBrowsers.length === 0 &&
          gBrowser.selectedBrowser === background.linkedBrowser
      );
      const backgroundFacts = browserFacts(background.linkedBrowser);
      const ordinaryEvents = listeners.filter(entry => entry.name.startsWith("Zen"));
      report.split.ordinary = {
        backgroundFacts,
        events: ordinaryEvents,
        splitCount: window.gZenViewSplitter.splitViewBrowsers.length,
      };
      check(
        "ordinary selection excludes background browsers",
        report.split.ordinary.splitCount === 0 && backgroundFacts.isSelected &&
          ordinaryEvents.some(entry => entry.name === "ZenViewSplitter:SplitViewDeactivated"),
        JSON.stringify(report.split.ordinary),
      );

      const glanceOpenCount = listeners.filter(entry => entry.name === "GlanceOpen").length;
      const glanceCloseCount = listeners.filter(entry => entry.name === "GlanceClose").length;
      const glanceTab = await window.gZenGlanceManager.openGlance({
        clientX: 0,
        clientY: 0,
        height: 0,
        triggeringPrincipal: systemPrincipal,
        url: "about:blank",
        width: 0,
      });
      await waitFor("Glance open event", () =>
        glanceTab && listeners.filter(entry => entry.name === "GlanceOpen").length > glanceOpenCount
      );
      const glanceBrowser = glanceTab.linkedBrowser;
      const overlayFacts = browserFacts(glanceBrowser);
      const parentFacts = browserFacts(background.linkedBrowser);
      report.glance = {
        childMatchesManager:
          window.gZenGlanceManager.getTabOrGlanceChild(background) === glanceTab,
        events: [...listeners],
        overlayFacts,
        parentBackground: containerFor(background.linkedBrowser)?.classList.contains(
          "zen-glance-background",
        ) ?? false,
        parentFacts,
        selectedBrowserMatches: gBrowser.selectedBrowser === glanceBrowser,
      };
      check(
        "Glance selection resolves the exact overlay browser",
        report.glance.childMatchesManager && report.glance.selectedBrowserMatches &&
          overlayFacts.connected && overlayFacts.zenGlanceOverlay &&
          report.glance.parentBackground && !parentFacts.isSelected,
        JSON.stringify(report.glance),
      );

      await window.gZenGlanceManager.closeGlance({ skipPermitUnload: true });
      await waitFor("Glance close event", () =>
        listeners.filter(entry => entry.name === "GlanceClose").length > glanceCloseCount &&
          gBrowser.selectedBrowser === background.linkedBrowser &&
          !containerFor(background.linkedBrowser)?.classList.contains("zen-glance-background")
      );
      report.glance.afterClose = {
        childConnected: glanceBrowser.isConnected,
        events: [...listeners],
        parentFacts: browserFacts(background.linkedBrowser),
      };
      check(
        "Glance lifecycle restores the ordinary parent browser",
        !report.glance.afterClose.childConnected &&
          report.glance.afterClose.parentFacts.isSelected &&
          report.glance.afterClose.events.some(entry => entry.name === "GlanceClose"),
        JSON.stringify(report.glance.afterClose),
      );
    } catch (error) {
      report.fatal = String(error?.stack ?? error);
    } finally {
      for (const remove of removers.reverse()) {
        try { remove(); } catch {}
      }
      if (window.gZenUIManager) {
        window.gZenUIManager.testingEnabled = priorTesting;
      }
      try {
        window.gZenGlanceManager.closeGlance({
          noAnimation: true,
          onTabClose: true,
          skipPermitUnload: true,
        });
      } catch {}
      try {
        if (window.gZenViewSplitter.splitViewActive) {
          window.gZenViewSplitter.unsplitCurrentView();
        }
      } catch {}
      for (const tab of tabs.reverse()) {
        try {
          if (tab?.isConnected) gBrowser.removeTab(tab, { animate: false });
        } catch {}
      }
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
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
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
  const removeSignals = installShutdownSignals({
    label: "Load Bar pane seam",
    shutdown,
  });

  try {
    client = await openMarionette({ port: zen.port });
    await client.setScriptTimeout(120_000);
    const result = await client.executeAsync(PROBE, [
      {
        buildId: zen.platformStamp.zen.buildId,
        geckoVersion: zen.platformStamp.zen.geckoVersion,
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
      contract: { requiredAssertions: REQUIRED_ASSERTIONS },
      marionette: client.hello,
      recordedAt: new Date().toISOString(),
      result,
      runner: {
        node: process.version,
        os: { arch: arch(), platform: platform(), release: release() },
        v8: process.versions.v8,
      },
      stagedProduction: zen.stagedMod,
      stamp: zen.platformStamp,
      validation: { error: validationError, verdicts },
    };
    await atomicWriteJson(OUTPUT, artifact);
    for (const assertion of result?.assertions ?? []) {
      console.log(`  ${assertion.ok ? "PASS" : "FAIL"}  ${assertion.name}`);
      if (!assertion.ok) console.log(`        ${assertion.detail}`);
    }
    console.log(`Raw Load Bar pane evidence: ${OUTPUT}`);
    if (validationError) {
      console.error(validationError);
      process.exitCode = 1;
    } else {
      console.log(`${verdicts.counts.passed}/${verdicts.counts.total} assertions passed`);
      if (!verdicts.ok || result?.fatal) process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Load Bar pane-seam probe failed: ${error.stack ?? error.message}`);
    console.error(zen.output.join("").slice(-4000));
    process.exitCode = 1;
  } finally {
    try {
      await shutdown();
    } finally {
      removeSignals();
    }
  }
};

await main();
