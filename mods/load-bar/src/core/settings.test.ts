import { describe, expect, it } from "vitest";
import preferencesJson from "../../preferences.json";
import themeJson from "../../theme.json";
import {
  DEFAULT_SETTINGS,
  LOAD_BAR_PREFERENCES,
  parseLoadBarSettings,
} from "./settings.ts";

interface SineDropdown {
  type: string;
  property: string;
  label: string;
  defaultValue: string;
  placeholder?: boolean;
  options: Array<{ label: string; value: string }>;
  restart?: boolean;
}

const preferences = preferencesJson as SineDropdown[];

describe("load bar settings", () => {
  it("accepts every approved value", () => {
    expect(
      parseLoadBarSettings({
        placement: "bottom",
        thickness: "4",
        color: "zen",
        revealDelay: "100",
      }),
    ).toEqual({
      placement: "bottom",
      thickness: 4,
      color: "zen",
      revealDelayMs: 100,
    });
  });

  it("uses defaults for a missing or non-object settings snapshot", () => {
    for (const raw of [undefined, null, "top", 2, []]) {
      expect(parseLoadBarSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("falls back one malformed value at a time", () => {
    expect(
      parseLoadBarSettings({
        placement: "left",
        thickness: 3,
        color: "custom",
        revealDelay: "250",
      }),
    ).toEqual(DEFAULT_SETTINGS);

    expect(
      parseLoadBarSettings({
        placement: "bottom",
        thickness: "3",
        color: "zen",
        revealDelay: "500",
      }),
    ).toEqual({
      placement: "bottom",
      thickness: 3,
      color: "zen",
      revealDelayMs: 500,
    });
  });
});

describe("preferences.json", () => {
  it("is declared by the Sine manifest beside the single UC entry", () => {
    expect(themeJson.preferences).toBe("preferences.json");
    expect(Object.keys(themeJson.scripts)).toEqual(["dist/load-bar.uc.mjs"]);
    expect(themeJson.style).toEqual({ chrome: "styles/chrome.css" });
    expect(themeJson.supportsUnload).toBe(true);
  });

  it("declares only the four approved dropdowns in the mod namespace", () => {
    expect(preferences.map(preference => preference.property)).toEqual([
      LOAD_BAR_PREFERENCES.placement,
      LOAD_BAR_PREFERENCES.thickness,
      LOAD_BAR_PREFERENCES.color,
      LOAD_BAR_PREFERENCES.revealDelay,
    ]);
    for (const preference of preferences) {
      expect(preference.type).toBe("dropdown");
      expect(preference.property).toMatch(/^zen\.load-bar\./);
      expect(preference.placeholder).toBe(false);
      expect(preference.restart).toBeFalsy();
    }
  });

  it("keeps manifest defaults and options aligned with the runtime contract", () => {
    expect(
      preferences.map(({ defaultValue, options }) => ({
        defaultValue,
        values: options.map(option => option.value),
      })),
    ).toEqual([
      { defaultValue: "top", values: ["top", "bottom"] },
      { defaultValue: "2", values: ["2", "3", "4"] },
      { defaultValue: "firefox", values: ["firefox", "zen"] },
      { defaultValue: "200", values: ["0", "100", "200", "500"] },
    ]);
    expect(DEFAULT_SETTINGS).toEqual({
      placement: "top",
      thickness: 2,
      color: "firefox",
      revealDelayMs: 200,
    });
  });
});
