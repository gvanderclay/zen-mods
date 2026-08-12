#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { arch, platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectVerdicts,
  validateAssertionManifest,
} from "../../../keep-loaded/tools/harness/live-core.mjs";
import { openMarionette } from "../../../keep-loaded/tools/harness/live-marionette.mjs";
import {
  installShutdownSignals,
  launchLiveZen,
} from "../../../keep-loaded/tools/harness/live-zen.mjs";
import { validateProductionLifecycleEvidence } from "./production-lifecycle-core.mjs";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MOD_DIRECTORY = resolve(DIRECTORY, "../..");
const REPOSITORY_ROOT = resolve(MOD_DIRECTORY, "../..");
const MANIFEST_PATH = resolve(MOD_DIRECTORY, "theme.json");
const OUTPUT = resolve(
  REPOSITORY_ROOT,
  ".benchmarks/live/load-bar-default-pane.smoke.json",
);
const PRODUCTION_PATHS = [
  "dist/load-bar.uc.mjs",
  "preferences.json",
  "styles/chrome.css",
];

const REQUIRED_ASSERTIONS = [
  "exact stamped platform is running",
  "manifest declares unload support and chrome styling",
  "production mod starts disabled behind Zen native activity",
  "ready generation owns one custom line before hiding native activity",
  "line wobble grows and shrinks through clipped motion",
  "instant navigation never becomes visible",
  "known and unknown slow responses show and complete",
  "redirect navigation retains one activity line",
  "HTTP error completes as transport success",
  "cancellation and network failure fade in place",
  "Sine reload drains waiting visible completing and canceling generations",
  "native loading preference remains unchanged",
  "final Sine disable restores native activity and drains resources",
];

const PROBE = `
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  const OWNER_ATTRIBUTE = "data-zen-load-bar-owner";
  const NATIVE_ID = "zen-loading-progress-bar";
  const nativeNow = Date.now.bind(Date);
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const report = {
    assertions: [],
    fatal: null,
    fixtures: {},
    lifecycle: {},
    platform: null,
    preference: null,
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
      await wait(20);
    }
    throw new Error("timed out waiting for " + name + "; last value: " + String(value));
  };
  const tab = () => gBrowser.selectedTab;
  const browser = () => gBrowser.selectedBrowser;
  const panel = () => document.getElementById(tab()?.linkedPanel ?? "");
  const lines = () => panel()?.querySelectorAll(":scope > .browserContainer > .zen-load-bar") ?? [];
  const line = () => lines()[0] ?? null;
  const segment = () => line()?.querySelector(":scope > .zen-load-bar__segment") ?? null;
  const phase = () => line()?.getAttribute("data-zen-load-bar-state") ?? null;
  const outcome = () => line()?.getAttribute("data-zen-load-bar-outcome") ?? null;
  const marker = () => document.documentElement.getAttribute(OWNER_ATTRIBUTE);
  const nativeIndicator = () => document.getElementById(NATIVE_ID);
  const nativeDisplay = () => {
    const indicator = nativeIndicator();
    return indicator ? getComputedStyle(indicator).display : null;
  };
  const controllerReady = () =>
    window.zenLoadBar?.controller?.isLive?.() === true &&
    window.zenLoadBar.controller.snapshot().started === true &&
    marker() === window.zenLoadBar.generationToken;
  const load = url => {
    const uri = Services.io.newURI(url);
    const principal = Services.scriptSecurityManager.createContentPrincipal(uri, {});
    browser().loadURI(uri, { triggeringPrincipal: principal });
  };
  const stoppedAt = expected =>
    !tab().hasAttribute("busy") && browser().currentURI?.spec?.startsWith(expected);
  const activityTrace = () => {
    const events = [];
    const capture = node => {
      if (node?.matches?.(".zen-load-bar")) {
        events.push({
          outcome: node.getAttribute("data-zen-load-bar-outcome"),
          state: node.getAttribute("data-zen-load-bar-state"),
        });
      }
      for (const child of node?.querySelectorAll?.(".zen-load-bar") ?? []) capture(child);
    };
    const consume = records => {
      for (const record of records) {
        capture(record.target);
        for (const node of record.addedNodes ?? []) capture(node);
        for (const node of record.removedNodes ?? []) capture(node);
      }
    };
    const observer = new MutationObserver(consume);
    observer.observe(panel(), {
      attributeFilter: ["data-zen-load-bar-state", "data-zen-load-bar-outcome"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    return {
      finish: async () => {
        await Promise.resolve();
        consume(observer.takeRecords());
        observer.disconnect();
        return events;
      },
    };
  };
  const runSlow = async route => {
    load(options.serverBaseUrl + route);
    await waitFor(route + " busy", () => tab().hasAttribute("busy"));
    await waitFor(route + " visible", () => phase() === "visible");
    const visible = {
      count: lines().length,
      marker: marker(),
      state: phase(),
    };
    await waitFor(route + " completing", () => phase() === "completing");
    const terminal = { outcome: outcome(), state: phase() };
    await waitFor(route + " removed", () => lines().length === 0);
    return { terminal, visible };
  };

  (async () => {
    let enabled = false;
    let manager;
    let sineUtils;
    try {
      manager = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/manager.sys.mjs"
      ).default;
      sineUtils = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/utils.sys.mjs"
      ).default;
      await waitFor("Sine interface", () =>
        typeof window.addUnloadListener === "function" && window.gBrowser
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
      check(
        "manifest declares unload support and chrome styling",
        options.supportsUnload === true && options.chromeStyle === "styles/chrome.css",
        JSON.stringify({ chromeStyle: options.chromeStyle, supportsUnload: options.supportsUnload }),
      );

      const pref = "zen.view.enable-loading-indicator";
      report.preference = {
        before: {
          hadUserValue: Services.prefs.prefHasUserValue(pref),
          value: Services.prefs.getBoolPref(pref, true),
        },
      };
      const initialMods = await sineUtils.getMods();
      load(options.serverBaseUrl + "/stall/native");
      await waitFor("native fixture busy", () => tab().hasAttribute("busy"));
      await waitFor("Zen native indicator", () => nativeIndicator());
      const nativeBefore = {
        customCount: lines().length,
        display: nativeDisplay(),
        enabled: initialMods[options.modId]?.enabled,
        marker: marker(),
      };
      check(
        "production mod starts disabled behind Zen native activity",
        nativeBefore.enabled === false && nativeBefore.customCount === 0 &&
          nativeBefore.marker === null && nativeBefore.display !== "none",
        JSON.stringify(nativeBefore),
      );

      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = true;
      await waitFor("Load Bar generation", controllerReady);
      await waitFor("seeded custom activity", () => phase() === "visible");
      const firstFacade = window.zenLoadBar;
      const takeover = {
        count: lines().length,
        marker: marker(),
        nativeDisplay: nativeDisplay(),
        snapshot: firstFacade.controller.snapshot(),
        state: phase(),
      };
      check(
        "ready generation owns one custom line before hiding native activity",
        takeover.count === 1 && takeover.marker === firstFacade.generationToken &&
          takeover.nativeDisplay === "none" && takeover.state === "visible" &&
          takeover.snapshot.activeRecords === 1 && takeover.snapshot.pendingTimers === 0,
        JSON.stringify(takeover),
      );
      const motionBefore = getComputedStyle(segment());
      const motion = {
        animationName: motionBefore.animationName,
        before: { translate: motionBefore.translate },
      };
      await wait(250);
      const motionAfter = getComputedStyle(segment());
      motion.after = { translate: motionAfter.translate };
      report.fixtures.motion = motion;
      check(
        "line wobble grows and shrinks through clipped motion",
        motion.animationName === "zen-load-bar-wobble" &&
          motion.before.translate !== "none" &&
          motion.before.translate !== motion.after.translate,
        JSON.stringify(motion),
      );
      browser().stop();
      await waitFor("initial fixture stopped", () => !tab().hasAttribute("busy"));
      await waitFor("initial line removed", () => lines().length === 0);

      const instantTrace = activityTrace();
      load(options.serverBaseUrl + "/instant");
      await waitFor("instant fixture complete", () => stoppedAt(options.serverBaseUrl + "/instant"));
      await wait(260);
      const instantEvents = await instantTrace.finish();
      report.fixtures.instant = { events: instantEvents, finalCount: lines().length };
      check(
        "instant navigation never becomes visible",
        instantEvents.every(event => event.state !== "visible" && event.state !== "completing" && event.state !== "canceling") &&
          lines().length === 0,
        JSON.stringify(report.fixtures.instant),
      );

      report.fixtures.known = await runSlow("/known");
      report.fixtures.unknown = await runSlow("/unknown");
      check(
        "known and unknown slow responses show and complete",
        [report.fixtures.known, report.fixtures.unknown].every(result =>
          result.visible.count === 1 && result.visible.state === "visible" &&
          result.terminal.state === "completing" && result.terminal.outcome === "success"
        ),
        JSON.stringify({ known: report.fixtures.known, unknown: report.fixtures.unknown }),
      );

      load(options.serverBaseUrl + "/redirect");
      await waitFor("redirect busy", () => tab().hasAttribute("busy"));
      let redirectMaxLines = 0;
      while (tab().hasAttribute("busy")) {
        redirectMaxLines = Math.max(redirectMaxLines, lines().length);
        await wait(10);
      }
      await waitFor("redirect line removed", () => lines().length === 0);
      report.fixtures.redirect = { maxLines: redirectMaxLines };
      check(
        "redirect navigation retains one activity line",
        redirectMaxLines === 1,
        JSON.stringify(report.fixtures.redirect),
      );

      report.fixtures.httpError = await runSlow("/http-error");
      check(
        "HTTP error completes as transport success",
        report.fixtures.httpError.terminal.state === "completing" &&
          report.fixtures.httpError.terminal.outcome === "success",
        JSON.stringify(report.fixtures.httpError),
      );

      load(options.serverBaseUrl + "/stall/cancel");
      await waitFor("cancel fixture visible", () => phase() === "visible");
      browser().stop();
      await waitFor("cancel phase", () => phase() === "canceling");
      const canceled = { outcome: outcome(), state: phase() };
      await waitFor("cancel line removed", () => lines().length === 0);
      load(options.serverBaseUrl + "/reset");
      await waitFor("reset fixture visible", () => phase() === "visible");
      await waitFor("network failure phase", () => phase() === "canceling");
      const networkFailure = { outcome: outcome(), state: phase() };
      await waitFor("network failure line removed", () => lines().length === 0);
      report.fixtures.failures = { canceled, networkFailure };
      check(
        "cancellation and network failure fade in place",
        canceled.state === "canceling" && canceled.outcome === "canceled" &&
          networkFailure.state === "canceling" && networkFailure.outcome === "network-error",
        JSON.stringify(report.fixtures.failures),
      );

      const delayPref = "zen.load-bar.reveal-delay";
      const savedDelay = {
        hadUserValue: Services.prefs.prefHasUserValue(delayPref),
        value: Services.prefs.prefHasUserValue(delayPref)
          ? Services.prefs.getStringPref(delayPref)
          : null,
      };
      const restoreDelay = () => {
        if (savedDelay.hadUserValue) {
          Services.prefs.setStringPref(delayPref, savedDelay.value);
        } else if (Services.prefs.prefHasUserValue(delayPref)) {
          Services.prefs.clearUserPref(delayPref);
        }
      };
      const reloadAtPhase = async expectedPhase => {
        const oldFacade = window.zenLoadBar;
        const oldLine = line();
        const before = {
          count: lines().length,
          marker: marker(),
          phase: phase(),
          snapshot: oldFacade.controller.snapshot(),
          token: oldFacade.generationToken,
        };
        let atStop = null;
        oldFacade.controller.defer(() => {
          atStop = {
            lineConnected: oldLine?.isConnected ?? false,
            marker: marker(),
            phase: oldLine?.getAttribute("data-zen-load-bar-state") ?? null,
            snapshot: oldFacade.controller.snapshot(),
          };
        });
        await manager.rebuildMods(true, false);
        await waitFor(expectedPhase + " replacement generation", () =>
          controllerReady() && window.zenLoadBar !== oldFacade
        );
        const expectedCount = expectedPhase === "waiting" || expectedPhase === "visible" ? 1 : 0;
        await waitFor(expectedPhase + " replacement state", () =>
          lines().length === expectedCount &&
            (expectedPhase === "waiting" || expectedPhase === "visible"
              ? phase() === expectedPhase
              : phase() === null)
        );
        const currentFacade = window.zenLoadBar;
        const record = {
          after: {
            count: lines().length,
            marker: marker(),
            oldConnected: oldLine?.isConnected ?? null,
            oldSnapshot: oldFacade.controller.snapshot(),
            snapshot: currentFacade.controller.snapshot(),
            token: currentFacade.generationToken,
          },
          atStop,
          before,
          phase: expectedPhase,
          stale: {
            settingsAccepted: oldFacade.controller.updateSettings({
              color: "firefox",
              placement: "top",
              revealDelayMs: 200,
              thickness: 2,
            }),
            stopAccepted: oldFacade.controller.stop("manual"),
          },
        };
        if (tab().hasAttribute("busy")) browser().stop();
        await waitFor(expectedPhase + " fixture stopped", () => !tab().hasAttribute("busy"));
        await waitFor(expectedPhase + " line removed", () => lines().length === 0);
        await waitFor(expectedPhase + " replacement idle", () =>
          window.zenLoadBar.controller.snapshot().activeRecords === 0
        );
        return record;
      };

      report.lifecycle.reloads = [];
      Services.prefs.setStringPref(delayPref, "500");
      load(options.serverBaseUrl + "/stall/reload-waiting");
      await waitFor("reload waiting phase", () => phase() === "waiting");
      report.lifecycle.reloads.push(await reloadAtPhase("waiting"));
      restoreDelay();

      load(options.serverBaseUrl + "/stall/reload-visible");
      await waitFor("reload visible phase", () => phase() === "visible");
      report.lifecycle.reloads.push(await reloadAtPhase("visible"));

      load(options.serverBaseUrl + "/known?reload=completing");
      await waitFor("reload completing phase", () => phase() === "completing");
      report.lifecycle.reloads.push(await reloadAtPhase("completing"));

      load(options.serverBaseUrl + "/stall/reload-canceling");
      await waitFor("reload cancel fixture visible", () => phase() === "visible");
      browser().stop();
      await waitFor("reload canceling phase", () => phase() === "canceling");
      report.lifecycle.reloads.push(await reloadAtPhase("canceling"));

      check(
        "Sine reload drains waiting visible completing and canceling generations",
        report.lifecycle.reloads.length === 4 &&
          report.lifecycle.reloads.every(record =>
            record.atStop?.phase === record.phase && record.atStop?.lineConnected === true &&
              record.after.oldConnected === false && record.after.oldSnapshot.live === false &&
              record.after.oldSnapshot.activeRecords === 0 &&
              record.after.oldSnapshot.pendingTimers === 0 &&
              record.stale.settingsAccepted === false && record.stale.stopAccepted === false
          ),
        JSON.stringify(report.lifecycle.reloads),
      );

      report.preference.afterReload = {
        hadUserValue: Services.prefs.prefHasUserValue(pref),
        value: Services.prefs.getBoolPref(pref, true),
      };
      check(
        "native loading preference remains unchanged",
        JSON.stringify(report.preference.before) === JSON.stringify(report.preference.afterReload),
        JSON.stringify(report.preference),
      );

      load(options.serverBaseUrl + "/stall/disable");
      await waitFor("disable fixture visible", () => phase() === "visible");
      const finalFacade = window.zenLoadBar;
      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = false;
      await waitFor("final Sine disable", () =>
        window.zenLoadBar === undefined && marker() === null && lines().length === 0
      );
      const finalMods = await sineUtils.getMods();
      report.preference.final = {
        hadUserValue: Services.prefs.prefHasUserValue(pref),
        value: Services.prefs.getBoolPref(pref, true),
      };
      report.lifecycle.disable = {
        enabled: finalMods[options.modId]?.enabled,
        marker: marker(),
        nativeDisplay: nativeDisplay(),
        snapshot: finalFacade.controller.snapshot(),
        totalLines: lines().length,
      };
      check(
        "final Sine disable restores native activity and drains resources",
        report.lifecycle.disable.enabled === false && report.lifecycle.disable.marker === null &&
          report.lifecycle.disable.nativeDisplay !== "none" &&
          report.lifecycle.disable.snapshot.live === false &&
          report.lifecycle.disable.snapshot.stopReason === "sine-unload" &&
          report.lifecycle.disable.snapshot.activeRecords === 0 &&
          report.lifecycle.disable.snapshot.pendingTimers === 0 &&
          report.lifecycle.disable.snapshot.pendingWaits === 0 &&
          JSON.stringify(report.preference.before) === JSON.stringify(report.preference.final),
        JSON.stringify(report.lifecycle.disable),
      );
      browser().stop();
    } catch (error) {
      report.fatal = String(error?.stack ?? error);
      if (enabled && manager && sineUtils) {
        try {
          await manager.toggleTheme(await sineUtils.getMods(), options.modId);
        } catch {}
      }
      try {
        browser()?.stop?.();
      } catch {}
    }
    done(report);
  })();
`;

const startFixtureServer = async () => {
  const responses = new Set();
  const timers = new Set();
  const events = [];
  const later = (callback, delayMs) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delayMs);
    timers.add(timer);
  };
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    events.push({ at: Date.now(), path, type: "request" });
    responses.add(response);
    response.once("close", () => {
      responses.delete(response);
      events.push({ at: Date.now(), path, type: "close" });
    });
    const finishKnown = (status = 200) => {
      const body = Buffer.from(`<title>Load Bar fixture</title>${"x".repeat(4096)}`);
      response.writeHead(status, {
        "Cache-Control": "no-store",
        "Content-Length": String(body.length),
        "Content-Type": "text/html; charset=utf-8",
      });
      response.write(body.subarray(0, 32));
      later(() => response.end(body.subarray(32)), 700);
    };
    if (path === "/instant") {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "text/html",
      });
      response.end("<title>Instant</title>");
    } else if (path === "/known") {
      finishKnown();
    } else if (path === "/unknown") {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "text/html",
      });
      response.write("<title>Unknown length</title>");
      later(() => response.end("done"), 700);
    } else if (path === "/redirect") {
      response.writeHead(302, { Location: "/unknown" });
      response.end();
    } else if (path === "/http-error") {
      finishKnown(503);
    } else if (path === "/reset") {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "text/html",
      });
      response.write("<title>Reset</title>");
      later(() => response.destroy(), 700);
    } else if (path.startsWith("/stall/")) {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "text/html",
      });
      response.write("<title>Stalled</title>");
    } else {
      response.writeHead(404);
      response.end();
    }
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
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        for (const response of responses) response.destroy();
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
        enabled: false,
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
    label: "Load Bar default pane",
    shutdown,
  });

  try {
    client = await openMarionette({ port: zen.port });
    await client.setScriptTimeout(180_000);
    const result = await client.executeAsync(PROBE, [
      {
        buildId: zen.platformStamp.zen.buildId,
        chromeStyle: manifest.style?.chrome,
        geckoVersion: zen.platformStamp.zen.geckoVersion,
        modId: manifest.id,
        serverBaseUrl: fixture.baseUrl,
        sineVersion: zen.platformStamp.sine.version,
        supportsUnload: manifest.supportsUnload,
        zenVersion: zen.platformStamp.zen.version,
      },
    ]);
    let validationError = null;
    const lifecycle = validateProductionLifecycleEvidence({
      disable: result?.lifecycle?.disable,
      reloads: result?.lifecycle?.reloads,
    });
    let verdicts = null;
    try {
      verdicts = collectVerdicts(validateAssertionManifest(result, REQUIRED_ASSERTIONS));
      if (!lifecycle.ok) {
        throw new Error(`lifecycle evidence failed: ${lifecycle.failures.join("; ")}`);
      }
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
      validation: { error: validationError, lifecycle, verdicts },
    };
    await atomicWriteJson(OUTPUT, artifact);
    for (const assertion of result?.assertions ?? []) {
      console.log(`  ${assertion.ok ? "PASS" : "FAIL"}  ${assertion.name}`);
      if (!assertion.ok) console.log(`        ${assertion.detail}`);
    }
    console.log(`Raw Load Bar evidence: ${OUTPUT}`);
    if (validationError) {
      console.error(validationError);
      process.exitCode = 1;
    } else {
      console.log(`${verdicts.counts.passed}/${verdicts.counts.total} assertions passed`);
      if (!verdicts.ok || result?.fatal) process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Load Bar default-pane probe failed: ${error.stack ?? error.message}`);
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
