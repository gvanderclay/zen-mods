/**
 * Answers the M04.C04a-D question without a human in the loop: does a listener added
 * from the *parent* process receive `frameReceived` for a content tab's websocket?
 *
 * Devtools attaches from the content process, nothing in the tree attaches from the
 * parent, and the service is C++ — so the only honest answer is a measurement.
 *
 * The page's own title is the control. If it never counts frames, the socket never
 * worked and a silent listener says nothing about the parent process.
 *
 *     node tools/harness/probe-sockets.mjs
 */

import { openMarionette } from "./marionette.mjs";
import { startWsServer } from "./ws-server.mjs";
import { launchZen } from "./zen.mjs";

const WATCH_MS = 6000;

const OPEN_TAB = `
  const [url] = arguments;
  const tab = gBrowser.addTab(url, {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
  gBrowser.selectedTab = tab;
  return true;
`;

const WATCH = `
  const [watchMs] = arguments;
  const done = arguments[arguments.length - 1];
  const service = Cc["@mozilla.org/websocketevent/service;1"].getService(
    Ci.nsIWebSocketEventService
  );
  const browser = gBrowser.selectedTab.linkedBrowser;
  const innerWindowID = browser.innerWindowID;
  const counts = { opened: 0, closed: 0, framesIn: 0, framesOut: 0 };
  const listener = {
    webSocketCreated() {},
    webSocketOpened() { counts.opened++; },
    webSocketMessageAvailable() {},
    webSocketClosed() { counts.closed++; },
    frameReceived() { counts.framesIn++; },
    frameSent() { counts.framesOut++; },
  };
  let registered = null;
  let failure = null;
  try {
    service.addListener(innerWindowID, listener);
    registered = service.hasListenerFor(innerWindowID);
  } catch (error) {
    failure = String(error);
  }
  setTimeout(() => {
    try {
      if (registered) {
        service.removeListener(innerWindowID, listener);
      }
    } catch (error) {
      failure = failure ?? String(error);
    }
    done({
      innerWindowID,
      registered,
      failure,
      counts,
      // The control: the page counts received frames into its own title.
      pageTitle: browser.contentTitle,
      currentURI: browser.currentURI.spec,
    });
  }, watchMs);
`;

const verdict = result => {
  const { counts, pageTitle, registered, failure } = result;
  const pageSaw = /^open (\d+)$/.exec(pageTitle ?? "");
  const pageFrames = pageSaw ? Number(pageSaw[1]) : 0;
  if (failure) {
    return `INCONCLUSIVE — the service refused the listener: ${failure}`;
  }
  if (!registered) {
    return "INCONCLUSIVE — addListener returned without registering anything";
  }
  if (!pageFrames) {
    return `INCONCLUSIVE — the page never received a frame either (title ${JSON.stringify(pageTitle)}), so the socket, not the listener, is what failed`;
  }
  if (counts.framesIn + counts.framesOut === 0) {
    return `NO — the page counted ${pageFrames} frame(s) while a parent-process listener saw none. C04b needs a content-side actor or the HTTP-activity fallback`;
  }
  return `YES — a parent-process listener saw ${counts.framesIn} in and ${counts.framesOut} out while the page counted ${pageFrames}. C04b can reload on evidence`;
};

const main = async () => {
  const server = await startWsServer();
  const zen = await launchZen();
  let client;
  try {
    client = await openMarionette({ port: zen.port });
    console.log(`marionette: ${JSON.stringify(client.hello)}`);
    await client.setScriptTimeout(WATCH_MS + 20_000);
    await client.execute(OPEN_TAB, [server.url]);
    // The socket has to be open before the listener is added, which is the harder
    // case: it means the probe cannot rely on catching the handshake.
    await new Promise(resolve => setTimeout(resolve, 3000));
    const result = await client.executeAsync(WATCH, [WATCH_MS]);
    console.log(JSON.stringify(result, null, 2));
    console.log(`\n${verdict(result)}`);
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
