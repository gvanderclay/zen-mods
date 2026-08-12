#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
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
const OUTPUT = resolve(
  REPOSITORY_ROOT,
  ".benchmarks/live/load-bar-visible-panes.smoke.json",
);
const PRODUCTION_PATHS = [
  "dist/load-bar.uc.mjs",
  "preferences.json",
  "styles/chrome.css",
];

const REQUIRED_ASSERTIONS = [
  "exact production generation starts idle",
  "two split browsers own two independent activity lines",
  "Glance replaces only its loading split parent line",
  "closing Glance restores the held parent line",
  "split responses finish independently without duplicate lines",
  "background load stays hidden and follows exact tab selection",
  "DOM fullscreen contract hides and restores the exact pane line",
  "secondary window owns an independent generation and line",
  "native secondary-window close drains only its generation",
  "native loading preference remains unchanged",
  "final Sine disable restores native ownership and drains the primary generation",
];

const PROBE = `
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  const OWNER_ATTRIBUTE = "data-zen-load-bar-owner";
  const NATIVE_ID = "zen-loading-progress-bar";
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const report = {
    assertions: [],
    background: null,
    disable: null,
    fatal: null,
    fullscreen: null,
    glance: null,
    platform: null,
    preference: null,
    secondary: null,
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
  const controllerReady = target =>
    target.zenLoadBar?.controller?.isLive?.() === true &&
    target.zenLoadBar.controller.snapshot().started === true &&
    target.document.documentElement.getAttribute(OWNER_ATTRIBUTE) ===
      target.zenLoadBar.generationToken;
  const lineFor = browser =>
    browser?.closest?.(".browserContainer")?.querySelector(":scope > .zen-load-bar") ?? null;
  const linesFor = target => [...target.document.querySelectorAll(".zen-load-bar")];
  const lineFacts = browser => {
    const line = lineFor(browser);
    return {
      connected: line?.isConnected ?? false,
      count: browser?.closest?.(".browserContainer")?.querySelectorAll(
        ":scope > .zen-load-bar",
      ).length ?? 0,
      display: line ? getComputedStyle(line).display : null,
      outcome: line?.getAttribute("data-zen-load-bar-outcome") ?? null,
      state: line?.getAttribute("data-zen-load-bar-state") ?? null,
    };
  };
  const load = (browser, url) => {
    const uri = Services.io.newURI(url);
    browser.loadURI(uri, {
      triggeringPrincipal: Services.scriptSecurityManager.createContentPrincipal(uri, {}),
    });
  };
  const addTab = (target, path, inBackground = true) => {
    const url = options.serverBaseUrl + path;
    const uri = Services.io.newURI(url);
    return target.gBrowser.addTab(url, {
      inBackground,
      skipAnimation: true,
      skipRoute: true,
      triggeringPrincipal: Services.scriptSecurityManager.createContentPrincipal(uri, {}),
    });
  };
  const releaseFixture = async id => {
    const response = await fetch(options.serverBaseUrl + "/release/" + id, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("fixture release failed for " + id);
  };
  const waitVisible = (name, browser) =>
    waitFor(name, () => lineFacts(browser).state === "visible");
  const waitRemoved = (name, browser) =>
    waitFor(name, () => lineFacts(browser).count === 0);
  const removeTab = tab => {
    if (tab?.isConnected) gBrowser.removeTab(tab, { animate: false });
  };

  (async () => {
    let manager;
    let sineUtils;
    let enabled = true;
    const tabs = [];
    const priorTesting = window.gZenUIManager?.testingEnabled;
    const root = document.documentElement;
    const priorFullscreen = root.getAttribute("inDOMFullscreen");
    try {
      manager = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/manager.sys.mjs",
      ).default;
      sineUtils = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/utils.sys.mjs",
      ).default;
      await waitFor("primary production controller", () =>
        controllerReady(window) && window.zenLoadBar.controller.snapshot().activeRecords === 0
      );
      report.platform = {
        buildId: Services.appinfo.appBuildID,
        geckoVersion: Services.appinfo.platformVersion,
        sineVersion: options.sineVersion,
        zenVersion: Services.appinfo.version,
      };
      report.preference = {
        before: {
          hadUserValue: Services.prefs.prefHasUserValue(options.nativePreference),
          value: Services.prefs.getBoolPref(options.nativePreference, true),
        },
      };
      const initial = {
        controller: window.zenLoadBar.controller.snapshot(),
        marker: root.getAttribute(OWNER_ATTRIBUTE),
        totalLines: linesFor(window).length,
      };
      check(
        "exact production generation starts idle",
        report.platform.zenVersion === options.zenVersion &&
          report.platform.buildId === options.buildId &&
          report.platform.geckoVersion === options.geckoVersion &&
          initial.controller.live && initial.controller.activeRecords === 0 &&
          initial.totalLines === 0 && initial.marker === window.zenLoadBar.generationToken,
        JSON.stringify({ initial, platform: report.platform }),
      );

      const left = addTab(window, "/hold/left");
      const right = addTab(window, "/hold/right");
      tabs.push(left, right);
      await waitFor("split fixture loads", () =>
        left.hasAttribute("busy") && right.hasAttribute("busy")
      );
      gBrowser.selectedTab = left;
      const splitData = window.gZenViewSplitter.splitTabs([left, right], "vsep");
      await waitFor("two visible split lines", () =>
        splitData && window.gZenViewSplitter.splitViewBrowsers.length === 2 &&
          lineFacts(left.linkedBrowser).state === "visible" &&
          lineFacts(right.linkedBrowser).state === "visible"
      );
      report.split = {
        controller: window.zenLoadBar.controller.snapshot(),
        left: lineFacts(left.linkedBrowser),
        right: lineFacts(right.linkedBrowser),
        splitCount: window.gZenViewSplitter.splitViewBrowsers.length,
        totalLines: linesFor(window).length,
      };
      check(
        "two split browsers own two independent activity lines",
        report.split.splitCount === 2 && report.split.totalLines === 2 &&
          report.split.left.count === 1 && report.split.right.count === 1 &&
          report.split.controller.activeRecords === 2 &&
          report.split.controller.visibleRecords === 2,
        JSON.stringify(report.split),
      );

      if (window.gZenUIManager) window.gZenUIManager.testingEnabled = true;
      const splitParent = gBrowser.selectedTab;
      const glanceTab = await window.gZenGlanceManager.openGlance({
        clientX: 0,
        clientY: 0,
        height: 0,
        triggeringPrincipal: systemPrincipal,
        url: options.serverBaseUrl + "/hold/glance",
        width: 0,
      });
      if (!glanceTab) throw new Error("Glance did not create a tab");
      const glanceBrowser = glanceTab.linkedBrowser;
      await waitFor("Glance overlay line", () =>
        glanceTab.hasAttribute("busy") && lineFacts(glanceBrowser).state === "visible" &&
          lineFacts(splitParent.linkedBrowser).count === 0 &&
          lineFacts(right.linkedBrowser).state === "visible"
      );
      report.glance = {
        controller: window.zenLoadBar.controller.snapshot(),
        overlay: lineFacts(glanceBrowser),
        parent: lineFacts(splitParent.linkedBrowser),
        sibling: lineFacts(right.linkedBrowser),
        totalLines: linesFor(window).length,
      };
      check(
        "Glance replaces only its loading split parent line",
        report.glance.overlay.count === 1 && report.glance.parent.count === 0 &&
          report.glance.sibling.count === 1 && report.glance.totalLines === 2 &&
          report.glance.controller.activeRecords === 3 &&
          report.glance.controller.visibleRecords === 2,
        JSON.stringify(report.glance),
      );

      await releaseFixture("glance");
      await waitFor("Glance response complete", () => !glanceTab.hasAttribute("busy"));
      await waitRemoved("Glance terminal line", glanceBrowser);
      await window.gZenGlanceManager.closeGlance({ skipPermitUnload: true });
      await waitFor("split parent line restored", () =>
        gBrowser.selectedTab === splitParent &&
          lineFacts(splitParent.linkedBrowser).state === "visible"
      );
      report.glance.afterClose = {
        controller: window.zenLoadBar.controller.snapshot(),
        overlayConnected: glanceBrowser.isConnected,
        parent: lineFacts(splitParent.linkedBrowser),
        sibling: lineFacts(right.linkedBrowser),
        totalLines: linesFor(window).length,
      };
      check(
        "closing Glance restores the held parent line",
        !report.glance.afterClose.overlayConnected &&
          report.glance.afterClose.parent.count === 1 &&
          report.glance.afterClose.sibling.count === 1 &&
          report.glance.afterClose.totalLines === 2 &&
          report.glance.afterClose.controller.activeRecords === 2,
        JSON.stringify(report.glance.afterClose),
      );

      await releaseFixture("left");
      await waitFor("left response complete", () => !left.hasAttribute("busy"));
      await waitRemoved("left line removed", left.linkedBrowser);
      const afterLeft = {
        controller: window.zenLoadBar.controller.snapshot(),
        left: lineFacts(left.linkedBrowser),
        right: lineFacts(right.linkedBrowser),
        totalLines: linesFor(window).length,
      };
      await releaseFixture("right");
      await waitFor("right response complete", () => !right.hasAttribute("busy"));
      await waitRemoved("right line removed", right.linkedBrowser);
      report.split.afterResponses = {
        afterLeft,
        finalController: window.zenLoadBar.controller.snapshot(),
        finalLines: linesFor(window).length,
      };
      check(
        "split responses finish independently without duplicate lines",
        afterLeft.left.count === 0 && afterLeft.right.count === 1 &&
          afterLeft.totalLines === 1 && afterLeft.controller.activeRecords === 1 &&
          report.split.afterResponses.finalController.activeRecords === 0 &&
          report.split.afterResponses.finalLines === 0,
        JSON.stringify(report.split.afterResponses),
      );

      window.gZenViewSplitter.unsplitCurrentView();
      await waitFor("split removal", () => !window.gZenViewSplitter.splitViewActive);
      gBrowser.selectedTab = left;
      const background = addTab(window, "/hold/background");
      tabs.push(background);
      await waitFor("hidden background load tracked", () =>
        background.hasAttribute("busy") &&
          window.zenLoadBar.controller.snapshot().activeRecords === 1 &&
          window.zenLoadBar.controller.snapshot().visibleRecords === 0
      );
      const hidden = {
        controller: window.zenLoadBar.controller.snapshot(),
        line: lineFacts(background.linkedBrowser),
      };
      gBrowser.selectedTab = background;
      await waitVisible("selected background line", background.linkedBrowser);
      const selected = {
        controller: window.zenLoadBar.controller.snapshot(),
        line: lineFacts(background.linkedBrowser),
      };
      gBrowser.selectedTab = left;
      await waitRemoved("hidden background line removed", background.linkedBrowser);
      const hiddenAgain = {
        controller: window.zenLoadBar.controller.snapshot(),
        line: lineFacts(background.linkedBrowser),
      };
      await releaseFixture("background");
      await waitFor("background response drain", () =>
        !background.hasAttribute("busy") &&
          window.zenLoadBar.controller.snapshot().activeRecords === 0
      );
      report.background = { hidden, hiddenAgain, selected };
      check(
        "background load stays hidden and follows exact tab selection",
        hidden.line.count === 0 && hidden.controller.activeRecords === 1 &&
          hidden.controller.visibleRecords === 0 && selected.line.count === 1 &&
          selected.line.state === "visible" && selected.controller.visibleRecords === 1 &&
          hiddenAgain.line.count === 0 && hiddenAgain.controller.activeRecords === 1 &&
          hiddenAgain.controller.visibleRecords === 0,
        JSON.stringify(report.background),
      );

      gBrowser.selectedTab = left;
      load(left.linkedBrowser, options.serverBaseUrl + "/hold/fullscreen");
      await waitVisible("fullscreen fixture line", left.linkedBrowser);
      const beforeFullscreen = lineFacts(left.linkedBrowser);
      root.setAttribute("inDOMFullscreen", "true");
      await waitFor("fullscreen line hidden", () =>
        lineFacts(left.linkedBrowser).display === "none"
      );
      const duringFullscreen = lineFacts(left.linkedBrowser);
      root.removeAttribute("inDOMFullscreen");
      await waitFor("fullscreen line restored", () =>
        lineFacts(left.linkedBrowser).display !== "none"
      );
      const afterFullscreen = lineFacts(left.linkedBrowser);
      await releaseFixture("fullscreen");
      await waitFor("fullscreen response drain", () =>
        !left.hasAttribute("busy") && window.zenLoadBar.controller.snapshot().activeRecords === 0
      );
      report.fullscreen = { afterFullscreen, beforeFullscreen, duringFullscreen };
      check(
        "DOM fullscreen contract hides and restores the exact pane line",
        beforeFullscreen.display !== "none" && duringFullscreen.display === "none" &&
          afterFullscreen.display !== "none",
        JSON.stringify(report.fullscreen),
      );

      const secondary = OpenBrowserWindow({ private: false });
      await waitFor("secondary delayed startup", () =>
        secondary.gBrowserInit?.delayedStartupFinished === true && controllerReady(secondary)
      );
      const secondaryTab = addTab(secondary, "/hold/secondary", false);
      secondary.gBrowser.selectedTab = secondaryTab;
      const secondaryBrowser = secondaryTab.linkedBrowser;
      await waitFor("secondary line", () => {
        const secondaryLine = secondaryBrowser
          ?.closest?.(".browserContainer")
          ?.querySelector(":scope > .zen-load-bar");
        return secondaryLine?.getAttribute("data-zen-load-bar-state") === "visible";
      });
      const secondaryFacade = secondary.zenLoadBar;
      const secondaryLine = secondaryBrowser
        .closest(".browserContainer")
        .querySelector(":scope > .zen-load-bar");
      report.secondary = {
        primary: window.zenLoadBar.controller.snapshot(),
        secondary: secondaryFacade.controller.snapshot(),
        tokenChanged: secondaryFacade.generationToken !== window.zenLoadBar.generationToken,
      };
      check(
        "secondary window owns an independent generation and line",
        report.secondary.primary.live && report.secondary.secondary.live &&
          report.secondary.secondary.activeRecords === 1 &&
          report.secondary.secondary.visibleRecords === 1 &&
          report.secondary.tokenChanged && secondaryLine?.isConnected === true,
        JSON.stringify(report.secondary),
      );

      const closed = new Promise(resolve => {
        const observer = subject => {
          if (subject === secondary) {
            Services.obs.removeObserver(observer, "domwindowclosed");
            resolve(true);
          }
        };
        Services.obs.addObserver(observer, "domwindowclosed");
        setTimeout(() => {
          Services.obs.removeObserver(observer, "domwindowclosed");
          resolve(false);
        }, 15000);
      });
      secondary.document.getElementById("cmd_closeWindow").doCommand();
      const closeObserved = await closed;
      await waitFor("secondary controller drain", () =>
        secondaryFacade.controller.snapshot().live === false
      );
      report.secondary.afterClose = {
        closeObserved,
        lineConnected: secondaryLine?.isConnected ?? null,
        primary: window.zenLoadBar.controller.snapshot(),
        secondary: secondaryFacade.controller.snapshot(),
      };
      check(
        "native secondary-window close drains only its generation",
        closeObserved && !report.secondary.afterClose.lineConnected &&
          report.secondary.afterClose.secondary.stopReason === "window-unload" &&
          report.secondary.afterClose.secondary.activeRecords === 0 &&
          report.secondary.afterClose.secondary.pendingTimers === 0 &&
          report.secondary.afterClose.secondary.pendingWaits === 0 &&
          report.secondary.afterClose.primary.live,
        JSON.stringify(report.secondary.afterClose),
      );

      report.preference.afterWork = {
        hadUserValue: Services.prefs.prefHasUserValue(options.nativePreference),
        value: Services.prefs.getBoolPref(options.nativePreference, true),
      };
      check(
        "native loading preference remains unchanged",
        JSON.stringify(report.preference.before) === JSON.stringify(report.preference.afterWork),
        JSON.stringify(report.preference),
      );

      const finalFacade = window.zenLoadBar;
      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = false;
      await waitFor("final primary disable", () =>
        window.zenLoadBar === undefined && root.getAttribute(OWNER_ATTRIBUTE) === null &&
          linesFor(window).length === 0
      );
      const finalMods = await sineUtils.getMods();
      const nativeIndicator = document.getElementById(NATIVE_ID);
      report.disable = {
        enabled: finalMods[options.modId]?.enabled,
        marker: root.getAttribute(OWNER_ATTRIBUTE),
        nativeDisplay: nativeIndicator ? getComputedStyle(nativeIndicator).display : null,
        snapshot: finalFacade.controller.snapshot(),
        totalLines: linesFor(window).length,
      };
      check(
        "final Sine disable restores native ownership and drains the primary generation",
        report.disable.enabled === false && report.disable.marker === null &&
          report.disable.nativeDisplay !== "none" && report.disable.totalLines === 0 &&
          !report.disable.snapshot.live && report.disable.snapshot.stopReason === "sine-unload" &&
          report.disable.snapshot.activeRecords === 0 &&
          report.disable.snapshot.pendingTimers === 0 &&
          report.disable.snapshot.pendingWaits === 0,
        JSON.stringify(report.disable),
      );
    } catch (error) {
      report.fatal = String(error?.stack ?? error);
    } finally {
      if (priorFullscreen === null) root.removeAttribute("inDOMFullscreen");
      else root.setAttribute("inDOMFullscreen", priorFullscreen);
      if (window.gZenUIManager) window.gZenUIManager.testingEnabled = priorTesting;
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
        try { removeTab(tab); } catch {}
      }
      if (enabled && manager && sineUtils) {
        try {
          await manager.toggleTheme(await sineUtils.getMods(), options.modId);
        } catch {}
      }
    }
    done(report);
  })();
`;

const startFixtureServer = async () => {
  const held = new Map();
  const responses = new Set();
  const events = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    events.push({ at: Date.now(), path, type: "request" });
    responses.add(response);
    response.once("close", () => {
      responses.delete(response);
      events.push({ at: Date.now(), path, type: "close" });
    });
    if (path.startsWith("/hold/")) {
      const id = path.slice("/hold/".length);
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
      });
      response.write(`<title>Held ${id}</title><p>Held response ${id}</p>`);
      held.set(id, response);
      return;
    }
    if (path.startsWith("/release/")) {
      const id = path.slice("/release/".length);
      const pending = held.get(id);
      if (!pending) {
        response.writeHead(404, { "Access-Control-Allow-Origin": "*" });
        response.end("missing");
        return;
      }
      held.delete(id);
      pending.end(`<p>Released ${id}</p>`);
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      response.end("released");
      events.push({ at: Date.now(), id, type: "release" });
      return;
    }
    response.writeHead(404, { "Access-Control-Allow-Origin": "*" });
    response.end();
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("fixture server did not bind a TCP port");
  }
  let closePromise;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => {
      closePromise ??= (async () => {
        for (const response of responses) response.destroy();
        held.clear();
        await new Promise((resolveClose, reject) =>
          server.close(error => (error ? reject(error) : resolveClose())),
        );
      })();
      return closePromise;
    },
    events,
  };
};

const atomicWriteJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
};

const main = async () => {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const fixture = await startFixtureServer();
  let zen;
  try {
    zen = await launchLiveZen({
      stagedMod: {
        enabled: true,
        manifest,
        relativePaths: PRODUCTION_PATHS,
        sourceDirectory: MOD_DIRECTORY,
      },
    });
  } catch (error) {
    await fixture.close();
    throw error;
  }
  let client;
  let shutdownPromise;
  const shutdown = () => {
    shutdownPromise ??= (async () => {
      try {
        await client?.quit();
      } finally {
        try {
          await zen.stop();
        } finally {
          await fixture.close();
        }
      }
    })();
    return shutdownPromise;
  };
  const removeSignals = installShutdownSignals({
    label: "Load Bar visible panes",
    shutdown,
  });

  try {
    client = await openMarionette({ port: zen.port });
    await client.setScriptTimeout(180_000);
    const result = await client.executeAsync(PROBE, [
      {
        buildId: zen.platformStamp.zen.buildId,
        geckoVersion: zen.platformStamp.zen.geckoVersion,
        modId: manifest.id,
        nativePreference: "zen.view.enable-loading-indicator",
        serverBaseUrl: fixture.baseUrl,
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
      fixtureEvents: fixture.events,
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
    console.log(`Raw Load Bar visible-pane evidence: ${OUTPUT}`);
    if (validationError) {
      console.error(validationError);
      process.exitCode = 1;
    } else {
      console.log(`${verdicts.counts.passed}/${verdicts.counts.total} assertions passed`);
      if (!verdicts.ok || result?.fatal) process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Load Bar visible-pane probe failed: ${error.stack ?? error.message}`);
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
