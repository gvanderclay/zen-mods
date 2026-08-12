# Sidebar Polish

A small [Sine](https://github.com/CosmoCreeper/Sine) mod that makes Firefox's
Bookmarks and History sidebars fit Zen's visual language without replacing native
behavior.

## Behavior

- Gives Bookmarks and History rows Zen's inset, rounded tab shape and interaction
  surfaces.
- Matches the native vertical-tab height, spacing, and macOS radius.
- Gives the search field Zen's URL-field surface and a single theme-colored focus
  ring.
- Preserves native colors, focus, selection, drag feedback, header controls, loading
  state, resizing, and left/right placement.
- Leaves Synced Tabs, extension sidebars, Zen's tab sidebar, and web panels unchanged.

The mod contains no JavaScript and exposes no settings.

## Compatibility

The initial version was validated on Zen 1.21.13b, Gecko 153.0.3, and Sine 2.3.3.0.
It targets the legacy sidebar documents that this Zen build still uses:

- `chrome://browser/content/places/bookmarksSidebar.xhtml`
- `chrome://browser/content/places/historySidebar.xhtml`

The corresponding installed source lives in `browser/omni.ja` under
`chrome/browser/content/browser/places/` and
`chrome/browser/skin/classic/browser/places/sidebar.css`. If Zen moves to Firefox's
new sidebar implementation, these scoped rules become inert instead of spilling into
unrelated surfaces.

## Install

For local development, quit Zen and run from the repository root:

    pnpm run install:local sidebar-polish

For a GitHub install, use:

    https://github.com/gvanderclay/zen-mods/tree/main/mods/sidebar-polish

## Development

    pnpm --filter @zen-mods/sidebar-polish check

There is no generated `dist/` output because this is a style-only mod.
