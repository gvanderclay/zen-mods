import { describe, expect, it } from "vitest";
import type { Palette } from "../core/palette.ts";
import {
  createPaletteStyleView,
  createZenPaletteStyleView,
  PALETTE_GENERATION_ATTRIBUTE,
} from "./styles.ts";

class FakeStyle {
  readonly values = new Map<string, { value: string; priority: string }>();

  getPropertyPriority(name: string): string {
    return this.values.get(name)?.priority ?? "";
  }

  getPropertyValue(name: string): string {
    return this.values.get(name)?.value ?? "";
  }

  removeProperty(name: string): void {
    this.values.delete(name);
  }

  setProperty(name: string, value: string, priority = ""): void {
    this.values.set(name, { value, priority });
  }
}

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly style = new FakeStyle();

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

const PALETTE: Palette = {
  schemaVersion: 1,
  displayName: "First",
  mode: "dark",
  accent: "#112233",
  mainBackground: "#223344",
  secondarySurface: "#334455",
  selectionSurface: "#445566",
  border: "#556677",
  normalForeground: "#ccddee",
  mutedForeground: "#aabbcc",
  strongForeground: "#ffffff",
};

const EXPECTED_ROOT_PROPERTIES = {
  "--zen-palette-bridge-color-scheme": PALETTE.mode,
  "--zen-primary-color": PALETTE.accent,
  "--zen-branding-bg": PALETTE.mainBackground,
  "--zen-branding-bg-reverse": PALETTE.strongForeground,
  "--zen-colors-primary": PALETTE.secondarySurface,
  "--zen-colors-secondary": PALETTE.secondarySurface,
  "--zen-colors-tertiary": PALETTE.mainBackground,
  "--zen-colors-hover-bg": PALETTE.selectionSurface,
  "--zen-colors-primary-foreground": PALETTE.strongForeground,
  "--zen-colors-border": PALETTE.border,
  "--zen-colors-border-contrast": PALETTE.border,
  "--zen-colors-input-bg": PALETTE.secondarySurface,
  "--zen-dialog-background": PALETTE.secondarySurface,
  "--zen-urlbar-background": PALETTE.secondarySurface,
  "--zen-urlbar-background-base": PALETTE.secondarySurface,
  "--zen-urlbar-background-transparent": PALETTE.secondarySurface,
  "--zen-toolbar-element-bg": PALETTE.secondarySurface,
  "--zen-toolbar-element-bg-hover": PALETTE.selectionSurface,
  "--zen-themed-toolbar-bg-transparent": PALETTE.mainBackground,
  "--toolbox-textcolor": PALETTE.normalForeground,
  "--toolbox-textcolor-inactive": PALETTE.mutedForeground,
  "--toolbar-color-scheme": PALETTE.mode,
  "--toolbar-field-color": PALETTE.normalForeground,
  "--toolbar-field-background-color": PALETTE.secondarySurface,
  "--toolbarbutton-icon-fill": PALETTE.normalForeground,
  "--arrowpanel-background": PALETTE.secondarySurface,
  "--arrowpanel-color": PALETTE.normalForeground,
  "--panel-separator-color": PALETTE.border,
};

const setup = () => {
  const root = new FakeElement();
  const browserBackground = new FakeElement();
  const toolbarBackground = new FakeElement();
  const workspace = new FakeElement();
  const view = createPaletteStyleView({
    browserBackground,
    generationToken: "generation-1",
    root,
    toolbarBackground,
    workspaces: () => [workspace],
  });
  return { browserBackground, root, toolbarBackground, view, workspace };
};

describe("palette style view", () => {
  it("resolves the exact Zen background elements", () => {
    const root = new FakeElement();
    const browserBackground = new FakeElement();
    const toolbarBackground = new FakeElement();
    const workspace = new FakeElement();
    const document = {
      documentElement: root,
      getElementById: (id: string) =>
        new Map([
          ["zen-browser-background", browserBackground],
          ["zen-toolbar-background", toolbarBackground],
        ]).get(id) ?? null,
      querySelectorAll: () => [workspace],
    };

    const view = createZenPaletteStyleView(document, "generation-2");
    expect(view.apply(PALETTE)).toBe(true);
    expect(
      browserBackground.style.getPropertyValue("--zen-main-browser-background"),
    ).toBe(PALETTE.mainBackground);
    expect(
      browserBackground.style.getPropertyPriority("--zen-main-browser-background"),
    ).toBe("important");
    expect(
      toolbarBackground.style.getPropertyValue("--zen-main-browser-background-toolbar"),
    ).toBe(PALETTE.mainBackground);
    expect(
      toolbarBackground.style.getPropertyPriority(
        "--zen-main-browser-background-toolbar",
      ),
    ).toBe("important");
  });

  it("fails when an exact Zen background element is unavailable", () => {
    const document = {
      documentElement: new FakeElement(),
      getElementById: () => null,
      querySelectorAll: () => [],
    };

    expect(() => createZenPaletteStyleView(document, "generation-2")).toThrow(
      "Zen browser background elements are unavailable",
    );
  });

  it("maps every semantic color to the fixed Zen browser-chrome properties", () => {
    const { browserBackground, root, toolbarBackground, view, workspace } = setup();

    expect(view.apply(PALETTE)).toBe(true);
    expect(root.getAttribute(PALETTE_GENERATION_ATTRIBUTE)).toBe("generation-1");
    for (const [name, value] of Object.entries(EXPECTED_ROOT_PROPERTIES)) {
      expect(root.style.getPropertyValue(name), name).toBe(value);
      expect(root.style.getPropertyPriority(name), name).toBe("important");
    }
    expect(
      browserBackground.style.getPropertyValue("--zen-main-browser-background"),
    ).toBe(PALETTE.mainBackground);
    expect(
      toolbarBackground.style.getPropertyValue("--zen-main-browser-background-toolbar"),
    ).toBe(PALETTE.mainBackground);
    expect(workspace.style.values).toEqual(
      new Map([
        ["color-scheme", { value: PALETTE.mode, priority: "important" }],
        [
          "--toolbox-textcolor",
          { value: PALETTE.normalForeground, priority: "important" },
        ],
        ["--zen-primary-color", { value: PALETTE.accent, priority: "important" }],
        [
          "--tab-background-color-selected",
          { value: PALETTE.selectionSurface, priority: "important" },
        ],
        [
          "--tab-selected-textcolor",
          { value: PALETTE.normalForeground, priority: "important" },
        ],
      ]),
    );
  });

  it("restores the latest baseline without replacing a newer foreign value", () => {
    const { browserBackground, root, toolbarBackground, view, workspace } = setup();
    root.style.setProperty("--zen-primary-color", "native-start");
    browserBackground.style.setProperty(
      "--zen-main-browser-background",
      "native-gradient",
    );
    workspace.style.setProperty("--toolbox-textcolor", "native-workspace");

    view.apply(PALETTE);
    root.style.setProperty("--zen-primary-color", "native-latest");
    view.apply({ ...PALETTE, accent: "#667788" });
    root.style.setProperty("--zen-colors-border", "foreign-after", "important");

    expect(view.dispose()).toBe(true);
    expect(view.dispose()).toBe(false);
    expect(view.apply(PALETTE)).toBe(false);
    expect(root.getAttribute(PALETTE_GENERATION_ATTRIBUTE)).toBeNull();
    expect(root.style.getPropertyValue("--zen-primary-color")).toBe("native-latest");
    expect(root.style.getPropertyValue("--zen-colors-border")).toBe("foreign-after");
    expect(root.style.getPropertyValue("--zen-colors-tertiary")).toBe("");
    expect(root.style.getPropertyValue("--zen-palette-bridge-color-scheme")).toBe("");
    expect(
      browserBackground.style.getPropertyValue("--zen-main-browser-background"),
    ).toBe("native-gradient");
    expect(
      toolbarBackground.style.getPropertyValue("--zen-main-browser-background-toolbar"),
    ).toBe("");
    expect(workspace.style.getPropertyValue("--toolbox-textcolor")).toBe(
      "native-workspace",
    );
  });
});
