/**
 * Why a kept tab's title can lag, and what can be written over it.
 *
 * The first suspect was Zen's own gate. `_setTabLabel` returns false before touching
 * the label unless `aTab._zenContentsVisible` is set (`tabbrowser.js` 2423), and
 * `ZenWindowSync.sys.mjs` 1043 calls that flag "the active tab, where the web contents
 * are being viewed" — which reads like every background tab. It is not: `on_TabOpen`
 * sets it on every tab this window opens (1364) and only *deletes* it when the tab's
 * docshell is handed to another window (1090, 1143, 1162). With one window it is always
 * true, so the gate is about multi-window sync, not about background tabs. Phase 3
 * closes it by hand anyway, because "always true" is a claim worth a reading.
 *
 * That conclusion is wrong, and `probe-label.mjs` is what corrects it: every tab here
 * comes from `gBrowser.addTab`, the one path that sets the flag (1364), so "always true"
 * is an artifact of how this probe opens its tabs. A pinned tab restored with the session
 * is never given it (`ZenWindowSync.sys.mjs` 313) and cannot change its own label at all
 * — see D028.
 *
 * That leaves throttling, which is the real question and has two very different
 * answers depending on how the page learns it has news:
 *
 *   - a timer (`setInterval`) is clamped in a background tab
 *   - a pushed websocket frame is not a timer
 *
 * Gmail is the second shape, so phase 1 measures a pushed title and phase 2 measures a
 * timed one, both against a visible tab as the control.
 *
 * Phase 4 asks which write can put a chosen string on a tab, and — the part that
 * decides whether a custom title is a feature or a flicker — whether it survives the
 * page's next retitle.
 *
 *     node tools/harness/probe-title.mjs
 */

import { createServer } from "node:http";
import { openMarionette } from "./marionette.mjs";
import { startWsServer } from "./ws-server.mjs";
import { launchZen } from "./zen.mjs";

/** One pushed frame per second, watched for six: enough ticks to see a clamp. */
const PUSH_EVERY_MS = 1000;
const PUSH_WATCH_MS = 6000;

/**
 * Fast enough that the 1s background clamp is unmistakable if it applies. The watch is
 * long by default because there are *two* clamps: `dom.min_background_timeout_value`
 * takes a background timer to 1/second immediately, and budget throttling
 * (`dom.timeout.enable_budget_timer_throttling`) can take it to one per
 * `dom.timeout.budget_throttling_max_delay` once the window has spent its budget. A
 * four-second window only ever sees the first, which is the difference between "a
 * second late" and "a quarter of a minute late".
 */
const TIMER_EVERY_MS = 250;
const TIMER_WATCH_MS = Number(process.argv[2] ?? 45_000);

const TIMER_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>timer 0</title>
<script>
  let n = 0;
  setInterval(() => { document.title = "timer " + ++n; }, ${TIMER_EVERY_MS});
</script>`;

const startTimerServer = async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(TIMER_PAGE);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}/`, stop: () => server.close() };
};

/**
 * Two tabs on the same url, one selected and one not. Both are pinned: that is the
 * mod's own subject, and it keeps Zen's pinned-tab manager in the picture.
 */
const OPEN_PAIR = `
  const [url, key] = arguments;
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
  window.__probe = window.__probe ?? {};
  window.__probe[key] = { visible, background };
  return {
    visibleContentsVisible: !!visible._zenContentsVisible,
    backgroundContentsVisible: !!background._zenContentsVisible,
  };
`;

/**
 * Counts label events per tab and reports each tab's label against its own
 * `contentTitle`. Those two disagreeing is a broken label pipeline; both being equally
 * behind a control is the page being throttled, which is a different problem with a
 * different fix.
 */
const WATCH = `
  const [key, watchMs] = arguments;
  const done = arguments[arguments.length - 1];
  const { visible, background } = window.__probe[key];
  const events = new Map();
  // Gaps, not just a count: a clamp that escalates partway through the watch is the
  // difference between a second late and fifteen, and an average hides it.
  const stamps = new Map();
  const startedAt = Date.now();
  const onAttr = event => {
    if (event.detail?.changed?.includes("label")) {
      events.set(event.target, (events.get(event.target) ?? 0) + 1);
      const at = Date.now() - startedAt;
      stamps.set(event.target, [...(stamps.get(event.target) ?? []), at]);
    }
  };
  document.addEventListener("TabAttrModified", onAttr);
  const gapsOf = tab => {
    const at = stamps.get(tab) ?? [];
    return at.slice(1).map((value, index) => value - at[index]);
  };
  const readingOf = tab => ({
    contentsVisible: !!tab._zenContentsVisible,
    label: tab.getAttribute("label"),
    contentTitle: tab.linkedBrowser?.contentTitle ?? null,
    labelEvents: events.get(tab) ?? 0,
    gapsMs: gapsOf(tab),
  });
  setTimeout(() => {
    document.removeEventListener("TabAttrModified", onAttr);
    done({
      elapsedMs: Date.now() - startedAt,
      visible: readingOf(visible),
      background: readingOf(background),
    });
  }, watchMs);
`;

/** Closes the gate by hand, to check it does what reading it suggests. */
const GATE_CLOSED = `
  const [key] = arguments;
  const done = arguments[arguments.length - 1];
  const tab = window.__probe[key].background;
  delete tab._zenContentsVisible;
  const before = { label: tab.getAttribute("label"), contentTitle: tab.linkedBrowser.contentTitle };
  setTimeout(() => {
    const during = { label: tab.getAttribute("label"), contentTitle: tab.linkedBrowser.contentTitle };
    // With the gate shut, does Zen's own escape hatch still write?
    let flagWrote = null;
    try {
      gBrowser._setTabLabel(tab, "PROBE gated", { isContentTitle: true, _zenChangeLabelFlag: true });
      flagWrote = tab.getAttribute("label") === "PROBE gated";
    } catch (error) {
      flagWrote = String(error);
    }
    tab._zenContentsVisible = true;
    done({ before, during, flagWrote });
  }, 2500);
`;

/**
 * Four writes, then a wait long enough for the page to retitle, because the only one
 * worth building on is a write the next content title does not undo.
 */
const WRITES = `
  const [key] = arguments;
  const done = arguments[arguments.length - 1];
  const tab = window.__probe[key].background;
  const results = [];
  const attempt = (name, apply) => {
    const before = tab.getAttribute("label");
    let threw = null;
    try {
      apply();
    } catch (error) {
      threw = String(error);
    }
    const after = tab.getAttribute("label");
    results.push({ name, threw, before, after, landed: after !== before });
  };

  attempt("_setTabLabel + _zenChangeLabelFlag", () => {
    gBrowser._setTabLabel(tab, "PROBE flag", { isContentTitle: true, _zenChangeLabelFlag: true });
  });
  attempt("setAttribute('label')", () => {
    tab.setAttribute("label", "PROBE attribute");
  });
  attempt("zenStaticLabel + setTabTitle", () => {
    tab.zenStaticLabel = "PROBE static";
    gBrowser.setTabTitle(tab);
  });

  // Does the static label survive the page retitling under it?
  setTimeout(() => {
    const survived = {
      label: tab.getAttribute("label"),
      contentTitle: tab.linkedBrowser.contentTitle,
      staticStillSet: tab.zenStaticLabel ?? null,
    };
    // And is it undone by clearing the property, the way Zen's rename UI clears it?
    delete tab.zenStaticLabel;
    gBrowser.setTabTitle(tab);
    const cleared = { label: tab.getAttribute("label"), contentTitle: tab.linkedBrowser.contentTitle };
    done({ results, survived, cleared });
  }, 2500);
`;

const countOf = (title, prefix) => {
  const match = new RegExp(`^${prefix} (\\d+)$`).exec(title ?? "");
  return match ? Number(match[1]) : null;
};

const report = (name, watch, prefix, control) => {
  const lines = [`=== ${name} ===`];
  for (const which of ["visible", "background"]) {
    const r = watch[which];
    lines.push(
      `  ${which.padEnd(10)} label=${JSON.stringify(r.label ?? "").padEnd(14)} contentTitle=${JSON.stringify(r.contentTitle ?? "").padEnd(14)} labelEvents=${String(r.labelEvents).padStart(3)} pipeline=${r.label === r.contentTitle ? "in sync" : "STALE"}`,
    );
  }
  const seen = {
    visible: countOf(watch.visible.contentTitle, prefix),
    background: countOf(watch.background.contentTitle, prefix),
  };
  lines.push(
    `  page reached: visible ${seen.visible}, background ${seen.background}${control ? ` (server pushed ${control})` : ""} over ${watch.elapsedMs}ms`,
  );
  if (seen.visible !== null && seen.background !== null) {
    const ratio = seen.background === 0 ? Infinity : seen.visible / seen.background;
    lines.push(
      seen.background >= seen.visible * 0.8
        ? `  → background kept up (${ratio.toFixed(2)}x). Not throttled.`
        : `  → background ran ${ratio.toFixed(2)}x slower than the visible tab. Throttled.`,
    );
  }
  const gaps = watch.background.gapsMs ?? [];
  if (gaps.length) {
    lines.push(
      `  background gaps between label events (ms): ${gaps.join(", ")}`,
      `  worst gap: ${Math.max(...gaps)}ms — that is how late the title can be`,
    );
  }
  return lines.join("\n");
};

const main = async () => {
  const push = await startWsServer({ intervalMs: PUSH_EVERY_MS, sendEveryMs: 3_600_000 });
  const timer = await startTimerServer();
  const zen = await launchZen();
  let client;
  try {
    client = await openMarionette({ port: zen.port });
    await client.setScriptTimeout(TIMER_WATCH_MS + 30_000);

    // Phase 1 — a pushed title. Gmail's shape.
    console.log(
      `gate at open: ${JSON.stringify(await client.execute(OPEN_PAIR, [push.url, "push"]))}`,
    );
    await new Promise(resolve => setTimeout(resolve, 2000));
    const pushWatch = await client.executeAsync(WATCH, ["push", PUSH_WATCH_MS]);
    console.log(
      `\n${report("phase 1: pushed title (websocket frame)", pushWatch, "open", Math.floor(PUSH_WATCH_MS / PUSH_EVERY_MS))}`,
    );

    // Phase 2 — a timed title, same measurement.
    await client.execute(OPEN_PAIR, [timer.url, "timer"]);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const timerWatch = await client.executeAsync(WATCH, ["timer", TIMER_WATCH_MS]);
    console.log(`\n${report("phase 2: timed title (setInterval)", timerWatch, "timer")}`);

    // Phase 3 — the gate, shut by hand.
    const gate = await client.executeAsync(GATE_CLOSED, ["timer"]);
    console.log(`\n=== phase 3: gate closed by hand ===`);
    console.log(JSON.stringify(gate, null, 2));
    console.log(
      gate.during.label === gate.before.label &&
        gate.during.contentTitle !== gate.before.contentTitle
        ? "  → the gate does freeze the label. It just is not shut in a single window."
        : "  → the label moved with the gate shut, so something else re-opened it.",
    );

    // Phase 4 — what can be written, and what survives.
    const writes = await client.executeAsync(WRITES, ["timer"]);
    console.log(`\n=== phase 4: writing a chosen label ===`);
    console.log(JSON.stringify(writes, null, 2));
  } catch (error) {
    console.error(`harness failed: ${error.message}`);
    console.error(zen.output.join("").slice(-2000));
    process.exitCode = 1;
  } finally {
    await client?.quit();
    await zen.stop();
    timer.stop();
    push.stop();
  }
};

await main();
