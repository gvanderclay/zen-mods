/**
 * Why a pinned tab's *label* can stay stale even when its page is running.
 *
 * `_setTabLabel` (tabbrowser.js 2422) refuses outright:
 *
 *   if (!aTab._zenContentsVisible && !aTab._zenChangeLabelFlag &&
 *       !aTab._labelIsInitialTitle && !gZenWorkspaces.privateWindowOrDisabled &&
 *       !_zenChangeLabelFlag) return false;
 *
 * `on_TabOpen` (ZenWindowSync 1364) grants `_zenContentsVisible` to every tab the user
 * opens, which is why every probe so far — all of them `gBrowser.addTab` — saw labels
 * update happily. The restore path (313) grants it only when window sync is off, or to
 * tabs that are *not* pinned:
 *
 *   if (!gWindowSyncEnabled || (gSyncOnlyPinnedTabs && !tab.pinned))
 *     tab._zenContentsVisible = true;
 *
 * So a pinned tab that came back with the session starts life unable to change its own
 * label. This deletes the flag to reproduce that state exactly, and then asks what does
 * and does not put it right: a title change, a click, a reload, and the two levers a mod
 * could use.
 *
 * The page retitles unconditionally, unlike the Gmail-shaped one in probe-pulse: the
 * question here is what the parent process does with a title change, so the title has to
 * keep changing whether or not the docshell is running.
 */

import { createServer } from "node:http";
import { openMarionette } from "./marionette.mjs";
import { launchZen } from "./zen.mjs";

const SUBJECT = 1;
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
    url: `http://127.0.0.1:${server.address().port}/`,
    stop: () => server.close(),
  };
};

const OPEN = `
  const [url] = arguments;
  window.__tabs = [];
  for (let i = 0; i < 2; i++) {
    const tab = gBrowser.addTab(url, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    gBrowser.pinTab(tab);
    window.__tabs.push(tab);
  }
  gBrowser.selectedTab = window.__tabs[0];
  return window.__tabs.length;
`;

const READ = `
  const [index] = arguments;
  const tab = window.__tabs[index];
  const browser = tab.linkedPanel ? tab.linkedBrowser : null;
  return {
    at: Date.now(),
    title: browser?.contentTitle ?? null,
    label: tab.getAttribute("label"),
    fullLabel: tab._fullLabel ?? null,
    flag: tab._zenContentsVisible === true,
    changeFlag: tab._zenChangeLabelFlag === true,
    initialTitle: tab._labelIsInitialTitle === true,
    staticLabel: typeof tab.zenStaticLabel === "string" ? tab.zenStaticLabel : null,
    selected: tab.selected,
    active: browser?.docShellIsActive === true,
  };
`;

const PREFS = `
  return {
    windowSync: Services.prefs.getBoolPref("zen.window-sync.enabled", false),
    onlyPinned: Services.prefs.getBoolPref("zen.window-sync.sync-only-pinned-tabs", false),
    hasWindowSync: !!window.gZenWindowSync,
    privateOrDisabled: window.gZenWorkspaces?.privateWindowOrDisabled === true,
  };
`;

const DROP_FLAG = `
  const [index] = arguments;
  delete window.__tabs[index]._zenContentsVisible;
  delete window.__tabs[index]._labelIsInitialTitle;
  return window.__tabs[index]._zenContentsVisible === undefined;
`;

const SELECT = `
  const [index] = arguments;
  gBrowser.selectedTab = window.__tabs[index];
  return gBrowser.selectedTab === window.__tabs[index];
`;

const RELOAD = `
  const [index] = arguments;
  const tab = window.__tabs[index];
  tab.linkedBrowser.reloadWithFlags(
    Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE |
      Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_PROXY,
  );
  return true;
`;

const SET_TITLE = `
  const [index, withFlag] = arguments;
  const tab = window.__tabs[index];
  if (withFlag) {
    tab._zenChangeLabelFlag = true;
  }
  try {
    gBrowser.setTabTitle(tab);
  } finally {
    if (withFlag) {
      delete tab._zenChangeLabelFlag;
    }
  }
  return tab.getAttribute("label");
`;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [];
const verdict = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`  ${ok ? "→ YES" : "→ NO "}: ${detail}`);
};

/** Does the label track the title over `ms`, or does it sit still while the title moves? */
const watch = async (client, ms) => {
  const samples = [];
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
    samples.push(await client.execute(READ, [SUBJECT]));
    await wait(TICK_MS);
  }
  const first = samples[0];
  const last = samples.at(-1);
  const titleMoved = first.title !== last.title;
  const labelMoved = first.label !== last.label;
  console.log(
    `    title ${JSON.stringify(first.title)} → ${JSON.stringify(last.title)}, ` +
      `label ${JSON.stringify(first.label)} → ${JSON.stringify(last.label)} ` +
      `(_zenContentsVisible ${last.flag}, docshell ${last.active ? "on" : "off"})`,
  );
  return { titleMoved, labelMoved, first, last };
};

const main = async () => {
  const server = await startPageServer();
  const zen = await launchZen();
  let client;
  try {
    client = await openMarionette({ port: zen.port });
    await client.setScriptTimeout(60_000);
    await client.execute(OPEN, [server.url]);
    await wait(4000);

    const prefs = await client.execute(PREFS, []);
    console.log(`=== the flags in play ===`);
    console.log(`  zen.window-sync.enabled: ${prefs.windowSync}`);
    console.log(`  zen.window-sync.sync-only-pinned-tabs: ${prefs.onlyPinned}`);
    console.log(`  gZenWindowSync present: ${prefs.hasWindowSync}`);
    console.log(`  privateWindowOrDisabled: ${prefs.privateOrDisabled}`);
    const opened = await client.execute(READ, [SUBJECT]);
    console.log(
      `  a tab this probe just opened: _zenContentsVisible ${opened.flag}` +
        `, zenStaticLabel ${JSON.stringify(opened.staticLabel)}`,
    );

    console.log("\n=== phase 1: unselected, flag intact (a tab you opened yourself) ===");
    const intact = await watch(client, WATCH_MS);
    verdict(
      "an opened tab's label tracks its title in the background",
      intact.titleMoved && intact.labelMoved,
      `the label follows the page while the tab sits unselected.`,
    );

    console.log(
      "\n=== phase 2: same tab, flag dropped (a tab restored with the session) ===",
    );
    await client.execute(DROP_FLAG, [SUBJECT]);
    const dropped = await watch(client, WATCH_MS);
    verdict(
      "without the flag the label freezes",
      dropped.titleMoved && !dropped.labelMoved,
      `the page kept retitling and the tab label did not move — this is the stale title.`,
    );

    console.log("\n=== phase 3: click the tab ===");
    await client.execute(SELECT, [SUBJECT]);
    await wait(2000);
    const clicked = await watch(client, WATCH_MS);
    verdict(
      "selecting the tab un-freezes the label",
      clicked.labelMoved,
      `selecting it ${clicked.labelMoved ? "restored" : "did NOT restore"} label updates ` +
        `(_zenContentsVisible ${clicked.last.flag}).`,
    );

    console.log("\n=== phase 4: hard refresh, unselected and flagless ===");
    await client.execute(SELECT, [0]);
    await client.execute(DROP_FLAG, [SUBJECT]);
    await client.execute(RELOAD, [SUBJECT]);
    await wait(3000);
    const reloaded = await watch(client, WATCH_MS);
    verdict(
      "a reload does not fix it either",
      !reloaded.labelMoved,
      `bypass-cache reload left the label ${JSON.stringify(reloaded.last.label)} ` +
        `while the page was at ${JSON.stringify(reloaded.last.title)}.`,
    );

    console.log("\n=== phase 5: what a mod could do about it ===");
    const plain = await client.execute(SET_TITLE, [SUBJECT, false]);
    const afterPlain = await client.execute(READ, [SUBJECT]);
    console.log(
      `  setTabTitle alone:                 label ${JSON.stringify(plain)} ` +
        `vs title ${JSON.stringify(afterPlain.title)}`,
    );
    const forced = await client.execute(SET_TITLE, [SUBJECT, true]);
    const afterForced = await client.execute(READ, [SUBJECT]);
    console.log(
      `  setTabTitle with _zenChangeLabelFlag: label ${JSON.stringify(forced)} ` +
        `vs title ${JSON.stringify(afterForced.title)}`,
    );
    verdict(
      "the label can be repaired without touching _zenContentsVisible",
      afterForced.label === afterForced.title && afterForced.changeFlag === false,
      `_zenChangeLabelFlag around setTabTitle wrote the live title into the label, ` +
        `and the flag was left off afterwards.`,
    );

    const failed = results.filter(item => !item.ok);
    console.log(
      `\n${results.length - failed.length}/${results.length} checks as expected` +
        (failed.length ? `: ${failed.map(item => item.name).join(", ")} differed` : ""),
    );
  } catch (error) {
    console.error(`harness failed: ${error.stack ?? error.message}`);
    console.error(zen.output.join("").slice(-2000));
    process.exitCode = 1;
  } finally {
    await client?.quit();
    await zen.stop();
    server.stop();
  }
};

await main();
