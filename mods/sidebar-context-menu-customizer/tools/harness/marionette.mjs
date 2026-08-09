/**
 * Minimal Marionette client for privileged chrome-window probes.
 *
 * Firefox's wire format is `<byteLength>:<json>`. Keeping this client local makes the
 * lifecycle probe dependency-free and, importantly, prevents it from ever connecting
 * to the user's normal Zen process: the launcher supplies a fresh profile and port.
 */

import { connect } from "node:net";

const COMMAND = 0;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const connectWithRetry = async (port, timeoutMilliseconds) => {
  const deadline = Date.now() + timeoutMilliseconds;
  for (;;) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = connect(port, "127.0.0.1");
        socket.once("connect", () => resolve(socket));
        socket.once("error", reject);
      });
    } catch (error) {
      if (Date.now() > deadline) {
        throw new Error(`Marionette never came up on ${port}: ${error.message}`);
      }
      await sleep(250);
    }
  }
};

export const openMarionette = async ({
  port,
  timeoutMilliseconds = 60_000,
  quitTimeoutMilliseconds = 2_000,
}) => {
  const socket = await connectWithRetry(port, timeoutMilliseconds);
  const pending = new Map();
  let buffer = Buffer.alloc(0);
  let nextId = 1;
  let terminalError = null;
  let rejectHandshake;
  let resolveHandshake;
  const handshake = new Promise((resolve, reject) => {
    resolveHandshake = resolve;
    rejectHandshake = reject;
  });

  const rejectPending = error => {
    terminalError ??= error;
    rejectHandshake(terminalError);
    for (const entry of pending.values()) {
      entry.reject(terminalError);
    }
    pending.clear();
  };

  const takePacket = () => {
    const colon = buffer.indexOf(0x3a);
    if (colon < 0) {
      return null;
    }
    const length = Number(buffer.subarray(0, colon).toString("ascii"));
    if (!Number.isInteger(length)) {
      throw new Error("Marionette sent a packet without a valid length prefix");
    }
    const end = colon + 1 + length;
    if (buffer.length < end) {
      return null;
    }
    const payload = buffer.subarray(colon + 1, end).toString("utf8");
    buffer = buffer.subarray(end);
    return JSON.parse(payload);
  };

  socket.on("data", chunk => {
    try {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const payload = takePacket();
        if (payload === null) {
          return;
        }
        if (!Array.isArray(payload)) {
          resolveHandshake(payload);
          continue;
        }
        const [, id, error, result] = payload;
        const entry = pending.get(id);
        pending.delete(id);
        if (!entry) {
          continue;
        }
        if (error) {
          entry.reject(new Error(`${error.error}: ${error.message}`));
        } else {
          entry.resolve(result);
        }
      }
    } catch (error) {
      rejectPending(error);
      socket.destroy();
    }
  });
  socket.on("error", rejectPending);
  socket.on("close", () => rejectPending(new Error("Marionette connection closed")));

  const send = (name, parameters = {}) => {
    if (terminalError || socket.destroyed || !socket.writable) {
      return Promise.reject(
        terminalError ?? new Error("Marionette connection is not writable"),
      );
    }
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      const body = Buffer.from(JSON.stringify([COMMAND, id, name, parameters]), "utf8");
      socket.write(
        Buffer.concat([Buffer.from(`${body.length}:`, "ascii"), body]),
        error => {
          if (!error) return;
          const entry = pending.get(id);
          pending.delete(id);
          entry?.reject(error);
        },
      );
    });
  };

  const hello = await handshake;
  await send("WebDriver:NewSession", {});
  await send("Marionette:SetContext", { value: "chrome" });

  return {
    hello,
    executeAsync: async (script, args = []) =>
      (await send("WebDriver:ExecuteAsyncScript", { script, args }))?.value,
    setScriptTimeout: milliseconds =>
      send("WebDriver:SetTimeouts", { script: milliseconds }),
    quit: async () => {
      await new Promise(resolve => {
        const timer = setTimeout(resolve, quitTimeoutMilliseconds);
        send("Marionette:Quit", {})
          .catch(() => {})
          .finally(() => {
            clearTimeout(timer);
            resolve();
          });
      });
      socket.destroy();
    },
  };
};
