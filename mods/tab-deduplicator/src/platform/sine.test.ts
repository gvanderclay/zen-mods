import { afterEach, describe, expect, it, vi } from "vitest";

import { startGeneration } from "./sine.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Sine window generation", () => {
  it("owns cleanup across replacement and native window close", () => {
    const sineCallbacks: Array<() => void> = [];
    const nativeCallbacks: Array<() => void> = [];
    const target = {
      zenTabDeduplicator: undefined as unknown,
      addUnloadListener(callback: () => void) {
        sineCallbacks.push(callback);
      },
      addEventListener(_type: "unload", callback: () => void) {
        nativeCallbacks.push(callback);
      },
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("window", target);
    const disposed: string[] = [];

    const first = startGeneration();
    first.defer(() => disposed.push("first"));
    const second = startGeneration();
    second.defer(() => disposed.push("second"));

    expect(first.stopReason).toBe("replacement");
    expect(disposed).toEqual(["first"]);
    sineCallbacks[0]?.();
    expect(target.zenTabDeduplicator).toBe(second);

    nativeCallbacks[1]?.();
    expect(second.stopReason).toBe("window-unload");
    expect(disposed).toEqual(["first", "second"]);
    expect(target.zenTabDeduplicator).toBeUndefined();
  });
});
