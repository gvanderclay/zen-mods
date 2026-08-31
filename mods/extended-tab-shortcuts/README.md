# Extended Tab Shortcuts

A manual [Sine](https://github.com/CosmoCreeper/Sine) mod for
[Zen Browser](https://zen-browser.app) that adds editable keyboard shortcuts for tab
actions missing from Zen.

## Behavior

Every action is editable in Zen's **Settings → Keyboard Shortcuts** screen. The current
defaults are:

| Action | Defaults |
|---|---|
| Extend Tab Selection Next | `Cmd+Ctrl+J`, `Cmd+Ctrl+Down` |
| Extend Tab Selection Previous | `Cmd+Ctrl+K`, `Cmd+Ctrl+Up` |
| Clear Tab Selection | `Cmd+Ctrl+backtick` |
| Pop Out Current Tab | `Cmd+Ctrl+N` |

Selection starts at the active tab. Repeating one direction grows a contiguous range;
reversing shrinks back through the anchor before growing on the other side. It follows
the visible sidebar order, skips tabs inside collapsed folders or pinned sections, and
does not wrap or cross between pinned and ordinary tabs. A mouse selection ends the
keyboard session, so the next selection shortcut adopts a contiguous mouse-selected
range and extends its requested edge. A non-contiguous mouse selection starts a new
range at the active tab.

Pop Out still moves only the active tab into a new synced window. The window manager
can tile it like any other application window. The command does nothing when the active
tab is already the only tab in its window, matching Firefox's native
`replaceTabWithWindow` contract.

The actions run in browser chrome, so they do not depend on webpage focus or extension
access. Vimium C's `Shift+N` remains available as a page-level alternative.

## Compatibility

The browser boundary was extracted from Zen `1.21.14b`, build `20260811103047`, source
`f4890c17420a3f7879e72b64a09b180028eba1cf`, and Firefox/Gecko `153.0.4`.
The renamed lifecycle and unchanged Pop Out behavior also passed the exact staged probe
on Zen `1.21.16b`, build `20260828113729`, and Firefox/Gecko `154.0.1`.

The mod relies on Zen's private keyboard-shortcut loader and
`gBrowser.replaceTabWithWindow(tab, options, zenForceSync)` extension. These APIs may
require an update after Zen changes them. Disabling the mod removes the actions from
Zen's Keyboard Shortcuts screen. Selection uses the tab order and visibility rules in
Zen 1.21.16b's shipped `tabs.js` 862–972 and `tab.js` 221–240, plus Firefox's selection
methods and `TabMultiSelect` event in `tabbrowser.js` 8129–8403. The mod retains each
binding in a hidden preference and restores it when enabled again. The renamed mod also
recognizes a binding retained by the former Pop Out Tab mod.

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
