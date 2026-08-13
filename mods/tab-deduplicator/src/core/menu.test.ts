import { describe, expect, it } from "vitest";
import { dedupeMenuState } from "./menu.ts";

describe("dedupeMenuState", () => {
  it("disables the action when the browser API is unavailable", () => {
    expect(dedupeMenuState({ supported: false, duplicateCount: 4 })).toEqual({
      label: "Close Duplicate Tabs",
      disabled: true,
    });
  });

  it("keeps the action label stable when there is nothing to close", () => {
    expect(dedupeMenuState({ supported: true, duplicateCount: 0 })).toEqual({
      label: "Close Duplicate Tabs",
      disabled: true,
    });
  });

  it("keeps the action label stable for one tab that would close", () => {
    expect(dedupeMenuState({ supported: true, duplicateCount: 1 })).toEqual({
      label: "Close Duplicate Tabs",
      disabled: false,
    });
  });

  it("keeps the action label stable for multiple tabs that would close", () => {
    expect(dedupeMenuState({ supported: true, duplicateCount: 3 })).toEqual({
      label: "Close Duplicate Tabs",
      disabled: false,
    });
  });

  it("treats an invalid count as no work", () => {
    expect(dedupeMenuState({ supported: true, duplicateCount: -2 })).toEqual({
      label: "Close Duplicate Tabs",
      disabled: true,
    });
  });
});
