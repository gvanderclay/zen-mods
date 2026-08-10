import { describe, expect, it, vi } from "vitest";
import { KeepLoadedController } from "../controller.ts";
import { bindLifecycle } from "./sine.ts";

describe("Sine and native lifecycle binding", () => {
  it.each([
    ["Sine first", ["sine", "native"] as const, "sine-unload"],
    ["native first", ["native", "sine"] as const, "window-unload"],
  ])("keeps teardown idempotent with %s", (_label, order, firstReason) => {
    let sineCallback: (() => void) | null = null;
    let nativeCallback: EventListener | null = null;
    const timeline: string[] = [];
    const removeEventListener = vi.fn(() => timeline.push("remove-native"));
    Object.assign(globalThis, {
      window: {
        addUnloadListener: (callback: () => void) => {
          sineCallback = callback;
        },
        addEventListener: (
          type: string,
          callback: EventListener,
          options: AddEventListenerOptions,
        ) => {
          expect(type).toBe("unload");
          expect(options).toEqual({ capture: false, once: true });
          nativeCallback = callback;
        },
        removeEventListener,
      },
    });
    const owner = new KeepLoadedController({
      timers: {
        clearTimeout: () => {},
        setTimeout: () => 1,
      },
    });

    bindLifecycle(owner);
    const callbacks = {
      native: () => {
        timeline.push("invoke:window-unload");
        nativeCallback?.(new Event("unload"));
      },
      sine: () => {
        timeline.push("invoke:sine-unload");
        sineCallback?.();
      },
    };
    for (const source of order) {
      callbacks[source]();
    }

    expect(owner.state).toEqual({ kind: "stopped", reason: firstReason });
    expect(timeline).toEqual([
      `invoke:${firstReason}`,
      "remove-native",
      `invoke:${firstReason === "sine-unload" ? "window-unload" : "sine-unload"}`,
    ]);
    expect(removeEventListener).toHaveBeenCalledWith("unload", nativeCallback, {
      capture: false,
    });
  });
});
