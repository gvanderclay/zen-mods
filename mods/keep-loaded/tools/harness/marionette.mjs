/**
 * A minimal Marionette client, so chrome-context questions can be answered without a
 * human driving the Browser Console.
 *
 * Wire format is length-prefixed JSON — `<byteLength>:<payload>` — and a payload is
 * either the server's opening handshake object or a message array whose first element
 * is the type: `Command.Type = 0`, `Response.Type = 1` (`message.sys.mjs` 200, 329).
 * Command names come from the dispatch table in `driver.sys.mjs` 4405-4468.
 */

import { connect } from "node:net";

const COMMAND = 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const connectWithRetry = async (port, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = connect(port, "127.0.0.1");
        socket.once("connect", () => resolve(socket));
        socket.once("error", reject);
      });
    } catch (error) {
      if (Date.now() > deadline) {
        throw new Error(`marionette never came up on ${port}: ${error.message}`);
      }
      await sleep(250);
    }
  }
};

export const openMarionette = async ({ port = 2828, timeoutMs = 60_000 } = {}) => {
  const socket = await connectWithRetry(port, timeoutMs);
  const pending = new Map();
  let buffer = Buffer.alloc(0);
  let nextId = 1;
  let settleHandshake;
  const handshake = new Promise(resolve => {
    settleHandshake = resolve;
  });

  const take = () => {
    const colon = buffer.indexOf(0x3a);
    if (colon < 0) {
      return null;
    }
    const length = Number(buffer.subarray(0, colon).toString("ascii"));
    if (!Number.isInteger(length)) {
      throw new Error("marionette sent a packet with no length prefix");
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
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const payload = take();
      if (payload === null) {
        return;
      }
      if (!Array.isArray(payload)) {
        settleHandshake(payload);
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
  });

  const send = (name, parameters = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      const body = Buffer.from(JSON.stringify([COMMAND, id, name, parameters]), "utf8");
      socket.write(Buffer.concat([Buffer.from(`${body.length}:`, "ascii"), body]));
    });

  const hello = await handshake;
  await send("WebDriver:NewSession", {});
  // Everything this harness asks about lives in the parent process, which is the whole
  // point: it is the context a Sine mod runs in.
  await send("Marionette:SetContext", { value: "chrome" });

  return {
    hello,
    send,
    /**
     * `script` runs with the chrome window as its scope and must `return` a value.
     * The reply is wrapped — `{ value: … }` — so it is unwrapped here rather than at
     * every call site, which is how the first run of this harness misread its own
     * successful result as inconclusive.
     */
    execute: async (script, args = []) =>
      (await send("WebDriver:ExecuteScript", { script, args }))?.value,
    /** Last argument is the resolve callback, so the script can wait before answering. */
    executeAsync: async (script, args = []) =>
      (await send("WebDriver:ExecuteAsyncScript", { script, args }))?.value,
    setScriptTimeout: ms => send("WebDriver:SetTimeouts", { script: ms }),
    quit: async () => {
      try {
        await send("Marionette:Quit", {});
      } catch {
        // Quitting races the socket closing under it, which is not a failure.
      }
      socket.destroy();
    },
  };
};
