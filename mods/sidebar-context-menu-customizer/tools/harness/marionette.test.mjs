import { once } from "node:events";
import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { openMarionette } from "./marionette.mjs";

const frame = value => {
  const body = Buffer.from(JSON.stringify(value));
  return Buffer.concat([Buffer.from(`${body.length}:`, "ascii"), body]);
};

const protocolServer = async ({ ignoreQuit = false } = {}) => {
  let peer;
  const server = createServer(socket => {
    peer = socket;
    let buffer = Buffer.alloc(0);
    socket.write(frame({ applicationType: "gecko", marionetteProtocol: 3 }));
    socket.on("data", chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const colon = buffer.indexOf(0x3a);
        if (colon < 0) return;
        const length = Number(buffer.subarray(0, colon).toString("ascii"));
        const end = colon + 1 + length;
        if (buffer.length < end) return;
        const [, id, name] = JSON.parse(buffer.subarray(colon + 1, end).toString("utf8"));
        buffer = buffer.subarray(end);
        if (name === "Marionette:Quit" && ignoreQuit) continue;
        socket.write(frame([1, id, null, { value: null }]));
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    peer: () => peer,
    port: server.address().port,
    close: async () => {
      peer?.destroy();
      server.close();
      await once(server, "close");
    },
  };
};

const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => server.close()));
});

describe("Marionette shutdown", () => {
  it("finishes immediately when the peer closed before quit", async () => {
    const server = await protocolServer();
    servers.push(server);
    const client = await openMarionette({ port: server.port });
    server.peer().destroy();
    await once(server.peer(), "close");

    await expect(client.quit()).resolves.toBeUndefined();
  });

  it("bounds quit when a live peer never acknowledges it", async () => {
    const server = await protocolServer({ ignoreQuit: true });
    servers.push(server);
    const client = await openMarionette({
      port: server.port,
      quitTimeoutMilliseconds: 20,
    });

    const startedAt = performance.now();
    await client.quit();

    expect(performance.now() - startedAt).toBeLessThan(500);
  });
});
