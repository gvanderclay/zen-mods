/**
 * A page that opens a websocket, and a server that keeps traffic flowing over it.
 *
 * Deliberately dependency-free and local: the experiment needs frames arriving on a
 * known schedule, not a real service. The page counts what it receives into its own
 * title, which is the control — if the title never changes, the socket never worked
 * and a silent listener proves nothing.
 */

import { createHash } from "node:crypto";
import { createServer } from "node:http";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/**
 * `titleEveryMs` exists for the load test. A title change notifies the parent process
 * — it is what the mod's own liveness tracking watches — so a page retitling itself
 * thousands of times a second would be measured instead of the thing under test.
 */
const pageSource = ({ sendEveryMs, titleEveryMs }) => `<!doctype html>
<meta charset="utf-8">
<title>waiting</title>
<script>
  let received = 0;
  const ws = new WebSocket(location.origin.replace("http", "ws") + "/socket");
  ws.addEventListener("open", () => {
    document.title = "open 0";
    setInterval(() => ws.send("from-page"), ${sendEveryMs});
    ${titleEveryMs ? `setInterval(() => { document.title = "open " + received; }, ${titleEveryMs});` : ""}
  });
  ws.addEventListener("message", () => {
    received++;
    ${titleEveryMs ? "" : 'document.title = "open " + received;'}
  });
  ws.addEventListener("close", () => {
    document.title = "closed " + received;
  });
</script>`;

/** Server to client, so unmasked, and short enough for a two-byte header. */
const textFrame = payload => {
  const body = Buffer.from(payload, "utf8");
  return Buffer.concat([Buffer.from([0x81, body.length]), body]);
};

export const startWsServer = async ({
  intervalMs = 1000,
  framesPerTick = 1,
  sendEveryMs = 1500,
  titleEveryMs = 0,
} = {}) => {
  const live = new Set();
  const page = pageSource({ sendEveryMs, titleEveryMs });

  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(page);
  });

  server.on("upgrade", (request, socket) => {
    const key = request.headers["sec-websocket-key"] ?? "";
    const accept = createHash("sha1")
      .update(key + GUID)
      .digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        "",
      ].join("\r\n"),
    );
    live.add(socket);
    socket.on("close", () => live.delete(socket));
    socket.on("error", () => live.delete(socket));
    // The browser's frames are masked and uninteresting here: what matters is that
    // it sent them, which the listener under test reports as `frameSent`.
    socket.resume();
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let sent = 0;
  const timer = setInterval(() => {
    for (const socket of live) {
      for (let n = 0; n < framesPerTick; n++) {
        socket.write(textFrame(`tick ${sent++}`));
      }
    }
  }, intervalMs);

  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    sentFrames: () => sent,
    stop: () => {
      clearInterval(timer);
      for (const socket of live) {
        socket.destroy();
      }
      server.close();
    },
  };
};
