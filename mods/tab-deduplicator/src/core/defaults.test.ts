import { describe, expect, it } from "vitest";
import prefsJson from "../../preferences.json";
import themeJson from "../../theme.json";
import { DEFAULT_INCLUDE_PINNED, PREF_INCLUDE_PINNED } from "./defaults.ts";

interface SinePref {
  type: string;
  property?: string;
  label?: string;
  defaultValue?: string | boolean;
}

const prefs: SinePref[] = prefsJson;

describe("preferences.json", () => {
  it("is declared in the Sine manifest", () => {
    expect(themeJson.preferences).toBe("preferences.json");
  });

  it("declares one safely defaulted pinned-participation checkbox", () => {
    expect(prefs).toEqual([
      {
        type: "checkbox",
        property: PREF_INCLUDE_PINNED,
        label: "Include pinned tabs in duplicate actions",
        defaultValue: DEFAULT_INCLUDE_PINNED,
      },
    ]);
    expect(DEFAULT_INCLUDE_PINNED).toBe(false);
  });

  it("keeps every setting in the mod's own preference namespace", () => {
    for (const pref of prefs) {
      expect(pref.property).toMatch(/^zen\.tab-deduplicator\./);
    }
  });
});
