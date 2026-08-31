# Extended Tab Shortcuts

A manual [Sine](https://github.com/CosmoCreeper/Sine) mod for
[Zen Browser](https://zen-browser.app) that adds editable keyboard shortcuts for tab
actions missing from Zen.

## Behavior

The first available action is **Pop Out Current Tab** in Zen's **Settings → Keyboard
Shortcuts** screen. Its initial binding remains `Cmd+Ctrl+N`; use Zen's normal shortcut
recorder to change or clear it. Zen moves the active tab into a new synced window, and
the window manager can tile it like any other application window. The command does
nothing when the active tab is already the only tab in its window, matching Firefox's
native `replaceTabWithWindow` contract.

The action runs in browser chrome, so it does not depend on webpage focus or extension
access. Vimium C's `Shift+N` remains available as a page-level alternative.

## Compatibility

The browser boundary was extracted from Zen `1.21.14b`, build `20260811103047`, source
`f4890c17420a3f7879e72b64a09b180028eba1cf`, and Firefox/Gecko `153.0.4`.
The renamed lifecycle and unchanged Pop Out behavior also passed the exact staged probe
on Zen `1.21.16b`, build `20260828113729`, and Firefox/Gecko `154.0.1`.

The mod relies on Zen's private keyboard-shortcut loader and
`gBrowser.replaceTabWithWindow(tab, options, zenForceSync)` extension. These APIs may
require an update after Zen changes them. Disabling the mod removes the action from
Zen's Keyboard Shortcuts screen. The mod retains only its last key binding in a hidden
preference and restores it when enabled again. The renamed mod also recognizes a
binding retained by the former Pop Out Tab mod.

## Migrating from Pop Out Tab

Disable and remove **Pop Out Tab** before installing **Extended Tab Shortcuts**. The
existing shortcut ID is unchanged, so an active Zen binding is preserved. A binding
saved while the old mod was disabled is restored from its former preference.

## Install

Enable **Install JS from unofficial sources** in Sine, then install:

    https://github.com/gvanderclay/zen-mods/tree/main/mods/extended-tab-shortcuts

## Development

Run from the repository root:

    pnpm --filter @zen-mods/extended-tab-shortcuts check
    pnpm --filter @zen-mods/extended-tab-shortcuts test:live-xul

The committed `dist/` file is generated. Edit `src/`, never `dist/` directly.
