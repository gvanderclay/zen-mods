import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, LOAD_BAR_PREFERENCES } from "../core/settings.ts";
import { createLoadBarPreferences, type PreferenceObserver } from "./preferences.ts";

const names = Object.values(LOAD_BAR_PREFERENCES);

const setup = () => {
  const values = new Map<string, string>([
    [LOAD_BAR_PREFERENCES.placement, "bottom"],
    [LOAD_BAR_PREFERENCES.thickness, "4"],
    [LOAD_BAR_PREFERENCES.color, "zen"],
    [LOAD_BAR_PREFERENCES.revealDelay, "100"],
  ]);
  const observers = new Map<string, PreferenceObserver>();
  const store = {
    addObserver: vi.fn((name: string, observer: PreferenceObserver) => {
      observers.set(name, observer);
    }),
    getStringPref: vi.fn(
      (name: string, fallback: string) => values.get(name) ?? fallback,
    ),
    removeObserver: vi.fn((name: string, observer: PreferenceObserver) => {
      if (observers.get(name) === observer) observers.delete(name);
    }),
  };
  return {
    observers,
    preferences: createLoadBarPreferences(store),
    store,
    values,
  };
};

describe("load bar preferences", () => {
  it("reads one parsed semantic snapshot", () => {
    const { preferences } = setup();

    expect(preferences.read()).toEqual({
      placement: "bottom",
      thickness: 4,
      color: "zen",
      revealDelayMs: 100,
    });
  });

  it("falls back per value when a raw read throws or is malformed", () => {
    const { preferences, store, values } = setup();
    values.set(LOAD_BAR_PREFERENCES.placement, "side");
    values.set(LOAD_BAR_PREFERENCES.color, "custom");
    store.getStringPref.mockImplementation((name: string, fallback: string) => {
      if (name === LOAD_BAR_PREFERENCES.thickness) throw new Error("wrong type");
      return values.get(name) ?? fallback;
    });

    expect(preferences.read()).toEqual({
      ...DEFAULT_SETTINGS,
      revealDelayMs: 100,
    });
  });

  it("observes every exact preference and emits a refreshed snapshot", () => {
    const { observers, preferences, store, values } = setup();
    const listener = vi.fn();
    const dispose = preferences.install(listener);

    expect(store.addObserver.mock.calls.map(([name]) => name)).toEqual(names);
    values.set(LOAD_BAR_PREFERENCES.color, "firefox");
    observers.get(LOAD_BAR_PREFERENCES.color)?.observe();
    expect(listener).toHaveBeenCalledWith({
      placement: "bottom",
      thickness: 4,
      color: "firefox",
      revealDelayMs: 100,
    });

    const retained = observers.get(LOAD_BAR_PREFERENCES.color);
    dispose();
    dispose();
    retained?.observe();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.removeObserver.mock.calls.map(([name]) => name)).toEqual(
      [...names].reverse(),
    );
    expect(observers.size).toBe(0);
  });

  it("removes acquired observers when registration fails", () => {
    const { preferences, store } = setup();
    store.addObserver.mockImplementation((name: string) => {
      if (name === LOAD_BAR_PREFERENCES.color) throw new Error("registration failed");
    });

    expect(() => preferences.install(vi.fn())).toThrow("registration failed");
    expect(store.removeObserver.mock.calls.map(([name]) => name)).toEqual(
      names.slice(0, 2).reverse(),
    );
  });
});
