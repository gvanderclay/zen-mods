import { once } from "node:events";
import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { openMarionette } from "./marionette.mjs";

const frame = value => {
  const body = Buffer.from(JSON.stringify(value));
  return Buffer.concat([Buffer.from(`${body.length}:`, "ascii"), body]);
};

const protocolServer = async ({ ignoredCommands = [], silentHandshake = false } = {}) => {
  let peer;
  const ignored = new Set(ignoredCommands);
  const server = createServer(socket => {
    peer = socket;
    let buffer = Buffer.alloc(0);
    if (!silentHandshake) {
      socket.write(frame({ applicationType: "gecko", marionetteProtocol: 3 }));
    }
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
        if (ignored.has(name)) continue;
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

describe("live Marionette shutdown", () => {
  it("finishes immediately when the peer closed before quit", async () => {
    const server = await protocolServer();
    servers.push(server);
    const client = await openMarionette({ port: server.port });
    server.peer().destroy();
    await once(server.peer(), "close");

    await expect(client.quit()).resolves.toBeUndefined();
  });

  it("bounds quit when a live peer never acknowledges it", async () => {
    const server = await protocolServer({ ignoredCommands: ["Marionette:Quit"] });
    servers.push(server);
    const client = await openMarionette({
      port: server.port,
      quitTimeoutMilliseconds: 20,
    });

    const startedAt = performance.now();
    await client.quit();

    expect(performance.now() - startedAt).toBeLessThan(500);
  });

  it("bounds a silent accepted handshake", async () => {
    const server = await protocolServer({ silentHandshake: true });
    servers.push(server);
    const opening = openMarionette({
      port: server.port,
      timeoutMilliseconds: 20,
    }).then(
      () => ({ status: "resolved" }),
      error => ({ error, status: "rejected" }),
    );

    const outcome = await Promise.race([
      opening,
      new Promise(resolve => setTimeout(() => resolve({ status: "pending" }), 250)),
    ]);

    expect(outcome.status).toBe("rejected");
    expect(outcome.error.message).toMatch(/handshake.*timed out/i);
  });

  it("bounds a command that a connected peer never answers", async () => {
    const server = await protocolServer({
      ignoredCommands: ["WebDriver:ExecuteAsyncScript"],
    });
    servers.push(server);
    const client = await openMarionette({
      commandTimeoutMilliseconds: 20,
      port: server.port,
    });
    const command = client.executeAsync("return 1").then(
      () => ({ status: "resolved" }),
      error => ({ error, status: "rejected" }),
    );

    const outcome = await Promise.race([
      command,
      new Promise(resolve => setTimeout(() => resolve({ status: "pending" }), 250)),
    ]);

    expect(outcome.status).toBe("rejected");
    expect(outcome.error.message).toMatch(/ExecuteAsyncScript.*timed out/i);
    await client.quit();
  });
});
