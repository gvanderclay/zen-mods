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
const OUTPUT = resolve(REPOSITORY_ROOT, ".benchmarks/live/load-bar-settings.smoke.json");
const PRODUCTION_PATHS = [
  "dist/load-bar.uc.mjs",
  "preferences.json",
  "styles/chrome.css",
];

const REQUIRED_ASSERTIONS = [
  "exact production settings generation starts idle",
  "top and bottom placement update the active line",
  "every approved thickness updates the active line",
  "Firefox and Zen colors resolve through live theme tokens",
  "every approved reveal delay controls the next navigation",
  "malformed preferences fall back one field at a time",
  "reduced motion removes all line animation and transition",
  "forced colors uses the system highlight color",
  "Sine reload retains a nondefault settings snapshot",
  "final disable drains resources and restores every probe preference",
];

const PROBE = `
  const [options] = arguments;
  const done = arguments[arguments.length - 1];
  const PREFS = {
    color: "zen.load-bar.color",
    delay: "zen.load-bar.reveal-delay",
    placement: "zen.load-bar.placement",
    thickness: "zen.load-bar.thickness",
  };
  const ACCESSIBILITY_PREFS = [
    ["ui.prefersReducedMotion", "int"],
  ];
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const report = {
    assertions: [],
    colors: null,
    delays: [],
    disable: null,
    fatal: null,
    forcedColors: null,
    malformed: null,
    placement: null,
    platform: null,
    reducedMotion: null,
    reload: null,
    thickness: null,
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
  const savePref = (name, kind) => {
    const hadUserValue = Services.prefs.prefHasUserValue(name);
    let value = null;
    if (hadUserValue) {
      value = kind === "int"
        ? Services.prefs.getIntPref(name)
        : Services.prefs.getStringPref(name);
    }
    return { hadUserValue, kind, name, value };
  };
  const restorePref = saved => {
    if (!saved.hadUserValue) {
      Services.prefs.clearUserPref(saved.name);
    } else if (saved.kind === "int") {
      Services.prefs.setIntPref(saved.name, saved.value);
    } else {
      Services.prefs.setStringPref(saved.name, saved.value);
    }
  };
  const lineFor = browser =>
    browser?.closest?.(".browserContainer")?.querySelector(":scope > .zen-load-bar") ?? null;
  const facts = browser => {
    const line = lineFor(browser);
    const segment = line?.querySelector(".zen-load-bar__segment") ?? null;
    const lineRect = line?.getBoundingClientRect();
    const containerRect = browser?.closest?.(".browserContainer")?.getBoundingClientRect();
    const lineStyle = line ? getComputedStyle(line) : null;
    const segmentStyle = segment ? getComputedStyle(segment) : null;
    return {
      animationName: segmentStyle?.animationName ?? null,
      background: segmentStyle?.backgroundColor ?? null,
      color: line?.getAttribute("data-zen-load-bar-color") ?? null,
      height: lineRect?.height ?? null,
      placement: line?.getAttribute("data-zen-load-bar-placement") ?? null,
      state: line?.getAttribute("data-zen-load-bar-state") ?? null,
      topGap: lineRect && containerRect ? Math.abs(lineRect.top - containerRect.top) : null,
      bottomGap: lineRect && containerRect
        ? Math.abs(lineRect.bottom - containerRect.bottom)
        : null,
      transform: segmentStyle?.transform ?? null,
      transitionDuration: lineStyle?.transitionDuration ?? null,
    };
  };
  const setString = async (name, value) => {
    Services.prefs.setStringPref(name, value);
    await wait(0);
  };
  const load = (browser, id) => {
    const uri = Services.io.newURI(options.serverBaseUrl + "/hold/" + id);
    browser.loadURI(uri, {
      triggeringPrincipal: Services.scriptSecurityManager.createContentPrincipal(uri, {}),
    });
  };
  const releaseFixture = async id => {
    const response = await fetch(options.serverBaseUrl + "/release/" + id, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("fixture release failed for " + id);
  };
  const referenceColor = (container, value) => {
    const reference = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    reference.style.cssText =
      "position:absolute;inline-size:1px;block-size:1px;opacity:0;pointer-events:none;";
    reference.style.background = value;
    container.append(reference);
    const color = getComputedStyle(reference).backgroundColor;
    reference.remove();
    return color;
  };
  const timedLoad = async (browser, delay) => {
    await setString(PREFS.delay, String(delay));
    const container = browser.closest(".browserContainer");
    let waitingAt = null;
    let visibleAt = null;
    const observer = new MutationObserver(() => {
      const line = lineFor(browser);
      const state = line?.getAttribute("data-zen-load-bar-state");
      if (line && waitingAt === null) waitingAt = performance.now();
      if (state === "visible" && visibleAt === null) visibleAt = performance.now();
    });
    observer.observe(container, {
      attributeFilter: ["data-zen-load-bar-state"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    const id = "delay-" + delay;
    load(browser, id);
    await waitFor("visible delay " + delay, () => visibleAt !== null, 5000);
    observer.disconnect();
    const measured = visibleAt - waitingAt;
    await releaseFixture(id);
    await waitFor("delay line removed " + delay, () => lineFor(browser) === null);
    return { delay, measured, visibleAt, waitingAt };
  };

  (async () => {
    const saved = [
      ...Object.values(PREFS).map(name => savePref(name, "string")),
      ...ACCESSIBILITY_PREFS.map(([name, kind]) => savePref(name, kind)),
    ];
    const root = document.documentElement;
    const priorZenColor = root.style.getPropertyValue("--zen-primary-color");
    const chromeContext = BrowsingContext.getFromWindow(window);
    const priorForcedColors = chromeContext?.forcedColorsOverride;
    let enabled = true;
    let manager;
    let sineUtils;
    let tab;
    try {
      manager = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/manager.sys.mjs",
      ).default;
      sineUtils = ChromeUtils.importESModule(
        "chrome://userscripts/content/core/utils.sys.mjs",
      ).default;
      await waitFor("production controller", () =>
        window.zenLoadBar?.controller?.isLive?.() === true &&
          window.zenLoadBar.controller.snapshot().started === true
      );
      report.platform = {
        buildId: Services.appinfo.appBuildID,
        geckoVersion: Services.appinfo.platformVersion,
        sineVersion: options.sineVersion,
        zenVersion: Services.appinfo.version,
      };
      const initial = window.zenLoadBar.controller.snapshot();
      check(
        "exact production settings generation starts idle",
        report.platform.zenVersion === options.zenVersion &&
          report.platform.buildId === options.buildId &&
          report.platform.geckoVersion === options.geckoVersion &&
          initial.live && initial.started && initial.activeRecords === 0,
        JSON.stringify({ initial, platform: report.platform }),
      );

      const uri = Services.io.newURI("about:blank");
      tab = gBrowser.addTab(uri.spec, {
        inBackground: false,
        skipAnimation: true,
        skipRoute: true,
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });
      gBrowser.selectedTab = tab;
      const browser = tab.linkedBrowser;
      await setString(PREFS.delay, "0");
      load(browser, "presentation");
      await waitFor("presentation line", () => facts(browser).state === "visible");

      const placements = [];
      for (const value of ["top", "bottom"]) {
        await setString(PREFS.placement, value);
        await waitFor("placement " + value, () => facts(browser).placement === value);
        placements.push({ value, facts: facts(browser) });
      }
      report.placement = placements;
      check(
        "top and bottom placement update the active line",
        placements[0].facts.topGap <= 1 && placements[1].facts.bottomGap <= 1,
        JSON.stringify(placements),
      );

      const thicknesses = [];
      for (const value of [2, 3, 4]) {
        await setString(PREFS.thickness, String(value));
        await waitFor("thickness " + value, () => Math.abs(facts(browser).height - value) < 0.1);
        thicknesses.push({ value, facts: facts(browser) });
      }
      report.thickness = thicknesses;
      check(
        "every approved thickness updates the active line",
        thicknesses.every(entry => Math.abs(entry.facts.height - entry.value) < 0.1),
        JSON.stringify(thicknesses),
      );

      const container = browser.closest(".browserContainer");
      await setString(PREFS.color, "firefox");
      const firefox = facts(browser);
      const firefoxExpected = referenceColor(container, "var(--tab-loading-fill, #0060df)");
      root.style.setProperty("--zen-primary-color", "rgb(17, 123, 231)");
      await setString(PREFS.color, "zen");
      await waitFor("first Zen color", () => facts(browser).background === "rgb(17, 123, 231)");
      const zenFirst = facts(browser);
      root.style.setProperty("--zen-primary-color", "rgb(203, 71, 119)");
      await waitFor("second Zen color", () => facts(browser).background === "rgb(203, 71, 119)");
      const zenSecond = facts(browser);
      report.colors = { firefox, firefoxExpected, zenFirst, zenSecond };
      check(
        "Firefox and Zen colors resolve through live theme tokens",
        firefox.color === "firefox" && firefox.background === firefoxExpected &&
          zenFirst.color === "zen" && zenFirst.background === "rgb(17, 123, 231)" &&
          zenSecond.background === "rgb(203, 71, 119)",
        JSON.stringify(report.colors),
      );
      if (priorZenColor) root.style.setProperty("--zen-primary-color", priorZenColor);
      else root.style.removeProperty("--zen-primary-color");

      await releaseFixture("presentation");
      await waitFor("presentation line removed", () => lineFor(browser) === null);
      for (const delay of [0, 100, 200, 500]) {
        report.delays.push(await timedLoad(browser, delay));
      }
      const delayTolerance = new Map([[0, [0, 120]], [100, [60, 350]], [200, [150, 500]], [500, [430, 900]]]);
      check(
        "every approved reveal delay controls the next navigation",
        report.delays.every(entry => {
          const [minimum, maximum] = delayTolerance.get(entry.delay);
          return entry.measured >= minimum && entry.measured <= maximum;
        }),
        JSON.stringify(report.delays),
      );

      await setString(PREFS.placement, "side");
      await setString(PREFS.thickness, "9");
      await setString(PREFS.color, "custom");
      await setString(PREFS.delay, "250");
      load(browser, "malformed");
      await waitFor("malformed fallback line", () => facts(browser).state === "visible");
      report.malformed = facts(browser);
      check(
        "malformed preferences fall back one field at a time",
        report.malformed.placement === "top" && report.malformed.color === "firefox" &&
          Math.abs(report.malformed.height - 2) < 0.1,
        JSON.stringify(report.malformed),
      );
      await releaseFixture("malformed");
      await waitFor("malformed line removed", () => lineFor(browser) === null);

      Services.prefs.setIntPref("ui.prefersReducedMotion", 1);
      await waitFor("reduced motion media", () => matchMedia("(prefers-reduced-motion: reduce)").matches);
      await setString(PREFS.delay, "0");
      load(browser, "reduced");
      await waitFor("reduced line", () => facts(browser).state === "visible");
      report.reducedMotion = {
        media: matchMedia("(prefers-reduced-motion: reduce)").matches,
        facts: facts(browser),
      };
      check(
        "reduced motion removes all line animation and transition",
        report.reducedMotion.media && report.reducedMotion.facts.animationName === "none" &&
          report.reducedMotion.facts.transform === "none" &&
          report.reducedMotion.facts.transitionDuration === "0s",
        JSON.stringify(report.reducedMotion),
      );
      await releaseFixture("reduced");
      await waitFor("reduced line removed", () => lineFor(browser) === null);
      restorePref(saved.find(entry => entry.name === "ui.prefersReducedMotion"));

      if (!chromeContext) throw new Error("browser chrome has no BrowsingContext");
      chromeContext.forcedColorsOverride = "active";
      await waitFor("forced colors media", () => matchMedia("(forced-colors: active)").matches);
      load(browser, "forced");
      await waitFor("forced colors line", () => facts(browser).state === "visible");
      const forcedExpected = referenceColor(container, "Highlight");
      report.forcedColors = {
        expected: forcedExpected,
        facts: facts(browser),
        media: matchMedia("(forced-colors: active)").matches,
      };
      check(
        "forced colors uses the system highlight color",
        report.forcedColors.media && report.forcedColors.facts.background === forcedExpected,
        JSON.stringify(report.forcedColors),
      );
      await releaseFixture("forced");
      await waitFor("forced line removed", () => lineFor(browser) === null);
      chromeContext.forcedColorsOverride = priorForcedColors;

      await setString(PREFS.placement, "bottom");
      await setString(PREFS.thickness, "4");
      await setString(PREFS.color, "zen");
      await setString(PREFS.delay, "100");
      const oldFacade = window.zenLoadBar;
      await manager.rebuildMods(true, false);
      await waitFor("replacement generation", () =>
        window.zenLoadBar && window.zenLoadBar !== oldFacade &&
          window.zenLoadBar.controller.isLive()
      );
      load(browser, "reload");
      await waitFor("reload line", () => facts(browser).state === "visible");
      report.reload = {
        facts: facts(browser),
        old: oldFacade.controller.snapshot(),
        replacement: window.zenLoadBar.controller.snapshot(),
      };
      check(
        "Sine reload retains a nondefault settings snapshot",
        !report.reload.old.live && report.reload.old.stopReason === "sine-unload" &&
          report.reload.facts.placement === "bottom" && report.reload.facts.color === "zen" &&
          Math.abs(report.reload.facts.height - 4) < 0.1,
        JSON.stringify(report.reload),
      );
      await releaseFixture("reload");
      await waitFor("reload line removed", () => lineFor(browser) === null);

      const finalFacade = window.zenLoadBar;
      await manager.toggleTheme(await sineUtils.getMods(), options.modId);
      enabled = false;
      await waitFor("final disable", () => window.zenLoadBar === undefined);
      for (const entry of saved) restorePref(entry);
      const finalMods = await sineUtils.getMods();
      report.disable = {
        enabled: finalMods[options.modId]?.enabled,
        snapshot: finalFacade.controller.snapshot(),
        restored: saved.every(entry =>
          Services.prefs.prefHasUserValue(entry.name) === entry.hadUserValue &&
          (!entry.hadUserValue || (entry.kind === "int"
            ? Services.prefs.getIntPref(entry.name) === entry.value
            : Services.prefs.getStringPref(entry.name) === entry.value))
        ),
        lines: document.querySelectorAll(".zen-load-bar").length,
      };
      check(
        "final disable drains resources and restores every probe preference",
        report.disable.enabled === false && report.disable.restored && report.disable.lines === 0 &&
          !report.disable.snapshot.live && report.disable.snapshot.activeRecords === 0 &&
          report.disable.snapshot.pendingTimers === 0 && report.disable.snapshot.pendingWaits === 0,
        JSON.stringify(report.disable),
      );
    } catch (error) {
      report.fatal = String(error?.stack ?? error);
    } finally {
      if (priorZenColor) root.style.setProperty("--zen-primary-color", priorZenColor);
      else root.style.removeProperty("--zen-primary-color");
      if (chromeContext && priorForcedColors !== undefined) {
        try { chromeContext.forcedColorsOverride = priorForcedColors; } catch {}
      }
      if (tab?.isConnected) {
        try { gBrowser.removeTab(tab, { animate: false }); } catch {}
      }
      for (const entry of saved) {
        try { restorePref(entry); } catch {}
      }
      if (enabled && manager && sineUtils) {
        try { await manager.toggleTheme(await sineUtils.getMods(), options.modId); } catch {}
      }
    }
    done(report);
  })();
`;

const startFixtureServer = async () => {
  const held = new Map();
  const responses = new Set();
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    responses.add(response);
    response.once("close", () => responses.delete(response));
    if (path.startsWith("/hold/")) {
      const id = path.slice("/hold/".length);
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
      });
      response.write(`<title>Held ${id}</title><p>Held ${id}</p>`);
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
      response.writeHead(200, { "Access-Control-Allow-Origin": "*" });
      response.end("released");
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
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const response of responses) response.destroy();
      held.clear();
      await new Promise((resolveClose, reject) =>
        server.close(error => (error ? reject(error) : resolveClose())),
      );
    },
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
  const removeSignals = installShutdownSignals({ label: "Load Bar settings", shutdown });
  try {
    client = await openMarionette({ port: zen.port });
    await client.setScriptTimeout(180_000);
    const result = await client.executeAsync(PROBE, [
      {
        buildId: zen.platformStamp.zen.buildId,
        geckoVersion: zen.platformStamp.zen.geckoVersion,
        modId: manifest.id,
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
    await atomicWriteJson(OUTPUT, {
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
    });
    for (const assertion of result?.assertions ?? []) {
      console.log(`  ${assertion.ok ? "PASS" : "FAIL"}  ${assertion.name}`);
      if (!assertion.ok) console.log(`        ${assertion.detail}`);
    }
    console.log(`Raw Load Bar settings evidence: ${OUTPUT}`);
    if (validationError) {
      console.error(validationError);
      process.exitCode = 1;
    } else {
      console.log(`${verdicts.counts.passed}/${verdicts.counts.total} assertions passed`);
      if (!verdicts.ok || result?.fatal) process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Load Bar settings probe failed: ${error.stack ?? error.message}`);
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
