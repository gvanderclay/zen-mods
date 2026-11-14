/**
 * Contract tests for the synthetic Keep Loaded lifecycle fixture and the probe that
 * drives it. The staged browser probe stays the authority for live behavior; these
 * tests keep the fixture's terminal ownership and the probe's startup ordering from
 * regressing without a browser.
 */

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const CARRIER_PATH = new URL("./lifecycle-carrier.sys.mjs", import.meta.url);
const WINDOW_PATH = new URL("./lifecycle-window.uc.mjs", import.meta.url);
const PROBE_PATH = new URL(
  "../../../../mods/keep-loaded/tools/harness/probe-lifecycle.mjs",
  import.meta.url,
);

const API_KEY = "__zenKeepLoadedLifecycleHarness";
const CARRIER_URI =
  "chrome://sine/content/keep-loaded-lifecycle-harness/fixtures/lifecycle-carrier.sys.mjs";
const PLATFORM_GLOBALS = ["Cc", "Ci", "ChromeUtils", "window"];

/** Run fixture code with only the platform globals it reads, then restore them. */
const withPlatform = async run => {
  const saved = PLATFORM_GLOBALS.map(name => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]);
  let uuid = 0;
  const nextUuid = () => {
    uuid += 1;
    return `{fixture-${uuid}}`;
  };
  globalThis.Ci = { nsIUUIDGenerator: "nsIUUIDGenerator" };
  globalThis.Cc = {
    "@mozilla.org/uuid-generator;1": {
      getService: () => ({ generateUUID: () => ({ toString: nextUuid }) }),
    },
  };
  try {
    return await run();
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
};

/** Import a fixture file as its own module instance; the fragment defeats the cache. */
const importFixture = async (path, fragment) => {
  const source = await readFile(path, "utf8");
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${fragment}`;
  return import(url);
};

const createWindow = () => {
  const listeners = new Map();
  const timers = new Map();
  const unloadCallbacks = [];
  let nextTimer = 1;
  const target = {
    addEventListener(type, listener) {
      const entries = listeners.get(type) ?? [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    addUnloadListener(callback) {
      unloadCallbacks.push(callback);
    },
    clearTimeout(handle) {
      timers.delete(handle);
    },
    dispatchEvent(event) {
      for (const listener of [...(listeners.get(event.type) ?? [])]) {
        listener.call(target, event);
      }
      return true;
    },
    removeEventListener(type, listener) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter(entry => entry !== listener),
      );
    },
    setTimeout(callback, delay) {
      const handle = nextTimer;
      nextTimer += 1;
      timers.set(handle, { callback, delay });
      return handle;
    },
  };
  return {
    activeListeners: () =>
      [...listeners]
        .filter(([, entries]) => entries.length > 0)
        .map(([type, entries]) => ({ count: entries.length, type })),
    deliverUnload: () => {
      for (const callback of [...unloadCallbacks]) callback();
    },
    target,
    timers: () => [...timers.values()],
    unloadCallbacks,
  };
};

/** Load one fresh carrier plus one fresh window fixture, as Sine would per window. */
const loadFixture = async fragment => {
  const carrier = (await importFixture(CARRIER_PATH, `${fragment}-carrier`)).default;
  globalThis.ChromeUtils = {
    importESModule: uri => {
      expect(uri).toBe(CARRIER_URI);
      return { default: carrier };
    },
  };
  const fixtureWindow = createWindow();
  globalThis.window = fixtureWindow.target;
  await importFixture(WINDOW_PATH, `${fragment}-window`);
  return { api: fixtureWindow.target[API_KEY], carrier, fixtureWindow };
};

describe("lifecycle window fixture", () => {
  it("registers one Sine unload listener and one native fallback for its own window", async () => {
    await withPlatform(async () => {
      const { api, carrier, fixtureWindow } = await loadFixture("startup");
      expect(api).toBeTruthy();
      expect(api.ready).toBe(true);
      expect(api.stopped).toBe(false);
      expect(api.windowId).toBe("window-1");
      expect(carrier.snapshot().active).toEqual([
        { generation: 1, ready: true, registered: true, windowId: "window-1" },
      ]);
      expect(carrier.snapshot().trace.map(event => event.type)).toEqual([
        "window-identified",
        "import",
        "unload-registered",
        "ready",
      ]);
      expect(fixtureWindow.unloadCallbacks).toHaveLength(1);
      expect(fixtureWindow.activeListeners()).toEqual([
        { count: 1, type: "keep-loaded-lifecycle-ping" },
        { count: 1, type: "unload" },
      ]);
      expect(fixtureWindow.timers()).toEqual([
        { callback: expect.any(Function), delay: 600000 },
      ]);
    });
  });

  it("tears down terminally when Sine delivers the unload listener", async () => {
    await withPlatform(async () => {
      const { api, carrier, fixtureWindow } = await loadFixture("sine-teardown");
      fixtureWindow.deliverUnload();
      const tornDown = carrier.snapshot();
      expect(tornDown.active).toEqual([]);
      expect(tornDown.trace.map(event => event.type)).toEqual([
        "window-identified",
        "import",
        "unload-registered",
        "ready",
        "teardown-call",
        "stop",
      ]);
      expect(tornDown.trace.at(-2)).toMatchObject({ source: "sine", stopped: false });
      expect(tornDown.trace.at(-1)).toMatchObject({
        generation: 1,
        owned: true,
        windowId: "window-1",
      });
      expect(api.stopped).toBe(true);
      expect(fixtureWindow.target[API_KEY]).toBeUndefined();
      expect(fixtureWindow.activeListeners()).toEqual([]);
      expect(fixtureWindow.timers()).toEqual([]);
    });
  });

  it("treats a late Sine delivery after teardown as an idempotent no-op", async () => {
    await withPlatform(async () => {
      const { carrier, fixtureWindow } = await loadFixture("late-sine");
      fixtureWindow.deliverUnload();
      fixtureWindow.deliverUnload();
      const late = carrier.snapshot();
      expect(late.trace.filter(event => event.type === "stop")).toHaveLength(1);
      expect(late.trace.at(-1)).toMatchObject({
        source: "sine",
        stopped: true,
        type: "teardown-call",
      });
      expect(late.active).toEqual([]);
      expect(fixtureWindow.target[API_KEY]).toBeUndefined();
      expect(fixtureWindow.activeListeners()).toEqual([]);
      expect(fixtureWindow.timers()).toEqual([]);
    });
  });

  it("tears down once through the native unload fallback and ignores a later Sine delivery", async () => {
    await withPlatform(async () => {
      const { carrier, fixtureWindow } = await loadFixture("native-unload");
      fixtureWindow.target.dispatchEvent(new Event("unload"));
      fixtureWindow.deliverUnload();
      const native = carrier.snapshot();
      expect(native.trace.filter(event => event.type === "stop")).toHaveLength(1);
      expect(
        native.trace.find(
          event => event.type === "teardown-call" && event.source === "native-unload",
        ),
      ).toMatchObject({ stopped: false });
      expect(native.trace.at(-1)).toMatchObject({ source: "sine", stopped: true });
      expect(native.active).toEqual([]);
      expect(fixtureWindow.activeListeners()).toEqual([]);
      expect(fixtureWindow.timers()).toEqual([]);
    });
  });
});

describe("keep-loaded lifecycle probe startup contract", () => {
  const readProbe = () => readFile(PROBE_PATH, "utf8");

  it("waits for window B's Sine window initialization pass before enabling the fixture", async () => {
    const source = await readProbe();
    const stageStart = source.indexOf(
      "const initialWindowCount = browserWindows().length;",
    );
    const stageEnd = source.indexOf("const fixedTimestamp = 123456789;");
    expect(stageStart).toBeGreaterThan(-1);
    expect(stageEnd).toBeGreaterThan(stageStart);
    const stage = source.slice(stageStart, stageEnd);

    // addUnloadListener appears while Sine's per-window module_loader pass is still
    // pending; that pass calls triggerUnloadListener for every .uc.mjs path in its
    // mods.json snapshot and only then deletes the function.
    expect(stage).toContain('typeof secondWindow.addUnloadListener === "function"');
    expect(stage).toContain('"window B Sine window initialization"');
    expect(stage).toMatch(/typeof secondWindow\.triggerUnloadListener !== "function"/);
    expect(stage).toContain("secondWindow.newDOM !== true");
    // Both waits keep the 30 s default budget: no third wait, no explicit timeout.
    expect(stage.match(/waitFor\(/g)).toHaveLength(2);
    expect(source.indexOf('"window B Sine window initialization"')).toBeLessThan(
      source.indexOf("await manager.toggleTheme("),
    );
  });

  it("keeps the complete unique assertion manifest", async () => {
    const source = await readProbe();
    const manifestStart = source.indexOf("const REQUIRED_ASSERTIONS = [");
    const manifestEnd = source.indexOf("];", manifestStart);
    expect(manifestStart).toBeGreaterThan(-1);
    expect(manifestEnd).toBeGreaterThan(manifestStart);
    const names = source
      .slice(manifestStart, manifestEnd)
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.startsWith('"'))
      .map(line => line.replace(/,$/, ""));
    expect(names).toHaveLength(40);
    expect(new Set(names).size).toBe(40);
  });
});
