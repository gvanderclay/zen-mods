import { describe, expect, it } from "vitest";
import { paletteIdentity, parsePalette } from "./palette.ts";

const VALID_PALETTE = {
  schemaVersion: 1,
  displayName: "Example palette",
  mode: "dark",
  accent: "#7daea3",
  mainBackground: "#282828",
  secondarySurface: "#1d2021",
  selectionSurface: "#3c3836",
  border: "#7c6f64",
  normalForeground: "#d4be98",
  mutedForeground: "#a89984",
  strongForeground: "#ebdbb2",
};

const COLOR_FIELDS = [
  "accent",
  "mainBackground",
  "secondarySurface",
  "selectionSurface",
  "border",
  "normalForeground",
  "mutedForeground",
  "strongForeground",
] as const;

describe("palette document", () => {
  it.each(["dark", "light"] as const)("accepts a complete version 1 %s palette", mode => {
    const palette = { ...VALID_PALETTE, mode };
    expect(parsePalette(palette)).toEqual({
      ok: true,
      palette,
    });
  });

  it("rejects values that are not JSON objects", () => {
    for (const value of [undefined, null, [], "palette", 1]) {
      expect(parsePalette(value)).toEqual({
        ok: false,
        error: "palette must be an object",
      });
    }
  });

  it("rejects missing and unsupported schema versions", () => {
    const { schemaVersion: _, ...withoutVersion } = VALID_PALETTE;
    for (const value of [
      withoutVersion,
      { ...VALID_PALETTE, schemaVersion: 0 },
      {
        ...VALID_PALETTE,
        schemaVersion: 2,
      },
      { ...VALID_PALETTE, schemaVersion: "1" },
    ]) {
      expect(parsePalette(value)).toEqual({
        ok: false,
        error: "schemaVersion must be 1",
      });
    }
  });

  it("rejects missing and unsupported modes", () => {
    const { mode: _, ...withoutMode } = VALID_PALETTE;
    for (const value of [
      withoutMode,
      { ...VALID_PALETTE, mode: "auto" },
      {
        ...VALID_PALETTE,
        mode: 1,
      },
    ]) {
      expect(parsePalette(value)).toEqual({
        ok: false,
        error: "mode must be dark or light",
      });
    }
  });

  it("accepts an omitted display name and rejects a non-string display name", () => {
    const { displayName: _, ...withoutDisplayName } = VALID_PALETTE;
    expect(parsePalette(withoutDisplayName)).toEqual({
      ok: true,
      palette: withoutDisplayName,
    });
    expect(parsePalette({ ...VALID_PALETTE, displayName: 1 })).toEqual({
      ok: false,
      error: "displayName must be a string",
    });
  });

  it("requires every semantic color as lowercase #rrggbb", () => {
    for (const field of COLOR_FIELDS) {
      for (const value of [undefined, "#fff", "#ABCDEF", "#12345678", "red", 1]) {
        expect(parsePalette({ ...VALID_PALETTE, [field]: value })).toEqual({
          ok: false,
          error: `${field} must be a lowercase #rrggbb color`,
        });
      }
    }
  });

  it("rejects unknown fields", () => {
    expect(parsePalette({ ...VALID_PALETTE, accentForeground: "#ffffff" })).toEqual({
      ok: false,
      error: "unexpected field: accentForeground",
    });
  });

  it("gives equivalent documents one stable identity", () => {
    const reordered = Object.fromEntries(Object.entries(VALID_PALETTE).reverse());
    const first = parsePalette(VALID_PALETTE);
    const second = parsePalette(reordered);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(paletteIdentity(first.palette)).toBe(paletteIdentity(second.palette));
    }
  });
});
