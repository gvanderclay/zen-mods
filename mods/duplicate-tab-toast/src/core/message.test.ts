import { describe, expect, it } from "vitest";
import { duplicateToastText } from "./message.ts";

describe("duplicateToastText", () => {
  it("uses singular text for one duplicated tab", () => {
    expect(duplicateToastText(1)).toBe("Tab duplicated!");
  });

  it("includes the count for multiple duplicated tabs", () => {
    expect(duplicateToastText(3)).toBe("3 tabs duplicated!");
  });
});
