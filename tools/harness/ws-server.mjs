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

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>waiting</title>
<script>
  let received = 0;
  const ws = new WebSocket(location.origin.replace("http", "ws") + "/socket");
  ws.addEventListener("open", () => {
    document.title = "open 0";
    setInterval(() => ws.send("from-page"), 1500);
  });
  ws.addEventListener("message", () => {
    document.title = "open " + ++received;
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

export const startWsServer = async () => {
  const live = new Set();

  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(PAGE);
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
  const timer = setInterval(() => {
    for (const socket of live) {
      socket.write(textFrame(`tick ${Date.now()}`));
    }
  }, 1000);

  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    stop: () => {
      clearInterval(timer);
      for (const socket of live) {
        socket.destroy();
      }
      server.close();
    },
  };
};
