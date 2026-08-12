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
- Adds a tab-style close button to History page rows. It performs Firefox's native
  permanent Delete Page operation and leaves History containers untouched.
- Preserves native colors, focus, selection, drag feedback, header controls, loading
  state, resizing, and left/right placement.
- Uses Firefox's own 200 ms sidebar motion when opening or closing Bookmarks and
  History, then completes the native close and unload.
- Leaves Synced Tabs, extension sidebars, Zen's tab sidebar, and web panels unchanged.

The mod exposes no settings and respects Firefox's sidebar-animation and reduced-motion
preferences.

## Compatibility

The initial version was validated on Zen 1.21.13b, Gecko 153.0.3, and Sine 2.3.3.0.
It targets the legacy sidebar documents that this Zen build still uses:

- `chrome://browser/content/places/bookmarksSidebar.xhtml`
- `chrome://browser/content/places/historySidebar.xhtml`

The corresponding installed source lives in `browser/omni.ja` under
`chrome/browser/content/browser/places/` and
`chrome/browser/skin/classic/browser/places/sidebar.css`. The animation bridge targets
`SidebarController.show`, `showInitially`, `hide`, and `_animateSidebarContainer` in
`chrome/browser/content/browser/sidebar/browser-sidebar.js`. Zen 1.21.13b locks
`sidebar.revamp` off, while that controller limits its native animation call to the
revamped path. If Zen moves to Firefox's new sidebar implementation, this bridge must
be removed or revalidated.

## Install

For local development, quit Zen and run from the repository root:

    pnpm run install:local sidebar-polish

For a GitHub install, use:

    https://github.com/gvanderclay/zen-mods/tree/main/mods/sidebar-polish

## Development

    pnpm --filter @zen-mods/sidebar-polish check

The generated `dist/sidebar-polish.uc.mjs` bundle is committed and must be rebuilt from
source.
