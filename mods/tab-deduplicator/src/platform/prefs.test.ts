import { describe, expect, it } from "vitest";
import { readIncludePinnedPreference } from "./prefs.ts";

describe("readIncludePinnedPreference", () => {
  it("returns a stored boolean", () => {
    expect(readIncludePinnedPreference(() => true)).toBe(true);
    expect(readIncludePinnedPreference(() => false)).toBe(false);
  });

  it("defaults false when the preference is missing, malformed, or unreadable", () => {
    expect(readIncludePinnedPreference(() => undefined)).toBe(false);
    expect(readIncludePinnedPreference(() => "true")).toBe(false);
    expect(
      readIncludePinnedPreference(() => {
        throw new Error("wrong preference type");
      }),
    ).toBe(false);
  });
});
