import { describe, expect, it } from "vitest";
import { wakeButtonState } from "./actions.ts";

describe("wakeButtonState", () => {
  it("offers to wake the tabs that are asleep, counting them", () => {
    expect(wakeButtonState({ kept: 3, sleeping: 2, busy: false })).toEqual({
      label: "Wake 2 sleeping tabs",
      disabled: false,
    });
  });

  it("counts one tab in the singular", () => {
    expect(wakeButtonState({ kept: 3, sleeping: 1, busy: false }).label).toBe(
      "Wake 1 sleeping tab",
    );
  });

  it("says so rather than offering a button that would do nothing", () => {
    const state = wakeButtonState({ kept: 5, sleeping: 0, busy: false });
    expect(state.disabled).toBe(true);
    expect(state.label).toContain("awake");
  });

  it("does not claim every kept tab is awake when none are kept", () => {
    const state = wakeButtonState({ kept: 0, sleeping: 0, busy: false });
    expect(state.disabled).toBe(true);
    expect(state.label).not.toContain("awake");
  });

  it("reports a sweep that is already running, whatever the count says", () => {
    // The count is read from a snapshot the running sweep is busy invalidating, so
    // the lock is the only thing worth reporting while it is held.
    for (const sleeping of [0, 1, 4]) {
      const state = wakeButtonState({ kept: 5, sleeping, busy: true });
      expect(state.disabled).toBe(true);
      expect(state.label).toContain("Waking");
    }
  });
});
