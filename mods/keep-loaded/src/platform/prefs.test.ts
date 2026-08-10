import { describe, expect, it, vi } from "vitest";
import {
  createCachedPreferences,
  type ObservedPreference,
  type RawPreferencesPort,
} from "./prefs.ts";

const sourceHarness = () => {
  const values = {
    crashAttempts: "3",
    crashWindow: "60",
    debug: true,
    freshen: "10",
    freshenHold: "5",
    lazyPinned: true,
    match: "mail.example.test, calendar.example.test",
  };
  const reads = {
    crashAttempts: vi.fn(() => values.crashAttempts),
    crashWindow: vi.fn(() => values.crashWindow),
    debug: vi.fn(() => values.debug),
    freshen: vi.fn(() => values.freshen),
    freshenHold: vi.fn(() => values.freshenHold),
    lazyPinned: vi.fn(() => values.lazyPinned),
    match: vi.fn(() => values.match),
  };
  const observers = new Map<ObservedPreference, () => void>();
  const probes = [{ name: "stable", present: true, required: true }];
  const source: RawPreferencesPort = {
    readMatch: reads.match,
    readCrashAttempts: reads.crashAttempts,
    readCrashWindow: reads.crashWindow,
    readFreshenSeconds: reads.freshen,
    readFreshenHoldSeconds: reads.freshenHold,
    readDebug: reads.debug,
    readLazyPinnedWanted: reads.lazyPinned,
    observe: (which, onChange) => {
      observers.set(which, onChange);
      return () => observers.delete(which);
    },
    probes: vi.fn(() => probes),
  };
  return { observers, probes, reads, source, values };
};

describe("cached semantic preferences", () => {
  it("parses each stable input once and updates only the changed field", () => {
    const harness = sourceHarness();
    const preferences = createCachedPreferences(harness.source);

    const initial = preferences.snapshot();
    expect(initial).toEqual({
      crashAttempts: 3,
      crashWindowMs: 3_600_000,
      debug: true,
      freshen: { everyMs: 10_000, holdMs: 5_000 },
      lazyPinnedWanted: true,
      match: ["mail.example.test", "calendar.example.test"],
    });
    expect(preferences.snapshot()).toBe(initial);
    expect(Object.isFrozen(initial)).toBe(true);
    expect(Object.isFrozen(initial.match)).toBe(true);
    expect(Object.isFrozen(initial.freshen)).toBe(true);
    expect(harness.reads.match).toHaveBeenCalledOnce();
    expect(harness.reads.freshen).toHaveBeenCalledOnce();

    preferences.observe("freshen", () => {});
    harness.values.freshen = " 20 ";
    harness.observers.get("freshen")?.();

    expect(preferences.snapshot()).toEqual({
      ...initial,
      freshen: { everyMs: 20_000, holdMs: 5_000 },
    });
    expect(harness.reads.match).toHaveBeenCalledOnce();
    expect(harness.reads.freshen).toHaveBeenCalledTimes(2);
  });

  it("refreshes the cache before forwarding an observer callback", () => {
    const harness = sourceHarness();
    const preferences = createCachedPreferences(harness.source);
    const seen: number[] = [];
    const dispose = preferences.observe("crash-attempts", () => {
      seen.push(preferences.snapshot().crashAttempts);
    });

    harness.values.crashAttempts = "7";
    harness.observers.get("crash-attempts")?.();

    expect(seen).toEqual([7]);
    dispose();
    expect(harness.observers.has("crash-attempts")).toBe(false);
  });

  it("caches capability probes after the first request", () => {
    const harness = sourceHarness();
    const preferences = createCachedPreferences(harness.source);

    expect(preferences.probes()).toBe(preferences.probes());
    expect(harness.source.probes).toHaveBeenCalledTimes(1);
  });
});
