import type { Palette } from "../core/palette.ts";
import {
  type PropertyOwnership,
  type PropertySnapshot,
  planPropertyApply,
  planPropertyRestore,
} from "../core/property-ledger.ts";

// Zen 1.21.16b f4d9821: GradientGenerator 60-66,1730-1782; ZenSpace 392-407; theme/workspaces/omnibox CSS.

export const PALETTE_GENERATION_ATTRIBUTE = "zen-palette-bridge-generation";

export interface StyleDeclarationPort {
  getPropertyPriority(name: string): string;
  getPropertyValue(name: string): string;
  removeProperty(name: string): unknown;
  setProperty(name: string, value: string, priority?: string): void;
}

export interface StyleElementPort {
  readonly style: StyleDeclarationPort;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  setAttribute(name: string, value: string): void;
}

export interface PaletteStyleTargets {
  readonly browserBackground: StyleElementPort;
  readonly generationToken: string;
  readonly root: StyleElementPort;
  readonly toolbarBackground: StyleElementPort;
  readonly workspaces: () => readonly StyleElementPort[];
}

export interface PaletteStyleDocumentPort {
  readonly documentElement: StyleElementPort;
  getElementById(id: string): StyleElementPort | null;
  querySelectorAll(selector: "zen-workspace"): ArrayLike<StyleElementPort>;
}

export interface PaletteStyleView {
  apply(palette: Palette): boolean;
  dispose(): boolean;
}

const snapshot = (style: StyleDeclarationPort, name: string): PropertySnapshot => ({
  value: style.getPropertyValue(name),
  priority: style.getPropertyPriority(name),
});

class OwnedStyleProperties {
  readonly #properties = new Map<StyleElementPort, Map<string, PropertyOwnership>>();

  apply(target: StyleElementPort, name: string, value: string): void {
    let properties = this.#properties.get(target);
    if (!properties) {
      properties = new Map();
      this.#properties.set(target, properties);
    }
    const current = snapshot(target.style, name);
    const next = { value, priority: "important" };
    const plan = planPropertyApply(properties.get(name), current, next);
    properties.set(name, plan.ownership);
    if (plan.write) {
      target.style.setProperty(name, next.value, next.priority);
    }
  }

  restore(): void {
    const errors: unknown[] = [];
    for (const [target, properties] of this.#properties) {
      for (const [name, ownership] of properties) {
        try {
          const plan = planPropertyRestore(ownership, snapshot(target.style, name));
          if (plan.kind === "leave") {
            continue;
          }
          if (plan.value.value === "") {
            target.style.removeProperty(name);
          } else {
            target.style.setProperty(name, plan.value.value, plan.value.priority);
          }
        } catch (error) {
          errors.push(error);
        }
      }
    }
    this.#properties.clear();
    if (errors.length > 0) {
      throw new AggregateError(errors, "could not restore Palette Bridge styles");
    }
  }
}

const rootProperties = (palette: Palette): ReadonlyArray<readonly [string, string]> => [
  ["--zen-palette-bridge-color-scheme", palette.mode],
  ["--zen-primary-color", palette.accent],
  ["--zen-branding-bg", palette.mainBackground],
  ["--zen-branding-bg-reverse", palette.strongForeground],
  ["--zen-colors-primary", palette.secondarySurface],
  ["--zen-colors-secondary", palette.secondarySurface],
  ["--zen-colors-tertiary", palette.mainBackground],
  ["--zen-colors-hover-bg", palette.selectionSurface],
  ["--zen-colors-primary-foreground", palette.strongForeground],
  ["--zen-colors-border", palette.border],
  ["--zen-colors-border-contrast", palette.border],
  ["--zen-colors-input-bg", palette.secondarySurface],
  ["--zen-dialog-background", palette.secondarySurface],
  ["--zen-urlbar-background", palette.secondarySurface],
  ["--zen-urlbar-background-base", palette.secondarySurface],
  ["--zen-urlbar-background-transparent", palette.secondarySurface],
  ["--zen-toolbar-element-bg", palette.secondarySurface],
  ["--zen-toolbar-element-bg-hover", palette.selectionSurface],
  ["--zen-themed-toolbar-bg-transparent", palette.mainBackground],
  ["--toolbox-textcolor", palette.normalForeground],
  ["--toolbox-textcolor-inactive", palette.mutedForeground],
  ["--toolbar-color-scheme", palette.mode],
  ["--toolbar-field-color", palette.normalForeground],
  ["--toolbar-field-background-color", palette.secondarySurface],
  ["--toolbarbutton-icon-fill", palette.normalForeground],
  ["--arrowpanel-background", palette.secondarySurface],
  ["--arrowpanel-color", palette.normalForeground],
  ["--panel-separator-color", palette.border],
];

export const createPaletteStyleView = ({
  browserBackground,
  generationToken,
  root,
  toolbarBackground,
  workspaces,
}: PaletteStyleTargets): PaletteStyleView => {
  const owned = new OwnedStyleProperties();
  let live = true;
  return {
    apply: palette => {
      if (!live) {
        return false;
      }
      for (const [name, value] of rootProperties(palette)) {
        owned.apply(root, name, value);
      }
      owned.apply(
        browserBackground,
        "--zen-main-browser-background",
        palette.mainBackground,
      );
      owned.apply(
        toolbarBackground,
        "--zen-main-browser-background-toolbar",
        palette.mainBackground,
      );
      for (const workspace of workspaces()) {
        owned.apply(workspace, "color-scheme", palette.mode);
        owned.apply(workspace, "--toolbox-textcolor", palette.normalForeground);
        owned.apply(workspace, "--zen-primary-color", palette.accent);
        owned.apply(
          workspace,
          "--tab-background-color-selected",
          palette.selectionSurface,
        );
        owned.apply(workspace, "--tab-selected-textcolor", palette.normalForeground);
      }
      root.setAttribute(PALETTE_GENERATION_ATTRIBUTE, generationToken);
      return true;
    },
    dispose: () => {
      if (!live) {
        return false;
      }
      live = false;
      const errors: unknown[] = [];
      try {
        if (root.getAttribute(PALETTE_GENERATION_ATTRIBUTE) === generationToken) {
          root.removeAttribute(PALETTE_GENERATION_ATTRIBUTE);
        }
      } catch (error) {
        errors.push(error);
      }
      try {
        owned.restore();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, "could not dispose Palette Bridge styles");
      }
      return true;
    },
  };
};

export const createZenPaletteStyleView = (
  document: PaletteStyleDocumentPort,
  generationToken: string,
): PaletteStyleView => {
  const browserBackground = document.getElementById("zen-browser-background");
  const toolbarBackground = document.getElementById("zen-toolbar-background");
  if (!browserBackground || !toolbarBackground) {
    throw new Error("Zen browser background elements are unavailable");
  }
  return createPaletteStyleView({
    browserBackground,
    generationToken,
    root: document.documentElement,
    toolbarBackground,
    workspaces: () => Array.from(document.querySelectorAll("zen-workspace")),
  });
};
