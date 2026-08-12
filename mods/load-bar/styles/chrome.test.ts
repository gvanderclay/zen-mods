import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./chrome.css", import.meta.url), "utf8");

describe("Load Bar motion", () => {
  it("wobbles one full-width segment through the clipped track", () => {
    expect(css).toContain("zen-load-bar-wobble 2.3s ease-in-out infinite");
    expect(css).toMatch(
      /@keyframes zen-load-bar-wobble[\s\S]*0%,[\s\S]*100%[\s\S]*translate:[^;]*-95%[\s\S]*50%[\s\S]*translate:[^;]*95%/,
    );
    expect(css).not.toContain("zen-load-bar-size");
  });

  it("fills before fading a successful load", () => {
    expect(css).toMatch(
      /data-zen-load-bar-state="completing"[^}]*opacity: 0[^}]*transition: opacity 100ms ease-out 180ms/,
    );
    expect(css).toMatch(
      /data-zen-load-bar-state="completing"[^}]*zen-load-bar__segment[^}]*translate: 0 0[^}]*transition: translate 180ms ease-out/,
    );
  });
});
