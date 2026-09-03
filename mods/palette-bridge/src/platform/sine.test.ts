import { describe, expect, it, vi } from "vitest";
import type { PaletteBridgeStopReason } from "../runtime.ts";
import { type PaletteBridgeWindowTarget, startPaletteBridgeGeneration } from "./sine.ts";

const controller = () => {
  let live = true;
  let stopReason: PaletteBridgeStopReason | null = null;
  const disposers: Array<() => unknown> = [];
  return {
    defer(disposer: () => unknown) {
      disposers.push(disposer);
    },
    isLive: () => live,
    get stopReason() {
      return stopReason;
    },
    stop(reason: PaletteBridgeStopReason = "manual") {
      if (!live) return false;
      live = false;
      stopReason = reason;
      for (const dispose of disposers.reverse()) dispose();
      return true;
    },
  };
};

describe("Palette Bridge Sine generation", () => {
  it("replaces the old generation and binds Sine and window unload", () => {
    const sineCallbacks: Array<() => unknown> = [];
    const windowCallbacks: Array<() => void> = [];
    const removed: Array<() => void> = [];
    const target: PaletteBridgeWindowTarget = {
      addEventListener(
        _type: "unload",
        callback: () => void,
        _options: { capture: false; once: true },
      ) {
        windowCallbacks.push(callback);
      },
      addUnloadListener(callback: () => unknown) {
        sineCallbacks.push(callback);
      },
      removeEventListener(
        _type: "unload",
        callback: () => void,
        _options: { capture: false },
      ) {
        removed.push(callback);
      },
    };
    const firstController = controller();
    const secondController = controller();

    const first = startPaletteBridgeGeneration({
      controller: firstController,
      generationToken: "first",
      target,
    });
    const second = startPaletteBridgeGeneration({
      controller: secondController,
      generationToken: "second",
      target,
    });

    expect(firstController.stopReason).toBe("replacement");
    expect(removed).toEqual([windowCallbacks[0]]);
    sineCallbacks[0]?.();
    expect(target.zenPaletteBridge).toBe(second);
    expect(first.generationToken).toBe("first");

    windowCallbacks[1]?.();
    expect(secondController.stopReason).toBe("window-unload");
    expect(target.zenPaletteBridge).toBeUndefined();
  });

  it("reports when the Sine unload hook is unavailable", () => {
    const onSineUnloadUnavailable = vi.fn();
    const target: PaletteBridgeWindowTarget = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    startPaletteBridgeGeneration({
      controller: controller(),
      generationToken: "generation",
      onSineUnloadUnavailable,
      target,
    });

    expect(onSineUnloadUnavailable).toHaveBeenCalledOnce();
  });
});
