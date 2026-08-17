# Sidebar Context Menu Customizer

A [Sine](https://github.com/CosmoCreeper/Sine) mod for
[Zen Browser](https://zen-browser.app) that lets you simplify the menu shown when
you right-click a sidebar tab.

## Behavior

The first time it runs, every existing action starts under **More actions**, leaving a
quiet root menu with **More actions** and **Customize context menu…**. More actions contains
the live Firefox and Zen commands, including working nested menus and extension items;
it is not a disabled inventory.

**Customize context menu…** opens a persistent, searchable editor beside the tab. Changes
are saved immediately while the editor stays open. Its one readable, alphabetical
checklist can be filtered by **All**, **Selected**, or **Not selected**. Checked actions
appear directly in the root menu; unchecked actions remain executable under **More
actions**. **Select all** moves everything to the root. Context-specific variants with
the same displayed label, such as Zen's tab and split-view versions of **Remove from
Group**, share one editor row.

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

### Exact Zen/Sine lifecycle check

The normal tests cover pure menu policy. The explicit live-XUL check loads the
committed bundle through the installed Sine loader in a fresh throwaway profile and
exercises Zen's real tab menu, popup set, editor panel, observers, commands, reload,
and teardown:

    pnpm --filter @zen-mods/sidebar-context-menu-customizer test:live-xul

It fails closed if the installed Zen or Sine files differ from
`../../packages/live-harness/src/platform-stamp.json`, writes raw ignored evidence under
`.benchmarks/live/`, and always uses `--no-remote` so it cannot attach to the browser
profile you are using. It is intentionally not part of `pnpm run check` because it
requires that exact local installation. The launcher currently targets Zen's macOS
app/profile layout; this constraint applies to the test harness, not the mod itself.

Use `test:live-xul:record` instead when a checkpoint needs 30 raw popup, editor, and
Sine-reload samples rather than the five-sample lifecycle smoke. Record, smoke, and
headed evidence use separate files, so a quick follow-up cannot overwrite the
30-sample baseline.

On macOS, the headed variant leaves the native context menu visible for ten seconds
so its Cocoa presentation can be inspected:

    pnpm --filter @zen-mods/sidebar-context-menu-customizer test:live-xul:headed
