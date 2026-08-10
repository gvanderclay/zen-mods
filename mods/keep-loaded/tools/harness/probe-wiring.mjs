/**
 * Does the *shipped bundle* freshen tabs, and does it stop when told to?
 *
 * `probe-pulse.mjs` drives `pulseStep` — the decision — against a real browser, with the
 * harness playing the part of `main.ts`. This loads `dist/keep-loaded.uc.mjs` itself into
 * a real chrome window and touches nothing but prefs and the unload hook, so the parts no
 * unit test reaches are the parts under test:
 *
 *   1. boot with freshening off: says so, activates nothing
 *   2. an edit to the pref: the observer picks it up, and the self-rescheduling timer
 *      runs pulse after pulse without anything driving it
 *   3. edited back to 0 mid-pulse: hands the docshell back now, and books nothing more
 *   4. teardown mid-pulse: same, and leaves no timer behind
 *
 * The window bundle is ESM with a top-level await. The probe stages its generated
 * system-module sibling under the same temporary resource substitution, rewrites only
 * the fixed production owner URI to that exact staged file, and then runs the window
 * entry with `loadSubScript` in the chrome window's own global. (`new Function` is not
 * an option: browser.xhtml's CSP blocks eval outright.)
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openMarionette } from "./marionette.mjs";
import { launchZen } from "./zen.mjs";

const WINDOW_BUNDLE = fileURLToPath(
  new URL("../../dist/keep-loaded.uc.mjs", import.meta.url),
);
const SYSTEM_BUNDLE = fileURLToPath(
  new URL("../../dist/keep-loaded.sys.mjs", import.meta.url),
);
const APPLICATION_OWNER_URI =
  "chrome://sine/content/keep-loaded/dist/keep-loaded.sys.mjs";

const EVERY = "6";
const HOLD = "2";
const TICK_MS = 250;
const CYCLES_MS = 26_000;
const QUIET_MS = 8000;

/** 0 is the selected control, 1 is the tab under test, 2 is pinned but not allowlisted. */
const CONTROL = 0;
const KEPT = 1;
const OTHER = 2;
const ALL = [CONTROL, KEPT, OTHER];

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>quiet 0</title>
<script>
  let n = 0;
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    document.title = "quiet " + ++n;
  }, 250);
</script>`;

const startPageServer = async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(PAGE);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { origin: `http://127.0.0.1:${port}`, stop: () => server.close() };
};

const OPEN = `
  const [keepUrl, otherUrl] = arguments;
  window.__tabs = [];
  for (const url of [keepUrl, keepUrl, otherUrl]) {
    const tab = gBrowser.addTab(url, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    gBrowser.pinTab(tab);
    window.__tabs.push(tab);
  }
  gBrowser.selectedTab = window.__tabs[0];
  return window.__tabs.length;
`;

const SET_PREF = `
  const [name, value] = arguments;
  Services.prefs.setStringPref(name, value);
  return Services.prefs.getStringPref(name);
`;

/**
 * What gets loaded: the bundle, plus what Sine would have given it. The unload hook is
 * captured so teardown can be run on purpose, and the log capture is set up here rather
 * than over Marionette so both the patch and the array live in the window's own
 * compartment — the same one the mod logs from.
 */
const bootScript = source => `
window.__log = [];
if (!window.__patched) {
  window.__patched = true;
  const real = console.log;
  console.log = function (...args) {
    if (args[0] === "[keep-loaded]") {
      window.__log.push({
        at: Date.now(),
        line: args
          .slice(1)
          .map(a => (typeof a === "string" ? a : JSON.stringify(a)))
          .join(" "),
      });
    }
    return real.apply(console, args);
  };
}
window.__unload = [];
window.addUnloadListener = cb => window.__unload.push(cb);
window.__boot = "pending";
(async () => {
${source}
})().then(
  () => { window.__boot = "ok"; },
  e => { window.__boot = "failed: " + ((e && (e.stack || e.message)) || String(e)); },
);
`;

/**
 * `resource://`, not `file://`: a substitution is how fx-autoconfig (and Sine on top of
 * it) gets a userChrome script into a privileged scope in the first place.
 */
const BOOT = `
  const [dirUrl, name] = arguments;
  const handler = Services.io
    .getProtocolHandler("resource")
    .QueryInterface(Ci.nsIResProtocolHandler);
  handler.setSubstitution("klprobe", Services.io.newURI(dirUrl));
  Services.scriptloader.loadSubScript("resource://klprobe/" + name, window);
  return window.__boot ?? "missing";
`;

/** One reading: every tab's state plus whether a pass is booked. */
const SAMPLE = `
  const [indexes] = arguments;
  const state = window.zenKeepLoaded || {};
  return {
    at: Date.now(),
    boot: window.__boot ?? null,
    timers: state.controller?.pendingTimers ?? 0,
    live: state.controller?.isLive() === true,
    logs: (window.__log || []).length,
    tabs: indexes.map(index => {
      const tab = window.__tabs[index];
      const browser = tab.linkedPanel ? tab.linkedBrowser : null;
      return {
        index,
        pinned: tab.pinned,
        selected: tab.selected,
        pending: tab.hasAttribute("pending"),
        active: browser?.docShellIsActive === true,
        title: browser?.contentTitle ?? null,
      };
    }),
  };
`;

/** Resource state that the normal user-facing facade intentionally does not expose. */
const RESOURCE_SAMPLE = `
  const [index] = arguments;
  const state = window.zenKeepLoaded || {};
  const tab = window.__tabs[index] || null;
  const browser = tab?.linkedPanel ? tab.linkedBrowser : null;
  let socketListening = null;
  try {
    const id = browser?.innerWindowID ?? null;
    if (id !== null) {
      socketListening = Cc["@mozilla.org/websocketevent/service;1"]
        ?.getService(Ci.nsIWebSocketEventService)
        ?.hasListenerFor(id) === true;
    }
  } catch {}
  const application = state.application?.()?.snapshot ?? null;
  return {
    activeClaims: state.controller && state.pulses
      ? state.pulses.active(state.controller).length
      : null,
    socketListening,
    wakeCandidates: application?.wakeCandidates ?? null,
    keyRecords: application?.keyRecords ?? null,
    registrationCount: application?.registrationCount ?? null,
  };
`;

const LOGS = `
  const [from] = arguments;
  return (window.__log || []).slice(from);
`;

const TEARDOWN = `
  const hooks = (window.__unload || []).slice();
  for (const hook of hooks) hook();
  return hooks.length;
`;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const counterOf = title => {
  const match = /^quiet (\d+)$/.exec(title ?? "");
  return match ? Number(match[1]) : null;
};
const perSecond = (count, ms) => (ms ? (count / ms) * 1000 : 0);

const results = [];
const verdict = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`  ${ok ? "→ YES" : "→ NO "}: ${detail}`);
};

const main = async () => {
  const server = await startPageServer();
  // The bundle is loaded through a resource:// substitution, so it needs a directory
  // of its own rather than a path inside the repo.
  const staging = await mkdtemp(join(tmpdir(), "zen-keep-loaded-probe-"));
  const zen = await launchZen();
  let client;
  let logsSeen = 0;

  try {
    client = await openMarionette({ port: zen.port });
    await client.setScriptTimeout(60_000);

    const sample = async () => {
      const reading = await client.execute(SAMPLE, [ALL]);
      reading.byIndex = index => reading.tabs.find(tab => tab.index === index);
      return reading;
    };
    /** Prints whatever the mod has logged since the last call, and returns those lines. */
    const drainLogs = async (indent = "    ") => {
      const lines = await client.execute(LOGS, [logsSeen]);
      logsSeen += lines.length;
      for (const { line } of lines) {
        console.log(`${indent}| ${line}`);
      }
      return lines.map(entry => entry.line);
    };
    /** Samples until `done` or the deadline, so a phase never hangs on a missed edge. */
    const sampleUntil = async (done, timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      const samples = [];
      while (Date.now() < deadline) {
        const reading = await sample();
        samples.push(reading);
        if (done(reading)) {
          break;
        }
        await wait(TICK_MS);
      }
      return samples;
    };

    await client.execute(OPEN, [`${server.origin}/keep`, `${server.origin}/other`]);
    await wait(4000);

    // Set before boot: the startup pass reads them, and a mod that pulsed on its own
    // defaults would hide it.
    await client.execute(SET_PREF, ["zen.keep-loaded.match", "/keep"]);
    await client.execute(SET_PREF, ["zen.keep-loaded.freshen-seconds", "0"]);
    await client.execute(SET_PREF, ["zen.keep-loaded.freshen-hold-seconds", HOLD]);

    console.log("=== phase 1: the shipped bundle boots with freshening off ===");
    const [windowSource, systemSource] = await Promise.all([
      readFile(WINDOW_BUNDLE, "utf8"),
      readFile(SYSTEM_BUNDLE, "utf8"),
    ]);
    if (!windowSource.includes(APPLICATION_OWNER_URI)) {
      throw new Error("the window bundle does not contain its application-owner URI");
    }
    const source = windowSource.replaceAll(
      APPLICATION_OWNER_URI,
      "resource://klprobe/keep-loaded.sys.mjs",
    );
    await Promise.all([
      writeFile(join(staging, "boot.js"), bootScript(source), "utf8"),
      writeFile(join(staging, "keep-loaded.sys.mjs"), systemSource, "utf8"),
    ]);
    console.log(
      `  loading dist/keep-loaded.uc.mjs (${windowSource.length} bytes) with ` +
        `dist/keep-loaded.sys.mjs (${systemSource.length} bytes)`,
    );
    const loaded = await client.execute(BOOT, [
      pathToFileURL(`${staging}/`).href,
      "boot.js",
    ]);
    console.log(`  loadSubScript returned with boot ${JSON.stringify(loaded)}`);

    const booted = await sampleUntil(
      reading => reading.boot !== "pending" && reading.logs > 0,
      45_000,
    );
    const bootState = booted.at(-1);
    console.log(`  boot: ${bootState.boot}`);
    await drainLogs();
    if (bootState.boot !== "ok") {
      throw new Error(`the bundle did not finish starting up: ${bootState.boot}`);
    }
    const offLogs = await client.execute(LOGS, [0]);
    verdict(
      "boot with freshening off",
      offLogs.some(entry => entry.line === "freshness: off") &&
        !bootState.byIndex(KEPT).active &&
        !bootState.byIndex(OTHER).active &&
        bootState.timers === 0,
      `said "freshness: off", left both unselected tabs inactive and booked no pass ` +
        `(timers ${bootState.timers}).`,
    );

    console.log(
      `\n=== phase 2: pref set to ${HOLD}s every ${EVERY}s, then left alone ===`,
    );
    await client.execute(SET_PREF, ["zen.keep-loaded.freshen-seconds", EVERY]);
    const observed = await drainLogs();
    verdict(
      "the pref observer runs the schedule",
      observed.some(line => line.includes(`for ${HOLD}s every ${EVERY}s`)),
      `an edit to freshen-seconds re-synced the schedule with no reload.`,
    );

    // Nothing drives the mod from here: every pass after this one was booked by the
    // pass before it.
    const samples = await sampleUntil(() => false, CYCLES_MS);
    await drainLogs();
    const advance = { held: 0, heldMs: 0, released: 0, releasedMs: 0 };
    let activations = 0;
    const runs = [];
    for (let i = 1; i < samples.length; i++) {
      const from = samples[i - 1].byIndex(KEPT);
      const to = samples[i].byIndex(KEPT);
      const key = from.active ? "held" : "released";
      const a = counterOf(from.title);
      const b = counterOf(to.title);
      if (a !== null && b !== null) {
        advance[key] += b - a;
        advance[`${key}Ms`] += samples[i].at - samples[i - 1].at;
      }
      if (!from.active && to.active) {
        activations += 1;
        runs.push({ from: samples[i].at, to: null });
      }
      if (from.active && !to.active && runs.length) {
        runs.at(-1).to = samples[i].at;
      }
    }
    const finished = runs.filter(run => run.to !== null);
    const holds = finished.map(run => run.to - run.from);
    const gaps = runs.slice(1).map((run, i) => run.from - runs[i].from);
    console.log(
      `  kept tab:    ${advance.held} retitles over ${advance.heldMs}ms held ` +
        `(${perSecond(advance.held, advance.heldMs).toFixed(2)}/s), ` +
        `${advance.released} over ${advance.releasedMs}ms released ` +
        `(${perSecond(advance.released, advance.releasedMs).toFixed(2)}/s)`,
    );
    console.log(
      `  ${activations} pulses, holds ${JSON.stringify(holds)}ms, ` +
        `starts ${JSON.stringify(gaps)}ms apart`,
    );
    verdict(
      "the timer keeps pulsing on its own",
      activations >= 2 &&
        finished.length >= 2 &&
        perSecond(advance.held, advance.heldMs) >
          perSecond(advance.released, advance.releasedMs) * 4,
      `${activations} pulses landed with nothing driving them, and the title advanced ` +
        `during them and not between them.`,
    );
    verdict(
      "each pulse ends by itself",
      holds.every(
        ms =>
          ms >= Number(HOLD) * 1000 - TICK_MS * 2 &&
          ms <= (Number(HOLD) + 1) * 1000 + TICK_MS * 2,
      ),
      `every sampled hold covered ${HOLD}s, within the 250ms sampling edge and ` +
        `one-second release pass.`,
    );

    const control = samples.map(reading => reading.byIndex(CONTROL));
    const other = samples.map(reading => reading.byIndex(OTHER));
    verdict(
      "only the allowlisted, unselected tab is touched",
      control.every(tab => tab.selected && tab.active) &&
        other.every(tab => !tab.active) &&
        samples.every(reading => !reading.byIndex(KEPT).selected),
      `the selected tab stayed selected and running, the pinned tab that is not on the ` +
        `allowlist was never activated, and the pulsed tab was never selected.`,
    );

    console.log("\n=== phase 3: set back to 0 while a pulse is running ===");
    const untilHeld = await sampleUntil(reading => reading.byIndex(KEPT).active, 12_000);
    await drainLogs();
    if (!untilHeld.at(-1).byIndex(KEPT).active) {
      throw new Error("no pulse to interrupt");
    }
    await client.execute(SET_PREF, ["zen.keep-loaded.freshen-seconds", "0"]);
    const released = await sampleUntil(reading => !reading.byIndex(KEPT).active, 4000);
    const offLines = await drainLogs();
    const afterOff = await sampleUntil(reading => reading.byIndex(KEPT).active, QUIET_MS);
    await drainLogs();
    const stayedOff = afterOff.every(reading => !reading.byIndex(KEPT).active);
    console.log(
      `  released after ${released.at(-1).at - released[0].at}ms, ` +
        `timers ${afterOff.at(-1).timers}, ` +
        `still inactive ${QUIET_MS}ms later: ${stayedOff}`,
    );
    verdict(
      "turning it off hands the docshell back and books nothing",
      !released.at(-1).byIndex(KEPT).active &&
        offLines.some(line => line === "freshness: off") &&
        stayedOff &&
        afterOff.at(-1).timers === 0,
      `the pulse was cut short, the docshell went inactive, and no pass came after it.`,
    );

    console.log("\n=== phase 3b: selection and unpin release per-tab resources ===");
    await client.execute(SET_PREF, ["zen.keep-loaded.freshen-seconds", EVERY]);
    const heldBeforeSelection = await sampleUntil(
      reading => reading.byIndex(KEPT).active,
      12_000,
    );
    if (!heldBeforeSelection.at(-1).byIndex(KEPT).active) {
      throw new Error("no pulse to interrupt with selection");
    }
    await client.execute(`gBrowser.selectedTab = window.__tabs[${KEPT}]; return true;`);
    const selectedResources = await sampleUntil(
      reading => reading.byIndex(KEPT).selected,
      4000,
    );
    const selectedResourceState = await client.execute(RESOURCE_SAMPLE, [KEPT]);
    verdict(
      "selection forgets the mod-owned claim without deactivating the user tab",
      selectedResources.at(-1).byIndex(KEPT).selected &&
        selectedResourceState.activeClaims === 0 &&
        selectedResourceState.socketListening === false,
      `selection left the docshell to the user while owned claims/listeners were ` +
        `released (claims ${selectedResourceState.activeClaims}, ` +
        `socket ${selectedResourceState.socketListening}).`,
    );

    await client.execute(
      `gBrowser.selectedTab = window.__tabs[${CONTROL}]; return true;`,
    );
    const heldAfterSelection = await sampleUntil(
      reading => reading.byIndex(KEPT).active,
      12_000,
    );
    if (!heldAfterSelection.at(-1).byIndex(KEPT).active) {
      throw new Error("selection release did not permit a later pulse");
    }
    await client.execute(`gBrowser.unpinTab(window.__tabs[${KEPT}]); return true;`);
    const unpinned = await sampleUntil(
      reading => !reading.byIndex(KEPT).pinned && !reading.byIndex(KEPT).active,
      4000,
    );
    const unpinnedResourceState = await client.execute(RESOURCE_SAMPLE, [KEPT]);
    verdict(
      "unpin releases the claim, listener, and docshell",
      !unpinned.at(-1).byIndex(KEPT).pinned &&
        !unpinned.at(-1).byIndex(KEPT).active &&
        unpinnedResourceState.activeClaims === 0 &&
        unpinnedResourceState.socketListening === false,
      `unpin left no owned claim/listener and the docshell inactive ` +
        `(claims ${unpinnedResourceState.activeClaims}, ` +
        `socket ${unpinnedResourceState.socketListening}).`,
    );
    await client.execute(`gBrowser.pinTab(window.__tabs[${KEPT}]); return true;`);

    console.log("\n=== phase 4: teardown while a pulse is running ===");
    await client.execute(SET_PREF, ["zen.keep-loaded.freshen-seconds", EVERY]);
    const heldAgain = await sampleUntil(reading => reading.byIndex(KEPT).active, 12_000);
    await drainLogs();
    if (!heldAgain.at(-1).byIndex(KEPT).active) {
      throw new Error("no pulse to tear down");
    }
    await client.execute(`gBrowser.removeTab(window.__tabs[${KEPT}]); return true;`);
    await wait(1000);
    const closeResourceState = await client.execute(RESOURCE_SAMPLE, [KEPT]);
    verdict(
      "close releases the active claim, socket listener, and application key",
      closeResourceState.activeClaims === 0 &&
        closeResourceState.socketListening !== true &&
        closeResourceState.wakeCandidates === 0 &&
        closeResourceState.keyRecords === 0,
      `closing the held tab left no owned resources ` +
        `(claims ${closeResourceState.activeClaims}, ` +
        `socket ${closeResourceState.socketListening}, ` +
        `wake keys ${closeResourceState.wakeCandidates}, ` +
        `application keys ${closeResourceState.keyRecords}) after the close settled.`,
    );
    const hooks = await client.execute(TEARDOWN, []);
    console.log(`  ran ${hooks} unload hook(s)`);
    const afterTeardown = await sampleUntil(
      reading => reading.byIndex(KEPT).active,
      QUIET_MS,
    );
    const teardownLines = await drainLogs();
    const last = afterTeardown.at(-1);
    console.log(`  timers ${last.timers}, live controller ${last.live}`);
    verdict(
      "teardown leaves nothing running",
      afterTeardown.every(reading => !reading.byIndex(KEPT).active) &&
        teardownLines.includes("unloaded") &&
        last.timers === 0 &&
        !last.live,
      `the held docshell was handed back, the timer is gone, and nothing re-activated ` +
        `it over the following ${QUIET_MS}ms.`,
    );

    const failed = results.filter(item => !item.ok);
    console.log(
      `\n${results.length - failed.length}/${results.length} checks passed` +
        (failed.length ? `: ${failed.map(item => item.name).join(", ")} failed` : ""),
    );
    if (failed.length) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`harness failed: ${error.stack ?? error.message}`);
    console.error(zen.output.join("").slice(-3000));
    process.exitCode = 1;
  } finally {
    await client?.quit();
    await zen.stop();
    server.stop();
    await rm(staging, { recursive: true, force: true });
  }
};

await main();
