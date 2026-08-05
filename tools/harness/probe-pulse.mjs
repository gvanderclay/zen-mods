/**
 * Does the shipped pulse actually un-stick a title, and does it let go again?
 *
 * `probe-freshness.mjs` measured the lever by hand: `docShellIsActive = true` on an
 * unselected tab takes the page from 0.2 to 115.8 animation frames a second and flips
 * `visibilityState` to `"visible"`. This drives the *decision that ships* — the real
 * `pulseStep` from `src/core/freshness.ts`, imported here rather than reimplemented — in
 * a real browser, so the unit tests and the browser are known to agree.
 *
 * The page is shaped like Gmail rather than like a benchmark: its timer keeps firing in
 * the background, and it *chooses* not to retitle while `visibilityState` is not
 * `"visible"`. That is the behaviour no parent-process work can reach, and the only
 * reason a pulse is worth its cost.
 *
 * Five phases, and the last two are the ones that would bite in daily use:
 *
 *   1. left alone, the unselected tab's title is frozen
 *   2. pulsed, it advances during each hold and stops between them
 *   3. selected mid-hold, the pulse lets go without deactivating anything
 *   4. activated by somebody else, the pulse never claims it
 *   5. turned off, every docshell the pulse held is handed back
 *
 *     node tools/harness/probe-pulse.mjs
 */

import { createServer } from "node:http";
import { parsePulseSettings, pulseStep } from "../../src/core/freshness.ts";
import { openMarionette } from "./marionette.mjs";
import { launchZen } from "./zen.mjs";

/** Short so a run is short. The shipped default is off; a real setting would be minutes. */
const EVERY = "8";
const HOLD = "3";
const TICK_MS = 500;
const CYCLES_MS = 25_000;
const BASELINE_MS = 6000;
const SETTLE_MS = 4000;

/** Which tab is which. 0 is the control the user is looking at. */
const PULSED = 1;
const FOREIGN = 2;
const KEPT = [PULSED, FOREIGN];

/**
 * Gmail's shape: the timer never stops, but the work behind the title is skipped while
 * the page believes nobody is looking. A page that retitled unconditionally would show
 * a pulse working when it had changed nothing.
 */
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
  return { url: `http://127.0.0.1:${port}/`, stop: () => server.close() };
};

const OPEN = `
  const [url, count] = arguments;
  window.__pulse = [];
  for (let i = 0; i < count; i++) {
    const tab = gBrowser.addTab(url, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    gBrowser.pinTab(tab);
    window.__pulse.push(tab);
  }
  gBrowser.selectedTab = window.__pulse[0];
  return window.__pulse.length;
`;

/** The same reads `platform/browser.ts` does, in the same order, for the same reasons. */
const FACTS = `
  const [indexes] = arguments;
  return indexes.map(index => {
    const tab = window.__pulse[index];
    const browser = tab.linkedPanel ? tab.linkedBrowser : null;
    return {
      index,
      url: "tab " + index,
      pending: tab.hasAttribute("pending"),
      selected: tab.selected,
      active: browser?.docShellIsActive === true,
      title: browser?.contentTitle ?? null,
      label: tab.getAttribute("label"),
    };
  });
`;

const SET_ACTIVE = `
  const [index, active] = arguments;
  const tab = window.__pulse[index];
  const browser = tab.linkedPanel ? tab.linkedBrowser : null;
  if (!browser || !("docShellIsActive" in browser)) {
    return false;
  }
  browser.docShellIsActive = active;
  return true;
`;

const SELECT = `
  const [index] = arguments;
  gBrowser.selectedTab = window.__pulse[index];
  return gBrowser.selectedTab === window.__pulse[index];
`;

const counterOf = title => {
  const match = /^quiet (\d+)$/.exec(title ?? "");
  return match ? Number(match[1]) : null;
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * One tick of the loop `main.ts` runs on an interval: read the facts, ask the core
 * module, carry out what it said. The bookkeeping is the same `WeakMap` contents, keyed
 * on the tab index instead of the tab.
 */
const makeTicker = (client, settings) => {
  const records = new Map();
  const recordOf = index => records.get(index) ?? { heldSince: null, lastPulseAt: null };

  /** `now` is the tick's own clock, exactly as `pulseOnce` reads it once per pass. */
  const tick = async (override = settings) => {
    const now = Date.now();
    const readings = await client.execute(FACTS, [[0, ...KEPT]]);
    const steps = [];
    for (const reading of readings) {
      const { heldSince, lastPulseAt } = recordOf(reading.index);
      const step = pulseStep(
        { ...reading, kept: KEPT.includes(reading.index), heldSince, lastPulseAt },
        override,
        now,
      );
      if (step.action === "activate") {
        await client.execute(SET_ACTIVE, [reading.index, true]);
        records.set(reading.index, { heldSince: now, lastPulseAt: now });
      } else if (step.action === "release") {
        await client.execute(SET_ACTIVE, [reading.index, false]);
        records.set(reading.index, { heldSince: null, lastPulseAt });
      } else if (step.action === "forget") {
        records.set(reading.index, { heldSince: null, lastPulseAt });
      }
      steps.push({ reading, step });
    }
    return steps;
  };

  return { tick, recordOf, records };
};

/** Advance in the page's own counter, split by whether the pulse was holding the tab. */
const advance = samples => {
  const totals = { held: 0, heldMs: 0, released: 0, releasedMs: 0 };
  for (let i = 1; i < samples.length; i++) {
    const from = samples[i - 1];
    const to = samples[i];
    if (from.counter === null || to.counter === null) {
      continue;
    }
    const key = from.held ? "held" : "released";
    totals[key] += to.counter - from.counter;
    totals[`${key}Ms`] += to.at - from.at;
  }
  return totals;
};

const perSecond = (count, ms) => (ms ? (count / ms) * 1000 : 0);

const main = async () => {
  const server = await startPageServer();
  const zen = await launchZen();
  let client;
  try {
    client = await openMarionette({ port: zen.port });
    await client.setScriptTimeout(60_000);
    await client.execute(OPEN, [server.url, 3]);
    await wait(SETTLE_MS);

    const off = parsePulseSettings("0", HOLD);
    const on = parsePulseSettings(EVERY, HOLD);
    console.log(`settings: ${JSON.stringify(on)} (from "${EVERY}" and "${HOLD}")`);

    // Phase 1 — the complaint itself, with the pulse turned off.
    console.log("\n=== phase 1: unselected and left alone ===");
    const idle = makeTicker(client, off);
    const idleSamples = [];
    for (let elapsed = 0; elapsed < BASELINE_MS; elapsed += TICK_MS) {
      const steps = await idle.tick();
      const mine = steps.find(item => item.reading.index === PULSED);
      idleSamples.push({
        at: Date.now(),
        counter: counterOf(mine.reading.title),
        held: false,
      });
      await wait(TICK_MS);
    }
    const idleAdvance = advance(idleSamples);
    console.log(
      `  title went ${JSON.stringify(idleSamples[0].counter)} → ${JSON.stringify(idleSamples.at(-1).counter)} over ${BASELINE_MS}ms — ${perSecond(idleAdvance.released, idleAdvance.releasedMs).toFixed(2)} retitles/s`,
    );

    // Phase 2 — the same tab, pulsed by the shipped decision.
    console.log(`\n=== phase 2: pulsed ${HOLD}s every ${EVERY}s ===`);
    const pulse = makeTicker(client, on);
    const samples = [];
    const startedAt = Date.now();
    while (Date.now() - startedAt < CYCLES_MS) {
      const steps = await pulse.tick();
      const mine = steps.find(item => item.reading.index === PULSED);
      const held = pulse.recordOf(PULSED).heldSince !== null;
      samples.push({
        at: Date.now(),
        counter: counterOf(mine.reading.title),
        selected: mine.reading.selected,
        held,
      });
      if (mine.step.action !== "skip") {
        console.log(
          `  +${String(Date.now() - startedAt).padStart(5)}ms ${mine.step.action.padEnd(8)} ${mine.step.reason}`,
        );
      }
      await wait(TICK_MS);
    }
    const pulsed = advance(samples);
    console.log(
      `\n  while held:     ${pulsed.held} retitles over ${pulsed.heldMs}ms — ${perSecond(pulsed.held, pulsed.heldMs).toFixed(2)}/s`,
    );
    console.log(
      `  while released: ${pulsed.released} retitles over ${pulsed.releasedMs}ms — ${perSecond(pulsed.released, pulsed.releasedMs).toFixed(2)}/s`,
    );
    const everSelected = samples.some(sample => sample.selected);
    console.log(
      perSecond(pulsed.held, pulsed.heldMs) >
        perSecond(pulsed.released, pulsed.releasedMs) * 4
        ? `  → YES: the page retitles during the pulse and stops between pulses, ${everSelected ? "but the tab was selected at some point" : "with the tab never selected"}.`
        : "  → NO: pulsing did not change how often the page retitled.",
    );

    // Phase 3 — the guard that matters most: the user clicks the tab mid-pulse.
    //
    // The reset is load-bearing, and the first run of this probe learned it the hard
    // way: each ticker starts with an empty ledger, which is the state a mod reload
    // leaves behind, and phase 2 ended mid-pulse. A fresh ledger looking at a docshell
    // that is already active refuses to claim it — correctly, since it cannot tell our
    // own leftover from Zen's split view. So hand the tab back before measuring.
    await client.execute(SET_ACTIVE, [PULSED, false]);
    await wait(1000);

    console.log("\n=== phase 3: selected while held ===");
    const guard = makeTicker(client, on);
    await guard.tick(); // activates
    const heldNow = guard.recordOf(PULSED).heldSince !== null;
    await client.execute(SELECT, [PULSED]);
    await wait(1000);
    const afterSelect = (await guard.tick()).find(item => item.reading.index === PULSED);
    const stillActive = (await client.execute(FACTS, [[PULSED]]))[0].active;
    console.log(`  held before the click: ${heldNow}`);
    console.log(`  step: ${afterSelect.step.action} — ${afterSelect.step.reason}`);
    console.log(`  docShellIsActive afterwards: ${stillActive}`);
    console.log(
      afterSelect.step.action === "forget" && stillActive
        ? "  → YES: it let go of the claim and left the visible tab running."
        : "  → NO: the selected tab was not left alone.",
    );
    await client.execute(SELECT, [0]);
    await wait(1000);

    // Phase 4 — somebody else's docshell. Split view and picture-in-picture do this.
    console.log("\n=== phase 4: activated by somebody else ===");
    await client.execute(SET_ACTIVE, [FOREIGN, true]);
    const foreign = (await guard.tick()).find(item => item.reading.index === FOREIGN);
    console.log(`  step: ${foreign.step.action} — ${foreign.step.reason}`);
    console.log(`  claimed: ${guard.recordOf(FOREIGN).heldSince !== null}`);
    console.log(
      foreign.step.action === "skip" && guard.recordOf(FOREIGN).heldSince === null
        ? "  → YES: never claimed, so it will never be deactivated on somebody else's behalf."
        : "  → NO: the pulse claimed a docshell it did not activate.",
    );
    await client.execute(SET_ACTIVE, [FOREIGN, false]);

    // Phase 5 — turning it off, which is the same pass teardown runs.
    await client.execute(SET_ACTIVE, [PULSED, false]);
    await wait(1000);

    console.log("\n=== phase 5: turned off ===");
    const stop = makeTicker(client, on);
    await stop.tick();
    console.log(`  held: ${stop.recordOf(PULSED).heldSince !== null}`);
    const finalStep = (await stop.tick(off)).find(item => item.reading.index === PULSED);
    const leftBehind = (await client.execute(FACTS, [[PULSED]]))[0].active;
    console.log(`  step: ${finalStep.step.action} — ${finalStep.step.reason}`);
    console.log(`  docShellIsActive afterwards: ${leftBehind}`);
    console.log(
      finalStep.step.action === "release" && !leftBehind
        ? "  → YES: nothing is left painting after the pulse is turned off."
        : "  → NO: a docshell stayed active with pulsing off.",
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
