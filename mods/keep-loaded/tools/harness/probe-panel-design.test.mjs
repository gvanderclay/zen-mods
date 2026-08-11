import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const directory = new URL("./", import.meta.url);
const read = path => readFile(new URL(path, directory), "utf8");

describe("M16 production panel visual gate", () => {
  it("keeps the native header, scrolling body, fixed footer, and permanent live region", async () => {
    const panel = await read("../../src/platform/panel.ts");

    expect(panel).toContain('mainview-with-header="true"');
    expect(panel).toContain('class="panel-header"');
    expect(panel).toContain('class="panel-subview-body"');
    expect(panel).toContain('class="keep-loaded-panel-footer"');
    expect(panel).toContain('role="status"');
    expect(panel).toContain('aria-live="polite"');
    expect(panel).toContain('aria-atomic="true"');
  });

  it("uses semantic theme tokens and explicit contrast/overflow boundaries", async () => {
    const css = await read("../../styles/chrome.css");

    expect(css).toContain("--text-color-deemphasized");
    expect(css).toContain("--button-background-color-primary");
    expect(css).toContain("max-block-size:");
    expect(css).toContain("overflow-y: auto");
    expect(css).toContain("@media (prefers-contrast)");
    expect(css).toContain("@media (forced-colors: active)");
  });

  it("aligns the native header, report, and footer to one content grid", async () => {
    const css = await read("../../styles/chrome.css");

    expect(css).toContain(".keep-loaded-panelview > .panel-header");
    expect(css).toContain("text-align: start");
    expect(css).toContain("--panel-subview-body-padding: var(--dimension-12, 12px)");
    expect(css).toContain("var(--dimension-24, 24px)");
    expect(css).toContain("padding: 0 var(--dimension-8, 8px) var(--dimension-4, 4px)");
    expect(css).not.toContain("border-block-start");
  });

  it("compiles the embedded exact-Zen fixture and declares the full visual matrix", async () => {
    const probe = await read("probe-panel-design.mjs");
    const install = probe.match(/const INSTALL = `([\s\S]*?)`;\n\nconst CLEANUP/)?.[1];

    expect(install).toBeTypeOf("string");
    expect(() => new Function(install)).not.toThrow();
    expect(probe).toContain("window.windowUtils.USER_SHEET");
    expect(probe).toContain("window.windowUtils.loadSheet");
    expect(probe).toContain("window.windowUtils.removeSheet");
    expect(probe).toContain("const WIDTHS = [280, 320, 480]");
    expect(probe).toContain('const THEMES = ["light", "dark"]');
    expect(probe).toContain("const TEXT_SCALES = [1, 2]");
    for (const state of [
      "mixed",
      "busy",
      "recovery-limit",
      "empty",
      "unavailable",
      "overflow",
    ]) {
      expect(probe).toContain(`name: "${state}"`);
    }
  });
});
