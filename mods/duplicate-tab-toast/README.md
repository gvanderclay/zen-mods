# Duplicate Tab Toast

A manual [Sine](https://github.com/CosmoCreeper/Sine) mod for
[Zen Browser](https://zen-browser.app) that confirms the built-in **Duplicate Tab**
keyboard command with Zen's native toast UI.

## Behavior

Assign **Duplicate Tab** in Zen's **Settings → Keyboard Shortcuts** screen. When the
shortcut opens one tab, the mod shows **Tab duplicated!**. When multiple selected tabs
are duplicated, it shows the number of tabs opened.

Zen continues to own the shortcut, duplication, tab placement, and multiselection.
The mod does not change duplication from the tab context menu or other commands.

## Compatibility

The browser boundary was extracted from Zen `1.21.14b`, build `20260811103047`, source
`f4890c17420a3f7879e72b64a09b180028eba1cf`, and Firefox/Gecko `153.0.4`.

The mod relies on Zen's private `cmd_zenDuplicateTab` command and
`gZenUIManager.showToast`, plus Firefox's synchronous `TabOpen` event. These APIs may
require an update after Zen or Firefox changes them.

## Install

Enable **Install JS from unofficial sources** in Sine, then install:

    https://github.com/gvanderclay/zen-mods/tree/main/mods/duplicate-tab-toast

## Development

Run from the repository root:

    pnpm --filter @zen-mods/duplicate-tab-toast check
    pnpm --filter @zen-mods/duplicate-tab-toast test:live-xul

The committed `dist/` file is generated. Edit `src/`, never `dist/` directly.
