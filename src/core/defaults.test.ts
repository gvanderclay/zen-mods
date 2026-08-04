import { describe, expect, it } from "vitest";
import prefsJson from "../../preferences.json";
import { DEFAULT_DEBUG, DEFAULT_LAZY_PINNED, DEFAULT_MATCH } from "./defaults.ts";

/**
 * The only types Sine renders (`tagNames` in its `core/preferences.sys.mjs`).
 * `validatePref` drops anything else and returns null without complaining, so a
 * typo does not fail — the row is just missing from the dialog.
 */
const SINE_TYPES = ["separator", "checkbox", "dropdown", "text", "string"];

interface SinePref {
  type: string;
  property?: string;
  label?: string;
  defaultValue?: string | boolean;
  restart?: boolean;
}

const prefs: SinePref[] = prefsJson;
const find = (property: string) => prefs.find(pref => pref.property === property);

describe("preferences.json", () => {
  it("only uses pref types Sine knows how to render", () => {
    expect(prefs.length).toBeGreaterThan(0);
    for (const pref of prefs) {
      expect(SINE_TYPES).toContain(pref.type);
    }
  });

  it("only writes prefs in this mod's own namespace", () => {
    for (const pref of prefs.filter(entry => entry.property)) {
      expect(pref.property).toMatch(/^zen\.keep-loaded\./);
    }
  });

  it("declares the allowlist default the runtime falls back to", () => {
    const pref = find("zen.keep-loaded.match");
    expect(pref?.type).toBe("string");
    expect(pref?.defaultValue).toBe(DEFAULT_MATCH);
  });

  it("declares the debug default the runtime falls back to", () => {
    const pref = find("zen.keep-loaded.debug");
    expect(pref?.type).toBe("checkbox");
    expect(pref?.defaultValue).toBe(DEFAULT_DEBUG);
  });

  it("never asks for a restart, because every setting applies live", () => {
    // Sine's restart toast has fixed wording and overstates the case anyway: a
    // mod reload is enough. A row carrying it is a row we failed to make live.
    for (const pref of prefs) {
      expect(pref.restart).toBeFalsy();
    }
  });

  it("declares the lazy-pinned default the runtime falls back to", () => {
    const pref = find("zen.keep-loaded.lazy-pinned");
    expect(pref?.type).toBe("checkbox");
    expect(pref?.defaultValue).toBe(DEFAULT_LAZY_PINNED);
  });

  it("says in the label that lazy pinned tabs only apply at the next start", () => {
    // The pref governs session restore, so the write is live but Zen reads it at
    // startup. Saying so in the label beats Sine's transient restart toast.
    expect(find("zen.keep-loaded.lazy-pinned")?.label).toMatch(/next start/);
  });

  it("never declares a checkbox that defaults to false", () => {
    // applyCheckbox: `if (pref.defaultValue && !prefExists) setBoolPref(prop, true)`.
    // A false default is never written, so the fallback in prefs.ts would be the
    // real default and the two would silently disagree. Omit it instead.
    for (const pref of prefs.filter(entry => entry.type === "checkbox")) {
      expect(pref.defaultValue).not.toBe(false);
    }
    expect(DEFAULT_DEBUG).toBe(true);
    expect(DEFAULT_LAZY_PINNED).toBe(true);
  });
});
