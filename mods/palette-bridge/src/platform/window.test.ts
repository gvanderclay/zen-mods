import { describe, expect, it } from "vitest";
import { isPaletteWindowEligible } from "./window.ts";

const rootWith = (...attributes: string[]) => ({
  hasAttribute: (name: string) => attributes.includes(name),
});

describe("palette window eligibility", () => {
  it("accepts an ordinary browser window", () => {
    expect(isPaletteWindowEligible(rootWith())).toBe(true);
  });

  it.each(["zen-private-window", "zen-unsynced-window"])(
    "leaves a %s window native",
    attribute => {
      expect(isPaletteWindowEligible(rootWith(attribute))).toBe(false);
    },
  );
});
