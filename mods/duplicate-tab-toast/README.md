# Duplicate Tab Toast

A manual [Sine](https://github.com/CosmoCreeper/Sine) mod for
[Zen Browser](https://zen-browser.app) that confirms the built-in **Duplicate Tab**
keyboard command with Zen's native toast UI.

## Behavior

Assign **Duplicate Tab** in Zen's **Settings → Keyboard Shortcuts** screen, then
press it. Zen duplicates the active tab and the mod shows **Tab duplicated!**, or the
number of tabs Zen actually opened when that is more than one.

Zen continues to own the shortcut, which tabs are duplicated, tab placement, and
multiselection. With several tabs selected, Zen 1.24.1b still duplicates only the
active tab, so the confirmation stays singular. The mod does not change duplication
from the tab context menu or other commands.

## Compatibility

The browser boundary was extracted from Zen `1.24.1b`, build `20261106124806`, source
`b12eaefbca65b376950e1eb7ae84d3574022ba66`, and Firefox/Gecko `159.0.1`.

The mod relies on Firefox's `Browser:DuplicateTab` command in `mainCommandSet`, Zen's
private `gZenUIManager.showToast`, and Firefox's synchronous `TabOpen` event. These
APIs may require an update after Zen or Firefox changes them.

## Install

Enable **Install JS from unofficial sources** in Sine, then install:

    https://github.com/gvanderclay/zen-mods/tree/main/mods/duplicate-tab-toast

## Development

Run from the repository root:

    pnpm --filter @zen-mods/duplicate-tab-toast check
    pnpm --filter @zen-mods/duplicate-tab-toast test:live-xul

The committed `dist/` file is generated. Edit `src/`, never `dist/` directly.
