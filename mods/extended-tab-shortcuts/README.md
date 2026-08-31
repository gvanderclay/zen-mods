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
| Pop Out Selected Tabs | `Cmd+Ctrl+O` |
| Move Selected Tabs to Next Space | `Cmd+Ctrl+N`, `Cmd+Ctrl+Shift+Right` |
| Move Selected Tabs to Previous Space | `Cmd+Ctrl+P`, `Cmd+Ctrl+Shift+Left` |

Selection starts at the active tab. Repeating one direction grows a contiguous range;
reversing shrinks back through the anchor before growing on the other side. It follows
the visible sidebar order, skips tabs inside collapsed folders or pinned sections, and
does not wrap or cross between pinned and ordinary tabs. A mouse selection ends the
keyboard session, so the next selection shortcut adopts a contiguous mouse-selected
range and extends its requested edge. A non-contiguous mouse selection starts a new
range at the active tab.

Pop Out moves the active tab, or the complete current multiselection, into one isolated
unsynced window and focuses it. Tab order, the active tab, and the selection are
preserved. If every ordinary tab in the current space moves, the source space keeps one
empty tab. Private windows and selections containing an Essential, folder tab, or split
view are left unchanged.

The relative space actions move the active tab, or the complete current
multiselection, and switch to the destination space. They preserve tab order, pinned
state, the active tab, and the selection, and append the moved block to the end of the
destination's pinned or ordinary list. Next and previous follow Zen's current space
order and **Wrap around space navigation** setting. With wrapping disabled, invoking
an action at its outer edge does nothing. A one-space window also does nothing.
Selections containing an Essential, folder tab, split view, or a tab from another space
are left unchanged.

The actions run in browser chrome, so they do not depend on webpage focus or extension
access. Vimium C's `Shift+N` remains available as a page-level alternative.

## Compatibility

The browser boundary was extracted from Zen `1.21.14b`, build `20260811103047`, source
`f4890c17420a3f7879e72b64a09b180028eba1cf`, and Firefox/Gecko `153.0.4`.
The selected-tab, relative-space, and lifecycle behavior passed the exact staged probe
on Zen `1.21.16b`, build `20260828113729`, and Firefox/Gecko `154.0.1`.

The mod relies on Zen's private keyboard-shortcut loader and
`gBrowser.replaceTabsWithWindow(contextTab, options)`. Zen 1.21.16b's shipped
`tabbrowser.js` 7138–7256 owns the ordered multi-tab adoption, while
`ZenWindowSync.sys.mjs` 208–255 consumes the unsynced startup flag. These APIs may
require an update after Zen changes them. Disabling the mod removes the actions from
Zen's Keyboard Shortcuts screen. Selection uses the tab order and visibility rules in
Zen 1.21.16b's shipped `tabs.js` 862–972 and `tab.js` 221–240, plus Firefox's selection
methods and `TabMultiSelect` event in `tabbrowser.js` 8129–8403. The mod retains each
binding in a hidden preference and restores it when enabled again. It also recognizes a
binding retained by the former Pop Out Tab mod.

Relative space moves use Zen 1.21.16b's shipped `ZenSpaceManager.mjs` 608–685,
1511–1567, 1609–1700, and 2844–2865 for ordered space data, tab movement, destination
selection, and the native wrap preference.

## Migrating from Pop Out Tab

Disable and remove **Pop Out Tab** before installing **Extended Tab Shortcuts**. The
existing shortcut ID is unchanged, so a custom Zen binding is preserved. The former
`Cmd+Ctrl+N` default migrates to `Cmd+Ctrl+O`. A binding saved while the old mod was
disabled is restored from its former preference.

## Install

Enable **Install JS from unofficial sources** in Sine, then install:

    https://github.com/gvanderclay/zen-mods/tree/main/mods/extended-tab-shortcuts

## Development

Run from the repository root:

    pnpm --filter @zen-mods/extended-tab-shortcuts check
    pnpm --filter @zen-mods/extended-tab-shortcuts test:live-xul

The committed `dist/` file is generated. Edit `src/`, never `dist/` directly.
