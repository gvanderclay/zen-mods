import { describe, expect, it, vi } from "vitest";
import type { Palette } from "./core/palette.ts";
import { paletteIdentity } from "./core/palette.ts";
import { PaletteBridgeController } from "./runtime.ts";

const PALETTE: Palette = {
  schemaVersion: 1,
  mode: "dark",
  accent: "#112233",
  mainBackground: "#223344",
  secondarySurface: "#334455",
  selectionSurface: "#445566",
  border: "#556677",
  normalForeground: "#ccddee",
  mutedForeground: "#aabbcc",
  strongForeground: "#ffffff",
};

const SECOND_PALETTE: Palette = {
  ...PALETTE,
  displayName: "Second",
  accent: "#667788",
};

const timers = {
  clearTimeout: vi.fn(),
  setTimeout: vi.fn(() => 1),
};

const flush = async () => {
  for (let turn = 0; turn < 6; turn += 1) {
    await Promise.resolve();
  }
};

const manualTimers = () => {
  let nextHandle = 1;
  const callbacks = new Map<number, () => void>();
  const delays: number[] = [];
  return {
    callbacks,
    delays,
    timers: {
      clearTimeout: (handle: number) => {
        callbacks.delete(handle);
      },
      setTimeout: (callback: () => void, delayMs: number) => {
        const handle = nextHandle++;
        callbacks.set(handle, callback);
        delays.push(delayMs);
        return handle;
      },
    },
    runNext: () => {
      const entry = callbacks.entries().next().value as
        | readonly [number, () => void]
        | undefined;
      if (!entry) throw new Error("no timer is scheduled");
      callbacks.delete(entry[0]);
      entry[1]();
    },
  };
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => {
    resolve = accept;
  });
  return { promise, resolve };
};

describe("Palette Bridge window controller", () => {
  it("applies a valid replacement after one serialized polling interval", async () => {
    const clock = manualTimers();
    let concurrentReads = 0;
    let maximumConcurrentReads = 0;
    const palettes = [PALETTE, SECOND_PALETTE];
    const file = {
      currentPath: () => "/palette.json",
      read: vi.fn(async () => {
        concurrentReads += 1;
        maximumConcurrentReads = Math.max(maximumConcurrentReads, concurrentReads);
        await Promise.resolve();
        concurrentReads -= 1;
        return palettes.shift();
      }),
    };
    const view = { apply: vi.fn(() => true), dispose: vi.fn(() => true) };
    const controller = new PaletteBridgeController({
      eligible: true,
      file,
      onError: vi.fn(),
      timers: clock.timers,
      view,
    });

    controller.start();
    await flush();
    expect(view.apply).toHaveBeenLastCalledWith(PALETTE);
    expect(clock.delays).toEqual([1000]);

    clock.runNext();
    await flush();
    expect(view.apply).toHaveBeenLastCalledWith(SECOND_PALETTE);
    expect(file.read).toHaveBeenCalledTimes(2);
    expect(maximumConcurrentReads).toBe(1);
  });

  it("keeps the last valid palette and deduplicates only equivalent failures", async () => {
    const clock = manualTimers();
    const updates = [
      PALETTE,
      { schemaVersion: 1 },
      { schemaVersion: 1 },
      { ...PALETTE, accent: "#ABCDEF" },
    ];
    const onError = vi.fn();
    const view = { apply: vi.fn(() => true), dispose: vi.fn(() => true) };
    const controller = new PaletteBridgeController({
      eligible: true,
      file: {
        currentPath: () => "/palette.json",
        read: async () => updates.shift(),
      },
      onError,
      timers: clock.timers,
      view,
    });

    controller.start();
    await flush();
    clock.runNext();
    await flush();
    clock.runNext();
    await flush();
    clock.runNext();
    await flush();

    expect(view.apply).toHaveBeenCalledTimes(1);
    expect(controller.snapshot().activePaletteIdentity).toBe(paletteIdentity(PALETTE));
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[0]?.[0]).toEqual(new Error("mode must be dark or light"));
    expect(onError.mock.calls[1]?.[0]).toEqual(
      new Error("accent must be a lowercase #rrggbb color"),
    );
  });

  it("applies and reports only distinct valid palettes", async () => {
    const clock = manualTimers();
    const updates = [PALETTE, { ...PALETTE }, SECOND_PALETTE];
    const onPaletteApplied = vi.fn();
    const view = { apply: vi.fn(() => true), dispose: vi.fn(() => true) };
    const controller = new PaletteBridgeController({
      eligible: true,
      file: {
        currentPath: () => "/palette.json",
        read: async () => updates.shift(),
      },
      onError: vi.fn(),
      onPaletteApplied,
      timers: clock.timers,
      view,
    });

    controller.start();
    await flush();
    clock.runNext();
    await flush();
    clock.runNext();
    await flush();

    expect(view.apply).toHaveBeenCalledTimes(2);
    expect(onPaletteApplied).toHaveBeenCalledTimes(2);
    expect(onPaletteApplied).toHaveBeenNthCalledWith(1, PALETTE);
    expect(onPaletteApplied).toHaveBeenNthCalledWith(2, SECOND_PALETTE);
  });

  it("serializes an immediate path change and rejects the stale result", async () => {
    const clock = manualTimers();
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    let path = "/first.json";
    const read = vi
      .fn<(path: string) => Promise<unknown>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const view = { apply: vi.fn(() => true), dispose: vi.fn(() => true) };
    const controller = new PaletteBridgeController({
      eligible: true,
      file: { currentPath: () => path, read },
      onError: vi.fn(),
      timers: clock.timers,
      view,
    });

    controller.start();
    path = "/second.json";
    expect(controller.pathChanged()).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);

    first.resolve(PALETTE);
    await flush();
    expect(read).toHaveBeenNthCalledWith(2, "/second.json");
    expect(view.apply).not.toHaveBeenCalled();

    second.resolve(SECOND_PALETTE);
    await flush();
    expect(view.apply).toHaveBeenCalledOnce();
    expect(view.apply).toHaveBeenCalledWith(SECOND_PALETTE);
    expect(clock.callbacks.size).toBe(1);
  });

  it("deduplicates equivalent read failures until a valid recovery", async () => {
    const clock = manualTimers();
    const updates: unknown[] = [
      new Error("file missing"),
      new Error("file missing"),
      PALETTE,
      new Error("file missing"),
    ];
    const onError = vi.fn();
    const controller = new PaletteBridgeController({
      eligible: true,
      file: {
        currentPath: () => "/palette.json",
        read: async () => {
          const update = updates.shift();
          if (update instanceof Error) throw update;
          return update;
        },
      },
      onError,
      timers: clock.timers,
      view: { apply: vi.fn(() => true), dispose: vi.fn(() => true) },
    });

    controller.start();
    await flush();
    clock.runNext();
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);

    clock.runNext();
    await flush();
    clock.runNext();
    await flush();
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("coalesces Zen updates into one reapply of the active palette", async () => {
    const clock = manualTimers();
    const queued: Array<() => void> = [];
    const view = { apply: vi.fn(() => true), dispose: vi.fn(() => true) };
    const controller = new PaletteBridgeController({
      eligible: true,
      enqueueMicrotask: callback => queued.push(callback),
      file: {
        currentPath: () => "/palette.json",
        read: async () => PALETTE,
      },
      onError: vi.fn(),
      timers: clock.timers,
      view,
    });
    controller.start();
    await flush();

    expect(controller.requestReapply()).toBe(true);
    expect(controller.requestReapply()).toBe(false);
    expect(controller.snapshot().reapplyQueued).toBe(true);
    expect(queued).toHaveLength(1);
    queued[0]?.();

    expect(view.apply).toHaveBeenCalledTimes(2);
    expect(view.apply).toHaveBeenLastCalledWith(PALETTE);
    expect(controller.snapshot().reapplyQueued).toBe(false);
  });

  it("drains timers and queued work when the generation stops", async () => {
    const clock = manualTimers();
    const queued: Array<() => void> = [];
    const view = { apply: vi.fn(() => true), dispose: vi.fn(() => true) };
    const controller = new PaletteBridgeController({
      eligible: true,
      enqueueMicrotask: callback => queued.push(callback),
      file: {
        currentPath: () => "/palette.json",
        read: async () => PALETTE,
      },
      onError: vi.fn(),
      timers: clock.timers,
      view,
    });
    controller.start();
    await flush();
    controller.requestReapply();

    expect(controller.stop("manual")).toBe(true);
    expect(controller.snapshot()).toMatchObject({
      live: false,
      pendingTimers: 0,
      pendingWaits: 0,
      readInFlight: false,
      readRequested: false,
      reapplyQueued: false,
    });
    expect(controller.pathChanged()).toBe(false);
    expect(controller.requestReapply()).toBe(false);
    queued[0]?.();
    expect(view.apply).toHaveBeenCalledOnce();
  });

  it("loads and applies one valid palette when an ordinary window starts", async () => {
    const view = { apply: vi.fn(() => true), dispose: vi.fn(() => true) };
    const file = {
      currentPath: vi.fn(() => "/profile/chrome/palette-bridge.json"),
      read: vi.fn(async () => PALETTE),
    };
    const controller = new PaletteBridgeController({
      eligible: true,
      file,
      onError: vi.fn(),
      timers,
      view,
    });

    expect(controller.start()).toBe(true);
    await flush();

    expect(file.read).toHaveBeenCalledWith("/profile/chrome/palette-bridge.json");
    expect(view.apply).toHaveBeenCalledWith(PALETTE);
    expect(controller.snapshot()).toEqual({
      activePaletteIdentity: paletteIdentity(PALETTE),
      eligible: true,
      live: true,
      pendingTimers: 1,
      pendingWaits: 0,
      readInFlight: false,
      readRequested: false,
      reapplyQueued: false,
      started: true,
      stopReason: null,
    });

    expect(controller.stop("manual")).toBe(true);
    expect(view.dispose).toHaveBeenCalledOnce();
  });

  it("does no file or style work for a private or unsynced window", () => {
    const controller = new PaletteBridgeController({
      eligible: false,
      onError: vi.fn(),
      timers,
    });

    expect(controller.start()).toBe(true);
    expect(controller.snapshot()).toMatchObject({
      pendingTimers: 0,
      pendingWaits: 0,
      readInFlight: false,
    });
    controller.stop("manual");
  });

  it("makes an initial read continuation inert after stop", async () => {
    let resolveRead!: (value: unknown) => void;
    const read = new Promise<unknown>(resolve => {
      resolveRead = resolve;
    });
    const view = { apply: vi.fn(() => true), dispose: vi.fn(() => true) };
    const controller = new PaletteBridgeController({
      eligible: true,
      file: {
        currentPath: () => "/palette.json",
        read: () => read,
      },
      onError: vi.fn(),
      timers,
      view,
    });

    controller.start();
    expect(controller.snapshot().pendingWaits).toBe(1);
    controller.stop("replacement");
    resolveRead(PALETTE);
    await flush();

    expect(view.apply).not.toHaveBeenCalled();
    expect(controller.snapshot()).toMatchObject({
      live: false,
      pendingWaits: 0,
      stopReason: "replacement",
    });
  });

  it("does not apply a ready read after the generation stops", async () => {
    let resolveRead!: (value: unknown) => void;
    const read = new Promise<unknown>(resolve => {
      resolveRead = resolve;
    });
    const onError = vi.fn();
    const view = { apply: vi.fn(() => true), dispose: vi.fn(() => true) };
    const controller = new PaletteBridgeController({
      eligible: true,
      file: {
        currentPath: () => "/palette.json",
        read: () => read,
      },
      onError,
      timers,
      view,
    });

    controller.start();
    resolveRead(PALETTE);
    queueMicrotask(() => controller.stop("replacement"));
    await flush();

    expect(view.apply).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
