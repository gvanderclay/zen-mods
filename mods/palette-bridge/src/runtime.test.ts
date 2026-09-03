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

const timers = {
  clearTimeout: vi.fn(),
  setTimeout: vi.fn(() => 1),
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("Palette Bridge window controller", () => {
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
      pendingTimers: 0,
      pendingWaits: 0,
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
