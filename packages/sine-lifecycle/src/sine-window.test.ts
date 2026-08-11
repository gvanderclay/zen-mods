import { describe, expect, it, vi } from "vitest";

import { bindSineWindowLifecycle } from "./sine-window.js";

describe("bindSineWindowLifecycle", () => {
  it("routes Sine and native unload through one owner and removes the native listener", () => {
    let sineUnload: (() => void) | undefined;
    let nativeUnload: (() => void) | undefined;
    let deferred: (() => unknown) | undefined;
    const stop = vi.fn();
    const target = {
      addUnloadListener(callback: () => void) {
        sineUnload = callback;
      },
      addEventListener(_type: "unload", callback: () => void) {
        nativeUnload = callback;
      },
      removeEventListener: vi.fn(),
    };

    const result = bindSineWindowLifecycle(target, {
      defer(disposer) {
        deferred = disposer;
      },
      stop,
    });

    expect(result).toEqual({ sineUnload: "registered" });
    sineUnload?.();
    nativeUnload?.();
    deferred?.();
    expect(stop.mock.calls).toEqual([["sine-unload"], ["window-unload"]]);
    expect(target.removeEventListener).toHaveBeenCalledWith("unload", nativeUnload, {
      capture: false,
    });
  });

  it("keeps the native close fallback when Sine's hook is unavailable", () => {
    let nativeUnload: (() => void) | undefined;
    const stop = vi.fn();
    const result = bindSineWindowLifecycle(
      {
        addEventListener(_type: "unload", callback: () => void) {
          nativeUnload = callback;
        },
        removeEventListener() {},
      },
      { defer() {}, stop },
    );

    nativeUnload?.();

    expect(result).toEqual({ sineUnload: "unavailable" });
    expect(stop).toHaveBeenCalledWith("window-unload");
  });

  it("owns the native fallback before calling Sine", () => {
    let nativeUnload: (() => void) | undefined;
    let deferred: (() => unknown) | undefined;
    const stop = vi.fn();
    const removeEventListener = vi.fn();
    const failure = new Error("Sine registration failed");
    const target = {
      addUnloadListener() {
        throw failure;
      },
      addEventListener(_type: "unload", callback: () => void) {
        nativeUnload = callback;
      },
      removeEventListener,
    };

    expect(() =>
      bindSineWindowLifecycle(target, {
        defer(disposer) {
          deferred = disposer;
        },
        stop,
      }),
    ).toThrow(failure);

    nativeUnload?.();
    deferred?.();
    expect(stop).toHaveBeenCalledWith("window-unload");
    expect(removeEventListener).toHaveBeenCalledWith("unload", nativeUnload, {
      capture: false,
    });
  });
});
