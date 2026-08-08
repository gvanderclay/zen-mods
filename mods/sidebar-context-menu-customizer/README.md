# Sidebar Context Menu Customizer

A [Sine](https://github.com/CosmoCreeper/Sine) mod for
[Zen Browser](https://zen-browser.app) that lets you simplify the menu shown when
you right-click a sidebar tab.

## Behavior

The first time it runs, every existing action is hidden, leaving only **Customize tab
menu**. Open that submenu and opt actions back in with its checkboxes. Changes are
saved immediately and apply to every tab. **Show all actions** enables everything.

The list is generated from the live menu, so it includes compatible actions added by
other mods, including Tab Deduplicator. Firefox and Zen still decide whether an action
makes sense for the current tab; the customizer only adds a user visibility layer. It
also removes separators that would otherwise be leading, trailing, or repeated.

This first version customizes tab right-clicks. The context menu for an empty area of
the sidebar and action reordering are planned separately.

On macOS, the mod works with Zen's native context menus enabled. It does not change
the global `widget.macos.native-context-menus` preference.

## Install

For local development, quit Zen and run from the repository root:

    pnpm run install:local sidebar-context-menu-customizer

For a GitHub install, enable **Install JS from unofficial sources** in Sine and use:

    https://github.com/gvanderclay/zen-mods/tree/main/mods/sidebar-context-menu-customizer

## Development

    pnpm --filter @zen-mods/sidebar-context-menu-customizer check
    pnpm --filter @zen-mods/sidebar-context-menu-customizer dev

The committed `dist/` file is generated. Edit `src/`, never `dist/` directly.
