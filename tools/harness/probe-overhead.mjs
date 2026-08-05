/**
 * How much parent-process main thread does the frame counting actually cost?
 *
 * The mod attaches a listener to every kept tab, so every websocket frame those tabs
 * exchange now crosses into JS on the thread that also draws the UI. That is the one
 * cost worth measuring rather than reasoning about, and the honest way to measure it
 * is to starve the thread and see how much less work it gets through.
 *
 * The monitor runs fixed chunks of arithmetic and counts how many complete in a fixed
 * window, yielding between them through `Services.tm.dispatchToMainThread` — not
 * `setTimeout`, whose nested calls Gecko clamps to 4ms, which would hide the cost in
 * idle time. Fewer chunks completed means the listener took the difference.
 *
 * Three phases in one run — no listener, listener, no listener again — so drift and a
 * warming JIT show up instead of being read as the result.
 *
 *     node tools/harness/probe-overhead.mjs
 */

import { openMarionette } from "./marionette.mjs";
import { startWsServer } from "./ws-server.mjs";
import { launchZen } from "./zen.mjs";

const WINDOW_MS = 4000;

/** ~4000 frames/second attempted, which no real app comes near — that is the point. */
const LOAD = { intervalMs: 5, framesPerTick: 20, sendEveryMs: 5, titleEveryMs: 500 };

const MEASURE = `
  const [windowMs] = arguments;
  const done = arguments[arguments.length - 1];
  const service = Cc["@mozilla.org/websocketevent/service;1"].getService(
    Ci.nsIWebSocketEventService
  );
  const browser = gBrowser.selectedTab.linkedBrowser;
  const id = browser.innerWindowID;

  // The listener under test, copied in shape from src/platform/sockets.ts: two integer
  // bumps and a clock read, no payload ever touched.
  const counts = { framesIn: 0, framesOut: 0, lastFrameAt: null };
  const bump = key => { counts[key]++; counts.lastFrameAt = Date.now(); };
  const listener = {
    webSocketCreated() {},
    webSocketOpened() {},
    webSocketMessageAvailable() {},
    webSocketClosed() {},
    frameReceived() { bump("framesIn"); },
    frameSent() { bump("framesOut"); },
  };

  const chunk = () => {
    let sum = 0;
    for (let i = 0; i < 120000; i++) { sum += i % 7; }
    return sum;
  };
  const yieldToLoop = () => new Promise(r => Services.tm.dispatchToMainThread(r));

  const sample = async ms => {
    const start = performance.now();
    let chunks = 0;
    let worstGap = 0;
    let last = start;
    while (performance.now() - start < ms) {
      chunk();
      await yieldToLoop();
      const now = performance.now();
      const gap = now - last;
      if (gap > worstGap) worstGap = gap;
      last = now;
      chunks++;
    }
    return { chunks, worstGap, elapsed: performance.now() - start };
  };

  (async () => {
    try {
      // Warm the JIT, or the first phase is slower for reasons that have nothing to
      // do with websockets and the whole comparison is noise.
      await sample(1000);

      const before = await sample(windowMs);

      service.addListener(id, listener);
      const registered = service.hasListenerFor(id);
      const during = await sample(windowMs);
      const frames = counts.framesIn + counts.framesOut;
      service.removeListener(id, listener);

      const after = await sample(windowMs);
      done({ id, registered, frames, counts, before, during, after,
             pageTitle: browser.contentTitle });
    } catch (error) {
      done({ failure: String(error) });
    }
  })();
`;

const OPEN_TAB = `
  const [url] = arguments;
  const tab = gBrowser.addTab(url, {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
  gBrowser.selectedTab = tab;
  return true;
`;

const rate = phase => (phase.chunks / phase.elapsed) * 1000;

const report = result => {
  const { before, during, after, frames } = result;
  const idle = (rate(before) + rate(after)) / 2;
  const loaded = rate(during);
  const lostShare = (idle - loaded) / idle;
  const framesPerSecond = frames / (during.elapsed / 1000);
  // Time the thread did not get, divided by the frames that took it. Negative or
  // near-zero means the cost is below what this monitor can resolve.
  const perFrameUs = ((lostShare * during.elapsed) / frames) * 1000;

  const lines = [
    `frames seen        ${frames} (${framesPerSecond.toFixed(0)}/second)`,
    `chunks/sec idle    ${rate(before).toFixed(1)} before, ${rate(after).toFixed(1)} after`,
    `chunks/sec loaded  ${loaded.toFixed(1)}`,
    `throughput lost    ${(lostShare * 100).toFixed(1)}%`,
    `cost per frame     ${perFrameUs.toFixed(1)}us of main thread`,
    `worst single stall ${before.worstGap.toFixed(1)}ms idle vs ${during.worstGap.toFixed(1)}ms loaded`,
  ];

  // A realistic kept tab is nowhere near this rate; the answer a person needs is what
  // the measured per-frame cost adds up to at a rate they might actually see.
  const atRate = perSecond =>
    `${perSecond}/s → ${((perFrameUs * perSecond) / 10_000).toFixed(3)}% of one core`;
  lines.push(`extrapolated       ${atRate(1)}, ${atRate(10)}, ${atRate(100)}`);
  return lines.join("\n");
};

const main = async () => {
  const server = await startWsServer(LOAD);
  const zen = await launchZen();
  let client;
  try {
    client = await openMarionette({ port: zen.port });
    await client.setScriptTimeout(WINDOW_MS * 4 + 40_000);
    await client.execute(OPEN_TAB, [server.url]);
    await new Promise(resolve => setTimeout(resolve, 2000));
    const result = await client.executeAsync(MEASURE, [WINDOW_MS]);
    if (!result || result.failure) {
      throw new Error(result?.failure ?? "the measurement returned nothing");
    }
    console.log(JSON.stringify(result, null, 2));
    console.log(`\n${report(result)}`);
    console.log(`\nserver sent ${server.sentFrames()} frames`);
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
