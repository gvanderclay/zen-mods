/** Dependency-free Marionette client for privileged chrome-window probes. */

import { connect } from "node:net";

const COMMAND = 0;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const connectWithRetry = async (port, deadline) => {
  for (;;) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = connect(port, "127.0.0.1");
        socket.once("connect", () => resolve(socket));
        socket.once("error", reject);
      });
    } catch (error) {
      if (Date.now() >= deadline) {
        throw new Error(`Marionette never came up on ${port}: ${error.message}`);
      }
      await sleep(Math.min(250, Math.max(1, deadline - Date.now())));
    }
  }
};

export const openMarionette = async ({
  port,
  timeoutMilliseconds = 60_000,
  commandTimeoutMilliseconds = 240_000,
  quitTimeoutMilliseconds = 2_000,
}) => {
  const startupDeadline = Date.now() + timeoutMilliseconds;
  const socket = await connectWithRetry(port, startupDeadline);
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
      clearTimeout(entry.timer);
      entry.reject(terminalError);
    }
    pending.clear();
  };

  const takePacket = () => {
    const colon = buffer.indexOf(0x3a);
    if (colon < 0) return null;
    const length = Number(buffer.subarray(0, colon).toString("ascii"));
    if (!Number.isInteger(length)) {
      throw new Error("Marionette sent a packet without a valid length prefix");
    }
    const end = colon + 1 + length;
    if (buffer.length < end) return null;
    const payload = buffer.subarray(colon + 1, end).toString("utf8");
    buffer = buffer.subarray(end);
    return JSON.parse(payload);
  };

  socket.on("data", chunk => {
    try {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const payload = takePacket();
        if (payload === null) return;
        if (!Array.isArray(payload)) {
          resolveHandshake(payload);
          continue;
        }
        const [, id, error, result] = payload;
        const entry = pending.get(id);
        pending.delete(id);
        if (!entry) continue;
        clearTimeout(entry.timer);
        if (error) entry.reject(new Error(`${error.error}: ${error.message}`));
        else entry.resolve(result);
      }
    } catch (error) {
      rejectPending(error);
      socket.destroy();
    }
  });
  socket.on("error", rejectPending);
  socket.on("close", () => rejectPending(new Error("Marionette connection closed")));

  const send = (
    name,
    parameters = {},
    deadlineMilliseconds = commandTimeoutMilliseconds,
  ) => {
    if (terminalError || socket.destroyed || !socket.writable) {
      return Promise.reject(
        terminalError ?? new Error("Marionette connection is not writable"),
      );
    }
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        const error = new Error(
          `Marionette command ${name} timed out after ${deadlineMilliseconds}ms`,
        );
        entry.reject(error);
        rejectPending(error);
        socket.destroy();
      }, deadlineMilliseconds);
      pending.set(id, { resolve, reject, timer });
      const body = Buffer.from(JSON.stringify([COMMAND, id, name, parameters]), "utf8");
      socket.write(
        Buffer.concat([Buffer.from(`${body.length}:`, "ascii"), body]),
        error => {
          if (!error) return;
          const entry = pending.get(id);
          pending.delete(id);
          clearTimeout(entry?.timer);
          entry?.reject(error);
        },
      );
    });
  };

  const startupRemaining = label => {
    const remaining = startupDeadline - Date.now();
    if (remaining <= 0) {
      const error = new Error(
        `Marionette ${label} timed out after ${timeoutMilliseconds}ms`,
      );
      rejectPending(error);
      socket.destroy();
      throw error;
    }
    return remaining;
  };

  const handshakeTimer = setTimeout(() => {
    const error = new Error(
      `Marionette handshake timed out after ${timeoutMilliseconds}ms`,
    );
    rejectPending(error);
    socket.destroy();
  }, startupRemaining("handshake"));

  let hello;
  try {
    hello = await handshake;
    clearTimeout(handshakeTimer);
    await send("WebDriver:NewSession", {}, startupRemaining("new session"));
    await send(
      "Marionette:SetContext",
      { value: "chrome" },
      startupRemaining("chrome context"),
    );
  } catch (error) {
    clearTimeout(handshakeTimer);
    socket.destroy();
    throw error;
  }

  return {
    hello,
    executeAsync: async (script, args = []) =>
      (await send("WebDriver:ExecuteAsyncScript", { script, args }))?.value,
    setScriptTimeout: milliseconds =>
      send("WebDriver:SetTimeouts", { script: milliseconds }),
    quit: async () => {
      await send("Marionette:Quit", {}, quitTimeoutMilliseconds).catch(() => {});
      socket.destroy();
    },
  };
};
