import { get } from "node:http";
import { describe, expect, it } from "vitest";
import { startWakeTransactionServer } from "./wake-transaction-server.mjs";

const request = url =>
  new Promise((resolve, reject) => {
    get(url, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => {
        body += chunk;
      });
      response.on("end", () => resolve({ body, status: response.statusCode }));
    }).once("error", reject);
  });

const waitFor = async read => {
  const deadline = Date.now() + 2_000;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error("timed out waiting for server state");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

describe("wake transaction live HTTP fixture", () => {
  it("holds remote documents until their exact restore slot is released", async () => {
    const server = await startWakeTransactionServer();
    try {
      let settled = false;
      const held = request(`${server.baseUrl}/hold/2`).then(result => {
        settled = true;
        return result;
      });
      await waitFor(() => server.snapshot().pending["2"] === 1);

      expect(settled).toBe(false);
      const remoteSnapshot = await fetch(`${server.baseUrl}/control/snapshot`).then(
        response => response.json(),
      );
      expect(remoteSnapshot.pending).toEqual({ 2: 1 });
      expect(remoteSnapshot.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "hold-request", id: 2 }),
        ]),
      );

      const release = await fetch(`${server.baseUrl}/control/release/2`);
      expect(release.status).toBe(200);
      await expect(held).resolves.toMatchObject({ status: 200 });
      await expect(request(`${server.baseUrl}/hold/2`)).resolves.toMatchObject({
        status: 200,
      });
      await expect(request(`${server.baseUrl}/fast/5`)).resolves.toMatchObject({
        status: 200,
      });

      const snapshot = server.snapshot();
      expect(snapshot.pending).toEqual({});
      expect(snapshot.released).toContain(2);
      expect(snapshot.events.filter(event => event.type === "hold-request")).toHaveLength(
        2,
      );
      expect(snapshot.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "fast-request", id: 5 }),
        ]),
      );
    } finally {
      await server.stop();
    }
  });
});
