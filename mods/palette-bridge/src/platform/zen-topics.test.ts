import { describe, expect, it, vi } from "vitest";
import { observeZenPaletteUpdates, ZEN_PALETTE_UPDATE_TOPICS } from "./zen-topics.ts";

describe("Zen palette update observer", () => {
  it("delivers both exact topics and makes retained callbacks inert", () => {
    let observer: { observe(subject: unknown, topic: string): void } | undefined;
    const store = {
      addObserver: vi.fn(
        (candidate: { observe(subject: unknown, topic: string): void }) => {
          observer = candidate;
        },
      ),
      removeObserver: vi.fn(),
    };
    const changed = vi.fn();

    const dispose = observeZenPaletteUpdates(store, changed);
    for (const topic of ZEN_PALETTE_UPDATE_TOPICS) {
      observer?.observe(null, topic);
    }
    observer?.observe(null, "unrelated");
    dispose();
    dispose();
    observer?.observe(null, ZEN_PALETTE_UPDATE_TOPICS[0]);

    expect(store.addObserver.mock.calls).toEqual(
      ZEN_PALETTE_UPDATE_TOPICS.map(topic => [observer, topic]),
    );
    expect(changed).toHaveBeenCalledTimes(2);
    expect(store.removeObserver.mock.calls).toEqual(
      ZEN_PALETTE_UPDATE_TOPICS.map(topic => [observer, topic]),
    );
  });

  it("rolls back an earlier topic when registration fails", () => {
    const registrationError = new Error("registration failed");
    const store = {
      addObserver: vi
        .fn()
        .mockImplementationOnce(() => undefined)
        .mockImplementationOnce(() => {
          throw registrationError;
        }),
      removeObserver: vi.fn(),
    };

    expect(() => observeZenPaletteUpdates(store, vi.fn())).toThrow(registrationError);
    expect(store.removeObserver).toHaveBeenCalledOnce();
    expect(store.removeObserver).toHaveBeenCalledWith(
      store.addObserver.mock.calls[0]?.[0],
      ZEN_PALETTE_UPDATE_TOPICS[0],
    );
  });

  it("attempts to remove every topic when one removal fails", () => {
    const store = {
      addObserver: vi.fn(),
      removeObserver: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error("first removal failed");
        })
        .mockImplementationOnce(() => undefined),
    };
    const dispose = observeZenPaletteUpdates(store, vi.fn());

    expect(dispose).toThrow(AggregateError);
    expect(store.removeObserver).toHaveBeenCalledTimes(2);
  });
});
