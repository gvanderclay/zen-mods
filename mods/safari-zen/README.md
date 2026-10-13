# Safari Zen

A style-only [Sine](https://github.com/CosmoCreeper/Sine) mod that gives Zen compact
mode a lighter, floating sidebar panel without changing browser or macOS settings.

## Behavior

- Floats the compact sidebar 18 pixels from the window edge and rounds its panel.
- Refines Zen's existing acrylic effect when you have enabled it in Zen.
- Adds a restrained glass treatment to the URL field and selected tab.
- Uses Zen's native compact-sidebar reveal state with a gentler opening curve.
- Reduces the reveal to a short ease-out transition when the system requests reduced
  motion.

## Settings

- **Floating sidebar panel** controls panel spacing, radius, and internal padding.
- **Zen acrylic sidebar** toggles Zen's own `zen.theme.acrylic-sidebar` preference,
  which Zen has no settings switch for. Restart Zen after changing it.
- **Refine Zen acrylic** adjusts blur and saturation only when Zen's acrylic sidebar
  is enabled.
- **Glass URL field and selected tab** controls the compact-mode control treatment.
- **Gentle sidebar reveal** changes only the opening timing of Zen's compact sidebar.

This mod never enables Zen's acrylic sidebar on its own; it changes only when you
click its checkbox. Disabling the mod leaves that Zen preference as you last set it.

## Install

Enable **Install JS from unofficial sources** in Sine if it is required by your Sine
installation, then install:

    https://github.com/gvanderclay/zen-mods/tree/main/mods/safari-zen

For local development, run from the repository root:

    pnpm --filter @zen-mods/safari-zen install:local

Disable the original Safari-like Zen mod before enabling this one. Both change the same
compact sidebar surfaces.

## Rollback

Disable Safari Zen in Sine. It has no script, does not run commands, and does not write
macOS defaults or Zen-owned preferences.

## Compatibility

Validated against Zen 1.23.2b, build 20261009073723 (Firefox/Gecko 157.0.1). The private
compact-mode selectors and variables are from the installed source at:

    /Applications/Zen.app/Contents/Resources/browser/omni.ja
    chrome/browser/content/browser/zen-styles/zen-compact-mode.css

That source provides `--zen-compact-float`, `--zen-compact-mode-time`,
`--zen-compact-mode-func`, and the compact reveal attributes used here;
`#zen-toolbar-background` and `#titlebar` are in `browser.xhtml`. The acrylic rule is
gated on `zen.theme.acrylic-sidebar` (`defaults/preferences/firefox.js:1761`), which
replaced `zen.theme.acrylic-elements` in Zen 1.23. Revalidate the mod after a Zen
compact-mode change.

## Development

Run from the repository root:

    pnpm --filter @zen-mods/safari-zen check

`dist/` is intentionally absent: this is a style-only mod with no script bundle.
