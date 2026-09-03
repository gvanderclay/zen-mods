import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import paletteSchemaJson from "../../palette.schema.json";
import preferencesJson from "../../preferences.json";
import themeJson from "../../theme.json";
import { PALETTE_COLOR_FIELDS } from "./palette.ts";
import { PALETTE_PATH_PREFERENCE } from "./path.ts";

interface PaletteSchema {
  $schema: string;
  title: string;
  type: string;
  additionalProperties: boolean;
  required: string[];
  properties: Record<string, Record<string, unknown>>;
}

describe("public package contract", () => {
  it("keeps the machine schema aligned with the runtime palette fields", () => {
    const schema = paletteSchemaJson as PaletteSchema;
    const fields = ["schemaVersion", "displayName", "mode", ...PALETTE_COLOR_FIELDS];

    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties)).toEqual(fields);
    expect(schema.required).toEqual(fields.filter(field => field !== "displayName"));
    expect(schema.properties.schemaVersion).toEqual({ const: 1 });
    expect(schema.properties.displayName).toEqual({ type: "string" });
    expect(schema.properties.mode).toEqual({ enum: ["dark", "light"] });
    for (const field of PALETTE_COLOR_FIELDS) {
      expect(schema.properties[field]).toEqual({
        type: "string",
        pattern: "^#[0-9a-f]{6}$",
      });
    }
  });

  it("declares one empty path override in the mod namespace", () => {
    expect(preferencesJson).toEqual([
      {
        type: "string",
        property: PALETTE_PATH_PREFERENCE,
        label: "Palette file path (leave empty to use the profile default)",
        placeholder: "Profile chrome folder/palette-bridge.json",
        defaultValue: "",
      },
    ]);
  });

  it("declares one unload-safe browser-window script", () => {
    expect(themeJson.id).toBe("palette-bridge");
    expect(themeJson.preferences).toBe("preferences.json");
    expect(themeJson.scripts).toEqual({
      "dist/palette-bridge.uc.mjs": {
        include: ["chrome://browser/content/browser.xhtml"],
      },
    });
    expect(themeJson.style).toEqual({ chrome: "styles/chrome.css" });
    expect(themeJson.supportsUnload).toBe(true);
  });

  it("applies palette mode only to browser chrome while a generation owns it", () => {
    const chromeCss = readFileSync(
      new URL("../../styles/chrome.css", import.meta.url),
      "utf8",
    );

    expect(chromeCss).toContain(":root[zen-palette-bridge-generation]");
    expect(chromeCss).toContain("#browser");
    expect(chromeCss).toContain("panel");
    expect(chromeCss).toContain("menupopup");
    expect(chromeCss).toContain(
      "color-scheme: var(--zen-palette-bridge-color-scheme) !important",
    );
    expect(chromeCss).not.toContain("browser[type='content']");
    expect(chromeCss).not.toContain('browser[type="content"]');
  });
});
