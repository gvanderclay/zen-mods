/**
 * Can a kept tab be made to keep working while nobody is looking at it?
 *
 * `probe-title.mjs` established that the label pipeline is not the problem: a pushed
 * title reaches a background tab's label within a second. So a title that is stale for
 * minutes means the *page* stopped updating `document.title`, and the reason a page
 * stops is that Firefox tells it nobody is watching:
 *
 *   - `browser.docShellIsActive = false` on the tab you switch away from
 *     (`tabbrowser.js` 1800), which is what drives `document.visibilityState`
 *   - `requestAnimationFrame` is suspended outright in an inactive docshell
 *   - `setInterval` is clamped to 1/second (measured: 44 consecutive ~1003ms gaps)
 *
 * An app that renders through rAF, or that checks `visibilityState` before refreshing,
 * therefore goes quiet — and no amount of parent-process work fixes that, because the
 * decision is inside the page.
 *
 * So this measures the one lever that changes the page's own mind: setting
 * `docShellIsActive = true` on a tab that is not selected. Three things have to be true
 * for it to be usable, and each is a phase here: the page has to come back to life, the
 * tab has to still look unselected, and the flag has to stay set.
 *
 * Phase 4 prices it, because "keep painting a tab forever" is exactly the kind of fix
 * that trades a stale title for a hot laptop.
 *
 *     node tools/harness/probe-freshness.mjs
 */

import { createServer } from "node:http";
import { openMarionette } from "./marionette.mjs";
import { launchZen } from "./zen.mjs";

const SETTLE_MS = 5000;
const WATCH_MS = 5000;

/**
 * Reports three things in its own title: how many animation frames it has been given,
 * how many timer ticks it has run, and what it believes its visibility to be. The timer
 * writes the title, so the title arrives at the timer's rate — clamped or not — while
 * the rAF counter says whether the page was allowed to render at all.
 */
const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>init</title>
<script>
  let raf = 0;
  let tick = 0;
  requestAnimationFrame(function loop() { raf++; requestAnimationFrame(loop); });
  setInterval(() => {
    document.title = "raf " + raf + " tick " + ++tick + " " + document.visibilityState;
  }, 250);
</script>`;

const startPageServer = async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(PAGE);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}/`, stop: () => server.close() };
};

const OPEN_PAIR = `
  const [url] = arguments;
  const open = () => {
    const tab = gBrowser.addTab(url, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    gBrowser.pinTab(tab);
    return tab;
  };
  const visible = open();
  const background = open();
  gBrowser.selectedTab = visible;
  window.__fresh = { visible, background };
  return true;
`;

const READ = `
  const done = arguments[arguments.length - 1];
  const { visible, background } = window.__fresh;
  const readingOf = tab => ({
    title: tab.linkedBrowser?.contentTitle ?? null,
    label: tab.getAttribute("label"),
    selected: tab.selected,
    docShellIsActive: (() => {
      try {
        return tab.linkedBrowser.docShellIsActive;
      } catch (error) {
        return String(error);
      }
    })(),
  });
  done({ visible: readingOf(visible), background: readingOf(background) });
`;

/** Flips the lever on the *unselected* tab and reports whether it took. */
const ACTIVATE = `
  const done = arguments[arguments.length - 1];
  const tab = window.__fresh.background;
  let threw = null;
  try {
    tab.linkedBrowser.docShellIsActive = true;
  } catch (error) {
    threw = String(error);
  }
  done({
    threw,
    readBack: (() => {
      try {
        return tab.linkedBrowser.docShellIsActive;
      } catch (error) {
        return String(error);
      }
    })(),
    stillUnselected: !tab.selected,
    // If activating a background tab quietly makes Zen treat it as shown, that is a
    // much bigger side effect than a stale title.
    contentsVisible: !!tab._zenContentsVisible,
  });
`;

/**
 * Does the flag survive the things that would undo it? Selecting another tab is the
 * obvious one: `tabbrowser.js` 1800 deactivates the tab being left, and nothing there
 * reactivates a third tab — but `shouldActivateDocShell` (847, 8300) runs on other
 * paths, so this is measured rather than reasoned.
 */
const SURVIVES_SWITCH = `
  const done = arguments[arguments.length - 1];
  const { visible, background } = window.__fresh;
  const other = gBrowser.addTab("about:blank", {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
  gBrowser.selectedTab = other;
  setTimeout(() => {
    gBrowser.selectedTab = visible;
    setTimeout(() => {
      done({
        backgroundStillActive: background.linkedBrowser.docShellIsActive,
        backgroundTitle: background.linkedBrowser.contentTitle,
        backgroundSelected: background.selected,
      });
    }, 1200);
  }, 1200);
`;

const parse = title => {
  const match = /^raf (\d+) tick (\d+) (\w+)$/.exec(title ?? "");
  return match
    ? { raf: Number(match[1]), tick: Number(match[2]), visibility: match[3] }
    : null;
};

const rates = (before, after, elapsedMs) => {
  const from = parse(before);
  const to = parse(after);
  if (!from || !to) {
    return null;
  }
  const seconds = elapsedMs / 1000;
  return {
    rafPerSecond: (to.raf - from.raf) / seconds,
    ticksPerSecond: (to.tick - from.tick) / seconds,
    visibility: to.visibility,
  };
};

const describe = (name, reading) => {
  const parsed = parse(reading.title);
  return `  ${name.padEnd(11)} ${JSON.stringify(reading.title ?? "")} docShellIsActive=${reading.docShellIsActive} selected=${reading.selected}${parsed ? ` (visibility ${parsed.visibility})` : ""}`;
};

const main = async () => {
  const server = await startPageServer();
  const zen = await launchZen();
  let client;
  try {
    client = await openMarionette({ port: zen.port });
    await client.setScriptTimeout(60_000);
    await client.execute(OPEN_PAIR, [server.url]);
    await new Promise(resolve => setTimeout(resolve, SETTLE_MS));

    console.log("=== phase 1: a background tab, left alone ===");
    const asleep = await client.executeAsync(READ);
    console.log(describe("visible", asleep.visible));
    console.log(describe("background", asleep.background));

    await new Promise(resolve => setTimeout(resolve, WATCH_MS));
    const asleepAgain = await client.executeAsync(READ);
    const idle = rates(asleep.background.title, asleepAgain.background.title, WATCH_MS);
    const control = rates(asleep.visible.title, asleepAgain.visible.title, WATCH_MS);
    console.log(
      `\n  over ${WATCH_MS}ms — background: ${idle ? `${idle.rafPerSecond.toFixed(1)} rAF/s, ${idle.ticksPerSecond.toFixed(1)} ticks/s, ${idle.visibility}` : "unparsed"}`,
    );
    console.log(
      `  control (visible): ${control ? `${control.rafPerSecond.toFixed(1)} rAF/s, ${control.ticksPerSecond.toFixed(1)} ticks/s, ${control.visibility}` : "unparsed"}`,
    );

    console.log("\n=== phase 2: flip docShellIsActive on the unselected tab ===");
    const activated = await client.executeAsync(ACTIVATE);
    console.log(JSON.stringify(activated, null, 2));

    const before = await client.executeAsync(READ);
    await new Promise(resolve => setTimeout(resolve, WATCH_MS));
    const after = await client.executeAsync(READ);
    const woken = rates(before.background.title, after.background.title, WATCH_MS);
    console.log(
      `\n  over ${WATCH_MS}ms — background: ${woken ? `${woken.rafPerSecond.toFixed(1)} rAF/s, ${woken.ticksPerSecond.toFixed(1)} ticks/s, ${woken.visibility}` : "unparsed"}`,
    );
    console.log(describe("background", after.background));

    if (idle && woken) {
      const verdict =
        woken.visibility === "visible" && woken.ticksPerSecond > idle.ticksPerSecond * 1.5
          ? `YES — the page came back to life: ${idle.ticksPerSecond.toFixed(1)} → ${woken.ticksPerSecond.toFixed(1)} ticks/s and visibilityState went ${idle.visibility} → ${woken.visibility}, with the tab still unselected.`
          : `NO — flipping the flag did not change what the page does (${idle.ticksPerSecond.toFixed(1)} → ${woken.ticksPerSecond.toFixed(1)} ticks/s, ${idle.visibility} → ${woken.visibility}).`;
      console.log(`\n  ${verdict}`);
      console.log(
        `  cost: ${woken.rafPerSecond.toFixed(1)} animation frames/s that a background tab would otherwise not be given.`,
      );
    }

    console.log("\n=== phase 3: does the flag survive a tab switch? ===");
    console.log(JSON.stringify(await client.executeAsync(SURVIVES_SWITCH), null, 2));
  } catch (error) {
    console.error(`harness failed: ${error.message}`);
    console.error(zen.output.join("").slice(-2000));
    process.exitCode = 1;
  } finally {
    await client?.quit();
    await zen.stop();
    server.stop();
  }
};

await main();
