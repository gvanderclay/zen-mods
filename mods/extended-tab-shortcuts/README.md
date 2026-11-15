# Extended Tab Shortcuts

A manual [Sine](https://github.com/CosmoCreeper/Sine) mod for
[Zen Browser](https://zen-browser.app) that adds editable keyboard shortcuts for tab
actions missing from Zen.

## Behavior

Every action is editable in Zen's **Settings → Keyboard Shortcuts** screen, under the
**Extended Tab Shortcuts** category. The same actions also appear in that menu at the end of
**Tools**. The current defaults are:

| Action | Defaults |
|---|---|
| Extend Tab Selection Next | `Cmd+Ctrl+J`, `Cmd+Ctrl+Down` |
| Extend Tab Selection Previous | `Cmd+Ctrl+K`, `Cmd+Ctrl+Up` |
| Clear Tab Selection | `Cmd+Ctrl+backtick` |
| Pop Out / Merge Selected Tabs | `Cmd+Ctrl+O` |
| Move Selected Tabs to Next Space | `Cmd+Ctrl+N`, `Cmd+Ctrl+Shift+Right` |
| Move Selected Tabs to Previous Space | `Cmd+Ctrl+P`, `Cmd+Ctrl+Shift+Left` |
| Move Selected Tabs to Folder | `Cmd+Ctrl+M` |

Selection starts at the active tab. Repeating one direction grows a contiguous range;
reversing shrinks back through the anchor before growing on the other side. It follows
the visible sidebar order, skips tabs inside collapsed folders or pinned sections, and
does not wrap or cross between pinned and ordinary tabs. A mouse selection ends the
keyboard session, so the next selection shortcut adopts a contiguous mouse-selected
range and extends its requested edge. A non-contiguous mouse selection starts a new
range at the active tab. When the ordinary tab list overflows, the newly reached range
edge is centered only if it is outside the visible scrollbox.

`Cmd+Ctrl+O` toggles the active tab, or the complete current multiselection, between
shared synced windows and isolated unsynced windows. From a shared window it reuses the
first unsynced window in native enumeration order, or creates one when none exists. From
an unsynced window it moves the selection into Zen's first shared window, or creates a
shared window when none exists. The destination is focused, moved tabs append at the end
of the corresponding space, and tab order, pinned state, the active tab, and selection
are preserved. If real tabs remain after a merge, the isolated window stays open; if
none remain, it closes. A surviving source keeps an empty current-space tab when needed.
Private windows and selections containing an Essential, folder tab, or split view are
left unchanged.

The relative space actions move the active tab, or the complete current
multiselection, and switch to the destination space. They preserve tab order, pinned
state, the active tab, and the selection, and append the moved block to the end of the
destination's pinned or ordinary list. When the destination tab bar overflows, the
active moved tab is brought into view. Next and previous follow Zen's current space
order and **Wrap around space navigation** setting. With wrapping disabled, invoking an
action at its outer edge does nothing. A one-space window also does nothing.
Selections containing an Essential, folder tab, split view, or a tab from another space
are left unchanged.

`Cmd+Ctrl+M` opens a native arrow panel for moving the active tab or complete current
multiselection into a folder. Press `1` through `9` to move immediately to one of the
first nine displayed folders. Additional folders remain available with `J`/`K`, the
arrow keys, Enter, or the mouse. `N` opens the native New Folder view; Enter creates the
named root folder, Backspace returns when the name is empty, and Escape closes the
panel. Existing destinations are regular folders in the current space, shown in sidebar
order with nested indentation. A destination containing any selected tab is omitted.
The move preserves sidebar order, the active tab, and the complete selection. Zen pins
ordinary tabs when it places them in folders. Essentials, Live Folder items, split
views, private windows, and mixed-space selections are left unchanged.

The actions run in browser chrome, so they do not depend on webpage focus or extension
access. Vimium C's `Shift+N` remains available as a page-level alternative.

## Compatibility

Every citation below was re-verified against the installed files of Zen `1.24.1b`, build
`20261106124806`, source `b12eaefbca65b376950e1eb7ae84d3574022ba66`, and Firefox/Gecko
`159.0.1`. Line numbers refer to the files extracted from the installed `omni.ja` and
`gre omni.ja`. The live XUL probe (`test:live-xul`) passed on this build.

The mod registers one owned keyset and one owned **Extended Tab Shortcuts** submenu at the
end of **Tools** in every browser window. Firefox's Keyboard Shortcuts screen discovers
those rows from `main-menubar menuitem[key]`
(`moz-src/browser/components/customkeys/CustomKeysParent.sys.mjs` 85–121), and native
`CustomKeys` stores each rebinding in `customKeys.json` in the profile directory
(`moz-src/browser/components/customkeys/CustomKeys.sys.mjs` 28–39, 162–198). The screen
builds its rows once (`chrome/browser/content/browser/customkeys/customkeys.js`,
`buildTable` at line 11, called at line 390), so a change made while it is open appears
after it is reopened or reloaded. Disabling the mod removes the owned DOM only; the browser
keeps every customization.

Window toggling uses `gBrowser.replaceTabsWithWindow(contextTab, options)` plus
`gBrowser.adoptTab(tab, options)`. `Tabbrowser.sys.mjs` 7919–8052 owns window creation
(`replaceTabWithWindow` sets `_zenStartupSyncFlag`; `replaceTabsWithWindow` adopts the
other tabs on `before-initial-tab-adopted`) and 8704–8790 owns cross-window adoption.
`adoptTab` also accepts `spaceId` and calls `gZenWorkspaces.adoptTabIntoSpace`
(`ZenSpaceManager.mjs` 1677–1694), after which the mod
places the tab with `moveTabToWorkspace`. `ZenWindowSync.sys.mjs` 204–262 owns the synced-window flags and
1330–1381 owns native merge targeting. These APIs may require an update after Zen changes
them.
Selection uses the tab order and visibility rules in Zen's `tabs.js` 868–984 and
`tab.js` 232–253, plus Firefox's selection methods and `TabMultiSelect` event in
`Tabbrowser.sys.mjs` 8985–9266. Overflow reveal uses Zen's `tabs.js` 65–100 and
1423–1430 plus `arrowscrollbox.js` 178–180 and 323–352.

Relative space moves use Zen's `ZenSpaceManager.mjs` 117–121 (wrap preference),
317–326, 669–746, 1677–1767, 1808–1837, 3126–3145, and 3555–3568, plus `tabs.js`
1423–1430 and `arrowscrollbox.js` 323–352, for ordered space data, tab movement,
destination selection, active-scrollbox ownership, overflow visibility, and the native
wrap preference. Window toggling also uses ordered workspace positions because synced and
unsynced windows assign different workspace UUIDs.

Folder moves use Zen's `ZenFolders.mjs` 251–311 for current-space destination
filtering and 695–792 for named root-folder creation, `ZenFolder.mjs` 110–112 and
289–311 for `isZenFolder` and `addTabs`, and `tabgroup.mjs` 622–624 and 715–762 for
`level` and the native `addTabs`. The picker uses Firefox 157's shipped
`PanelMultiView.sys.mjs` 393–465, 536–802, 831–993, 1600–1705, and 1857–2175 for native
panel lifecycle, subview transitions, focus, and keyboard behavior.

## Migrating from Pop Out Tab

Disable and remove **Pop Out Tab** before installing **Extended Tab Shortcuts**. The
existing shortcut ID is unchanged, so a current binding is preserved. The former
`Cmd+Ctrl+N` default migrates to `Cmd+Ctrl+O`.

The first enable carries surviving legacy data into native storage once: an entry in Zen's
old `zen-keyboard-shortcuts.json`, a `zen.extended-tab-shortcuts.saved-binding.*` backup, or
the former `zen.pop-out-tab.saved-binding` preference. A current native customization,
including a deliberately cleared binding, always wins, and a legacy binding that equals the
current default is skipped. Zen deletes its old shortcut file after its own migration, so a
customization it already dropped cannot be recovered; if the file still exists but cannot be
read, the mod reports it and keeps the default instead of guessing. The
`zen.extended-tab-shortcuts.native-migration` preference records the completed migration so
a binding you later reset in the screen is not resurrected.

## Install

Enable **Install JS from unofficial sources** in Sine, then install:

    https://github.com/gvanderclay/zen-mods/tree/main/mods/extended-tab-shortcuts

## Development

Run from the repository root:

    pnpm --filter @zen-mods/extended-tab-shortcuts check
    pnpm --filter @zen-mods/extended-tab-shortcuts test:live-xul

The committed `dist/` file is generated. Edit `src/`, never `dist/` directly.
