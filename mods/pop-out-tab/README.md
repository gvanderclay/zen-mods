# Pop Out Tab

A manual [Sine](https://github.com/CosmoCreeper/Sine) mod for
[Zen Browser](https://zen-browser.app) that moves the active tab into a real browser
window for external tiling window managers such as AeroSpace.

## Behavior

The mod adds **Pop Out Current Tab** to Zen's **Settings → Keyboard Shortcuts** screen.
Its initial binding is `Cmd+Ctrl+N`; use Zen's normal shortcut recorder to change or
clear it. Zen moves the active tab into a new synced window, and the window manager can
tile it like any other application window. The command does nothing when the active tab
is already the only tab in its window, matching Firefox's native `replaceTabWithWindow`
contract.

The action runs in browser chrome, so it does not depend on webpage focus or extension
access. Vimium C's `Shift+N` remains available as a page-level alternative.

## Compatibility

The browser boundary was extracted from Zen `1.21.14b`, build `20260811103047`, source
`f4890c17420a3f7879e72b64a09b180028eba1cf`, and Firefox/Gecko `153.0.4`.

The mod relies on Zen's private keyboard-shortcut loader and
`gBrowser.replaceTabWithWindow(tab, options, zenForceSync)` extension. These APIs may
require an update after Zen changes them. Disabling the mod removes the action from
Zen's Keyboard Shortcuts screen. The mod retains only its last key binding in a hidden
preference and restores it when enabled again.

## Install

Enable **Install JS from unofficial sources** in Sine, then install:

    https://github.com/gvanderclay/zen-mods/tree/main/mods/pop-out-tab

## Development

Run from the repository root:

    pnpm --filter @zen-mods/pop-out-tab check
    pnpm --filter @zen-mods/pop-out-tab test:live-xul

The committed `dist/` file is generated. Edit `src/`, never `dist/` directly.
