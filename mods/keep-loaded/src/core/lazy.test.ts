import { describe, expect, it } from "vitest";
import { planLazyPinned } from "./lazy.ts";

describe("planLazyPinned", () => {
  it("writes nothing when Zen already loads pinned tabs lazily", () => {
    expect(planLazyPinned(true, true)).toEqual({ set: null, message: "" });
  });

  it("writes nothing when the setting is off and Zen already loads them eagerly", () => {
    expect(planLazyPinned(false, false)).toEqual({ set: null, message: "" });
  });

  it("turns laziness on when the setting is on but Zen is loading eagerly", () => {
    const plan = planLazyPinned(true, false);
    expect(plan.set).toBe(true);
    expect(plan.message).toMatch(/lazily from the next start/);
  });

  it("hands laziness back when the setting is turned off", () => {
    const plan = planLazyPinned(false, true);
    expect(plan.set).toBe(false);
    expect(plan.message).toMatch(/eagerly from the next start/);
  });

  it("never writes the value the pref already holds", () => {
    for (const intent of [true, false]) {
      for (const current of [true, false]) {
        const plan = planLazyPinned(intent, current);
        expect(plan.set).not.toBe(current);
      }
    }
  });

  it("says nothing when it writes nothing", () => {
    for (const intent of [true, false]) {
      for (const current of [true, false]) {
        const plan = planLazyPinned(intent, current);
        expect(plan.message === "").toBe(plan.set === null);
      }
    }
  });
});
