import { describe, expect, it } from "vitest";
import { dedupeMenuState } from "./menu.ts";

describe("dedupeMenuState", () => {
  it("disables the action when the browser API is unavailable", () => {
    expect(dedupeMenuState({ supported: false, duplicateCount: 4 })).toEqual({
      label: "Deduplicate tabs (unsupported)",
      disabled: true,
    });
  });

  it("explains that there is nothing to close", () => {
    expect(dedupeMenuState({ supported: true, duplicateCount: 0 })).toEqual({
      label: "No duplicate tabs",
      disabled: true,
    });
  });

  it("uses a singular label for one tab that would close", () => {
    expect(dedupeMenuState({ supported: true, duplicateCount: 1 })).toEqual({
      label: "Close 1 duplicate tab in this space",
      disabled: false,
    });
  });

  it("uses a plural label for multiple tabs that would close", () => {
    expect(dedupeMenuState({ supported: true, duplicateCount: 3 })).toEqual({
      label: "Close 3 duplicate tabs in this space",
      disabled: false,
    });
  });

  it("treats an invalid count as no work", () => {
    expect(dedupeMenuState({ supported: true, duplicateCount: -2 })).toEqual({
      label: "No duplicate tabs",
      disabled: true,
    });
  });
});
