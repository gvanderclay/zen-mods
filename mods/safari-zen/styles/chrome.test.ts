import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import preferences from "../preferences.json";
import theme from "../theme.json";

const css = readFileSync(new URL("./chrome.css", import.meta.url), "utf8");

describe("Safari Zen manifest", () => {
  it("is a style-only mod with local preferences", () => {
    expect(theme.style).toEqual({ chrome: "styles/chrome.css" });
    expect(theme.preferences).toBe("preferences.json");
    expect(theme.scripts).toBeUndefined();
  });

  it("keeps every setting in the mod namespace", () => {
    const settings = preferences.filter(
      (
        preference,
      ): preference is { property: string; type: string; defaultValue: boolean } =>
        "property" in preference,
    );

    expect(settings.map(setting => setting.property)).toEqual([
      "mod.safari-zen.panel",
      "mod.safari-zen.acrylic",
      "mod.safari-zen.glass-controls",
      "mod.safari-zen.reveal-motion",
    ]);
    expect(settings.every(setting => setting.type === "checkbox")).toBe(true);
    expect(settings.every(setting => setting.defaultValue === true)).toBe(true);
  });
});

describe("Safari Zen CSS", () => {
  it("scopes visual changes to usable compact mode", () => {
    expect(css).toContain(
      ':root[zen-compact-mode="true"]:not([customizing]):not([inDOMFullscreen="true"])',
    );
    expect(css).toContain("--zen-compact-float: 18px !important");
  });

  it("keeps acrylic opt-in and respects accessibility preferences", () => {
    expect(css).toContain(
      '@media (-moz-pref("zen.theme.acrylic-elements")) and (-moz-pref("mod.safari-zen.acrylic"))',
    );
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@media (prefers-contrast)");
  });

  it("does not introduce persistent or privileged behavior", () => {
    for (const forbidden of [
      "/usr/bin/defaults",
      "nsIProcess",
      "gZenUIManager",
      "motion.animate",
      "zen.theme.content-element-separation",
    ]) {
      expect(css).not.toContain(forbidden);
    }
  });
});
