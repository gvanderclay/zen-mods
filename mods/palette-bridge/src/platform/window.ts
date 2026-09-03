export interface PaletteWindowRootPort {
  hasAttribute(name: string): boolean;
}

// Zen 1.21.16b f4d9821: zen-theme.css 230-245.
export const isPaletteWindowEligible = (root: PaletteWindowRootPort): boolean =>
  !root.hasAttribute("zen-private-window") && !root.hasAttribute("zen-unsynced-window");
