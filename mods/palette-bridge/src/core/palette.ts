export interface Palette {
  readonly schemaVersion: 1;
  readonly displayName?: string;
  readonly mode: "dark" | "light";
  readonly accent: string;
  readonly mainBackground: string;
  readonly secondarySurface: string;
  readonly selectionSurface: string;
  readonly border: string;
  readonly normalForeground: string;
  readonly mutedForeground: string;
  readonly strongForeground: string;
}

export type PaletteParseResult =
  | { readonly ok: true; readonly palette: Palette }
  | { readonly ok: false; readonly error: string };

export const PALETTE_COLOR_FIELDS = [
  "accent",
  "mainBackground",
  "secondarySurface",
  "selectionSurface",
  "border",
  "normalForeground",
  "mutedForeground",
  "strongForeground",
] as const;

const COLOR_PATTERN = /^#[0-9a-f]{6}$/;
const PALETTE_FIELDS = new Set<string>([
  "schemaVersion",
  "displayName",
  "mode",
  ...PALETTE_COLOR_FIELDS,
]);

export const paletteIdentity = (palette: Palette): string =>
  JSON.stringify([
    palette.schemaVersion,
    palette.displayName ?? null,
    palette.mode,
    ...PALETTE_COLOR_FIELDS.map(field => palette[field]),
  ]);

export const parsePalette = (value: unknown): PaletteParseResult => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "palette must be an object" };
  }
  const palette = value as Record<string, unknown>;
  if (palette.schemaVersion !== 1) {
    return { ok: false, error: "schemaVersion must be 1" };
  }
  if (palette.mode !== "dark" && palette.mode !== "light") {
    return { ok: false, error: "mode must be dark or light" };
  }
  if (palette.displayName !== undefined && typeof palette.displayName !== "string") {
    return { ok: false, error: "displayName must be a string" };
  }
  const unexpectedField = Object.keys(palette)
    .filter(field => !PALETTE_FIELDS.has(field))
    .sort()[0];
  if (unexpectedField !== undefined) {
    return { ok: false, error: `unexpected field: ${unexpectedField}` };
  }
  for (const field of PALETTE_COLOR_FIELDS) {
    if (typeof palette[field] !== "string" || !COLOR_PATTERN.test(palette[field])) {
      return { ok: false, error: `${field} must be a lowercase #rrggbb color` };
    }
  }
  const validated = palette as unknown as Palette;
  return {
    ok: true,
    palette: {
      schemaVersion: 1,
      ...(validated.displayName === undefined
        ? {}
        : { displayName: validated.displayName }),
      mode: validated.mode,
      accent: validated.accent,
      mainBackground: validated.mainBackground,
      secondarySurface: validated.secondarySurface,
      selectionSurface: validated.selectionSurface,
      border: validated.border,
      normalForeground: validated.normalForeground,
      mutedForeground: validated.mutedForeground,
      strongForeground: validated.strongForeground,
    },
  };
};
