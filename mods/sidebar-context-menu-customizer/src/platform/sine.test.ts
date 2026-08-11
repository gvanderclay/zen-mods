import { afterEach, describe, expect, it, vi } from "vitest";

import { startGeneration } from "./sine.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Sine window generation", () => {
  it("replaces the prior generation and makes retained callbacks inert", () => {
    const sineCallbacks: Array<() => void> = [];
    const nativeCallbacks: Array<() => void> = [];
    const removed: Array<() => void> = [];
    const target = {
      zenSidebarContextMenuCustomizer: undefined as unknown,
      addUnloadListener(callback: () => void) {
        sineCallbacks.push(callback);
      },
      addEventListener(_type: "unload", callback: () => void) {
        nativeCallbacks.push(callback);
      },
      removeEventListener(_type: "unload", callback: () => void) {
        removed.push(callback);
      },
    };
    vi.stubGlobal("window", target);
    const disposed: string[] = [];

    const first = startGeneration();
    first.defer(() => disposed.push("first"));
    const second = startGeneration();
    second.defer(() => disposed.push("second"));

    expect(first.stopReason).toBe("replacement");
    expect(disposed).toEqual(["first"]);
    expect(removed).toEqual([nativeCallbacks[0]]);
    sineCallbacks[0]?.();
    expect(target.zenSidebarContextMenuCustomizer).toBe(second);

    nativeCallbacks[1]?.();
    expect(second.stopReason).toBe("window-unload");
    expect(disposed).toEqual(["first", "second"]);
    expect(target.zenSidebarContextMenuCustomizer).toBeUndefined();
  });
});
