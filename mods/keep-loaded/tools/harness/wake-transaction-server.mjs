/** A dependency-free HTTP fixture that can keep exact SessionStore restores open. */

import { createServer } from "node:http";

const json = (response, status, value) => {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(value)}\n`);
};

const numericId = pathname => {
  const match = pathname.match(/^\/(?:control\/release|hold)\/(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : null;
};

/**
 * Start the loopback server used by the production wake-transaction probe.
 *
 * `/hold/<id>` sends a real remote document response but deliberately leaves it
 * open until `/control/release/<id>` (or `/control/release-all`) is requested.
 * `/control/snapshot` is the browser-side evidence that a queued restore has not
 * reached the network yet. `/fast/<id>` completes immediately.
 */
export const startWakeTransactionServer = async () => {
  const events = [];
  const held = new Map();
  const released = new Set();
  let sequence = 0;

  const record = (type, detail = {}) => {
    const entry = Object.freeze({
      sequence: ++sequence,
      at: new Date().toISOString(),
      type,
      ...detail,
    });
    events.push(entry);
    return entry;
  };

  const release = id => {
    released.add(id);
    const responses = held.get(id) ?? new Set();
    held.delete(id);
    record("release", { id, responses: responses.size });
    for (const response of responses) {
      response.end(`<p id="released">released ${id}</p></body></html>`);
    }
  };

  const snapshot = () => ({
    events: events.map(entry => ({ ...entry })),
    pending: Object.fromEntries(
      [...held.entries()]
        .sort(([left], [right]) => left - right)
        .map(([id, responses]) => [String(id), responses.size]),
    ),
    released: [...released].sort((left, right) => left - right),
  });

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const holdId = url.pathname.startsWith("/hold/") ? numericId(url.pathname) : null;
    if (holdId !== null) {
      record("hold-request", { id: holdId, method: request.method ?? null });
      response.writeHead(200, {
        "cache-control": "no-store",
        connection: "close",
        "content-type": "text/html; charset=utf-8",
      });
      response.write(
        `<!doctype html><meta charset="utf-8"><title>hold ${holdId}</title>` +
          `<body data-hold-id="${holdId}"><h1>hold ${holdId}</h1>`,
      );
      if (released.has(holdId)) {
        response.end(`<p id="released">already released ${holdId}</p></body></html>`);
        record("hold-complete", { id: holdId, immediate: true });
        return;
      }
      const responses = held.get(holdId) ?? new Set();
      responses.add(response);
      held.set(holdId, responses);
      const remove = () => {
        const current = held.get(holdId);
        current?.delete(response);
        if (current?.size === 0) held.delete(holdId);
      };
      response.once("close", remove);
      response.once("finish", () => {
        remove();
        record("hold-complete", { id: holdId, immediate: false });
      });
      return;
    }

    const fastMatch = url.pathname.match(/^\/fast\/(\d+)$/);
    if (fastMatch) {
      const id = Number.parseInt(fastMatch[1], 10);
      record("fast-request", { id, method: request.method ?? null });
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
      });
      response.end(
        `<!doctype html><meta charset="utf-8"><title>fast ${id}</title>` +
          `<body data-fast-id="${id}"><h1>fast ${id}</h1></body>`,
      );
      return;
    }

    if (url.pathname === "/control/snapshot") {
      json(response, 200, snapshot());
      return;
    }
    if (url.pathname === "/control/release-all") {
      const ids = new Set([...held.keys(), ...[1, 2, 3, 4]]);
      for (const id of ids) release(id);
      json(response, 200, snapshot());
      return;
    }
    if (url.pathname.startsWith("/control/release/")) {
      const id = numericId(url.pathname);
      if (id === null) {
        json(response, 400, { error: "release id must be a positive integer" });
        return;
      }
      release(id);
      json(response, 200, snapshot());
      return;
    }

    record("not-found", { method: request.method ?? null, path: url.pathname });
    json(response, 404, { error: "not found" });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("wake transaction server did not receive a TCP address");
  }

  let stopped = false;
  return Object.freeze({
    baseUrl: `http://127.0.0.1:${address.port}`,
    release,
    snapshot,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      for (const id of [...held.keys()]) release(id);
      await new Promise((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      );
    },
  });
};
