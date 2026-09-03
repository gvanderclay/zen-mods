import { describe, expect, it, vi } from "vitest";
import { PALETTE_PATH_PREFERENCE } from "../core/path.ts";
import { observePalettePath } from "./preferences.ts";

describe("palette path preference observer", () => {
  it("delivers exact changes and makes retained callbacks inert after dispose", () => {
    let observer: { observe(): void } | undefined;
    const store = {
      addObserver: vi.fn((_name: string, candidate: { observe(): void }) => {
        observer = candidate;
      }),
      removeObserver: vi.fn(),
    };
    const changed = vi.fn();

    const dispose = observePalettePath(store, changed);
    observer?.observe();
    dispose();
    dispose();
    observer?.observe();

    expect(store.addObserver).toHaveBeenCalledWith(PALETTE_PATH_PREFERENCE, observer);
    expect(changed).toHaveBeenCalledOnce();
    expect(store.removeObserver).toHaveBeenCalledOnce();
    expect(store.removeObserver).toHaveBeenCalledWith(PALETTE_PATH_PREFERENCE, observer);
  });
});
