/**
 * Does the shipped bundle un-stick a restored pinned tab's label, and does it leave the
 * tabs it should alone?
 *
 * The restore state is reproduced the way `probe-label.mjs` established it: delete
 * `_zenContentsVisible`, and Zen refuses every label write for that tab from then on
 * (D028). Four pinned tabs, all retitling, differing only in what the mod should decide:
 *
 *   0  selected control        — Zen keeps its label itself
 *   1  kept, flagless          — the tab the repair is for
 *   2  kept, flagless, renamed — `zenStaticLabel` set: the user's name must survive
 *   3  flagless, not allowlisted — none of the mod's business
 *
 * Phase 1 watches all four with the mod *not* loaded, so the freeze is established before
 * anything is asked to fix it. Freshening stays off throughout: this half of the fix owes
 * nothing to the pulse, and the docshell reading proves it.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openMarionette } from "./marionette.mjs";
import { launchZen } from "./zen.mjs";

const BUNDLE = fileURLToPath(new URL("../../dist/keep-loaded.uc.mjs", import.meta.url));

const CONTROL = 0;
const SUBJECT = 1;
const RENAMED = 2;
const FOREIGN = 3;
const ALL = [CONTROL, SUBJECT, RENAMED, FOREIGN];
const RENAME = "Mail, as I named it";

const WATCH_MS = 4000;
const TICK_MS = 500;

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>t0</title>
<script>
  let n = 0;
  setInterval(() => { document.title = "t" + ++n; }, 400);
</script>`;

const startPageServer = async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(PAGE);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    stop: () => server.close(),
  };
};

const OPEN = `
  const [keepUrl, otherUrl, rename] = arguments;
  window.__tabs = [];
  for (const url of [keepUrl, keepUrl, keepUrl, otherUrl]) {
    const tab = gBrowser.addTab(url, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    gBrowser.pinTab(tab);
    window.__tabs.push(tab);
  }
  gBrowser.selectedTab = window.__tabs[0];
  window.__tabs[2].zenStaticLabel = rename;
  return window.__tabs.length;
`;

/** Exactly what a session restore leaves behind for a pinned tab. */
const RESTORE_STATE = `
  const [indexes] = arguments;
  for (const index of indexes) {
    delete window.__tabs[index]._zenContentsVisible;
    delete window.__tabs[index]._labelIsInitialTitle;
  }
  return indexes.length;
`;

const SAMPLE = `
  const [indexes] = arguments;
  const state = window.zenKeepLoaded || {};
  return {
    at: Date.now(),
    boot: window.__boot ?? null,
    logs: (window.__log || []).length,
    live: state.controller?.isLive() === true,
    tabs: indexes.map(index => {
      const tab = window.__tabs[index];
      const browser = tab.linkedPanel ? tab.linkedBrowser : null;
      return {
        index,
        title: browser?.contentTitle ?? null,
        label: tab.getAttribute("label"),
        flag: tab._zenContentsVisible === true,
        changeFlag: tab._zenChangeLabelFlag === true,
        staticLabel: typeof tab.zenStaticLabel === "string" ? tab.zenStaticLabel : null,
        selected: tab.selected,
        active: browser?.docShellIsActive === true,
      };
    }),
  };
`;

const SET_PREF = `
  const [name, value] = arguments;
  Services.prefs.setStringPref(name, value);
  return Services.prefs.getStringPref(name);
`;

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

const BOOT = `
  const [dirUrl, name] = arguments;
  const handler = Services.io
    .getProtocolHandler("resource")
    .QueryInterface(Ci.nsIResProtocolHandler);
  handler.setSubstitution("kltitles", Services.io.newURI(dirUrl));
  Services.scriptloader.loadSubScript("resource://kltitles/" + name, window);
  return window.__boot ?? "missing";
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
      reading.tab = index => reading.tabs.find(item => item.index === index);
      return reading;
    };
    const drainLogs = async () => {
      const lines = await client.execute(LOGS, [logsSeen]);
      logsSeen += lines.length;
      for (const { line } of lines) {
        console.log(`    | ${line}`);
      }
      return lines.map(entry => entry.line);
    };
    /** Which tabs' labels moved over the window, and which of them ended up correct. */
    const watch = async ms => {
      const first = await sample();
      await wait(ms);
      const last = await sample();
      const rows = ALL.map(index => ({
        index,
        moved: first.tab(index).label !== last.tab(index).label,
        matches: last.tab(index).label === last.tab(index).title,
        label: last.tab(index).label,
        title: last.tab(index).title,
        active: last.tab(index).active,
      }));
      for (const row of rows) {
        console.log(
          `    tab ${row.index}: label ${JSON.stringify(row.label)} ` +
            `${row.moved ? "moved" : "FROZEN"}, page at ${JSON.stringify(row.title)}` +
            `${row.active ? ", docshell on" : ""}`,
        );
      }
      return { rows, row: index => rows.find(item => item.index === index), first, last };
    };

    await client.execute(OPEN, [
      `${server.origin}/keep`,
      `${server.origin}/other`,
      RENAME,
    ]);
    await wait(4000);
    await client.execute(SET_PREF, ["zen.keep-loaded.match", "/keep"]);
    await client.execute(SET_PREF, ["zen.keep-loaded.freshen-seconds", "0"]);

    console.log("=== phase 1: restored state, mod not loaded ===");
    await client.execute(RESTORE_STATE, [[SUBJECT, RENAMED, FOREIGN]]);
    const before = await watch(WATCH_MS);
    verdict(
      "the freeze reproduces before the mod is loaded",
      !before.row(SUBJECT).moved &&
        !before.row(RENAMED).moved &&
        !before.row(FOREIGN).moved,
      `all three flagless tabs are stuck while their pages keep retitling.`,
    );

    console.log("\n=== phase 2: load the shipped bundle, freshening off ===");
    const source = await readFile(BUNDLE, "utf8");
    await writeFile(join(staging, "boot.js"), bootScript(source), "utf8");
    await client.execute(BOOT, [pathToFileURL(`${staging}/`).href, "boot.js"]);
    const deadline = Date.now() + 45_000;
    let booted = await sample();
    while (booted.boot === "pending" && Date.now() < deadline) {
      await wait(TICK_MS);
      booted = await sample();
    }
    console.log(`  boot: ${booted.boot}`);
    const bootLines = await drainLogs();
    if (booted.boot !== "ok") {
      throw new Error(`the bundle did not start: ${booted.boot}`);
    }
    const repaired = booted.tab(SUBJECT);
    verdict(
      "the startup sweep repairs a label nothing is going to send an event for",
      repaired.label === repaired.title &&
        bootLines.some(line => line.startsWith("titles: 1 relabelled")),
      `the kept tab's label caught up to ${JSON.stringify(repaired.title)} during the ` +
        `sweep, and the pass reported exactly one relabelled tab.`,
    );

    console.log("\n=== phase 3: the page keeps retitling ===");
    const live = await watch(WATCH_MS);
    await drainLogs();
    verdict(
      "the label keeps up from then on",
      live.row(SUBJECT).moved && live.row(SUBJECT).matches,
      `every title change reached the tab strip, with the tab unselected and its ` +
        `docshell ${live.last.tab(SUBJECT).active ? "ACTIVE" : "off"} — no pulse involved.`,
    );
    verdict(
      "a renamed tab is left as the user named it",
      !live.row(RENAMED).moved && live.last.tab(RENAMED).staticLabel === RENAME,
      `the tab with zenStaticLabel kept the label it had; the rename was never ` +
        `overwritten and never applied on the mod's behalf.`,
    );
    verdict(
      "a pinned tab off the allowlist is not touched",
      !live.row(FOREIGN).moved,
      `it is still frozen at ${JSON.stringify(live.row(FOREIGN).label)}.`,
    );
    verdict(
      "nothing is left on the tabs afterwards",
      ALL.every(index => !live.last.tab(index).changeFlag) &&
        !live.last.tab(SUBJECT).flag,
      `no _zenChangeLabelFlag survives a write, and _zenContentsVisible was never forged.`,
    );

    console.log("\n=== phase 4: teardown ===");
    const hooks = await client.execute(TEARDOWN, []);
    console.log(`  ran ${hooks} unload hook(s)`);
    await drainLogs();
    const after = await watch(WATCH_MS);
    verdict(
      "the listener goes with the mod",
      !after.row(SUBJECT).moved,
      `after teardown the label froze again, so nothing was left listening.`,
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
