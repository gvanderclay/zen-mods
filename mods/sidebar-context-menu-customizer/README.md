# Sidebar Context Menu Customizer

A [Sine](https://github.com/CosmoCreeper/Sine) mod for
[Zen Browser](https://zen-browser.app) that lets you simplify the menu shown when
you right-click a sidebar tab.

## Behavior

The first time it runs, every existing action starts under **More actions**, leaving a
quiet root menu with **More actions** and **Customize tab menu…**. More actions contains
the live Firefox and Zen commands, including working nested menus and extension items;
it is not a disabled inventory.

**Customize tab menu…** opens a persistent, searchable editor beside the tab. Changes
are saved immediately while the editor stays open. Its one readable, alphabetical
checklist can be filtered by **All**, **Selected**, or **Not selected**. Checked actions
appear directly in the root menu; unchecked actions remain executable under **More
actions**. **Select all** moves everything to the root. Context-specific variants with
the same displayed label, such as Zen's tab and split-view versions of **Remove from
Group**, share one editor row.

Actions from supported submenus can also be promoted to the root. Enable **Copy
Link(s)** under **From submenus** in the editor. The promoted action stays
synchronized with Firefox: it becomes **Copy Link** for one tab, **Copy N Links** for
a multi-selection, and disables itself when none of the selected tabs has a shareable
URL. The original action remains available inside **Share**.

The list is generated from the live menu, so it includes compatible actions added by
other mods, including Tab Deduplicator. Firefox and Zen still decide whether an action
makes sense for the current tab; the customizer only adds a user visibility layer. It
also removes separators that would otherwise be leading, trailing, or repeated.

This version customizes tab right-clicks. The context menu for an empty area of the
sidebar, additional submenu promotions, and action reordering are planned separately.

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
