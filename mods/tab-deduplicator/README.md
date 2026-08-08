# Tab Deduplicator

A [Sine](https://github.com/CosmoCreeper/Sine) mod for
[Zen Browser](https://zen-browser.app) that puts a manual duplicate-tab action in
Zen's sidebar tab menu.

## Behavior

Right-click any tab in the current space. The added item reports how many duplicate
tabs would close, or is disabled when there are none. Choosing it runs Firefox's own
duplicate-tab action.

The browser compares exact URLs within the same container and keeps the copy used most
recently. It only considers tabs in the current Zen space. Pinned tabs are never closed,
and Zen always pins essential tabs, so essentials are protected too. Ordinary tabs that
duplicate a pinned or essential tab can still close; the protected tab itself does not.

Firefox shows a confirmation the first time the bulk action is used. Individual tab
`beforeunload` prompts still work because the mod uses the browser's normal close path.

Right-click a Zen folder label to group duplicate tabs within that folder. The action
reports how many tabs need to move, keeps the chosen copy in place, and moves only its
duplicates beside it. It never moves a tab across a folder boundary or changes pin,
collapsed, loaded, or selected state.

The tab menu also provides a space-wide grouping action. It applies the same operation
to every folder, top-level pinned tabs, and top-level ordinary tabs independently in
the current space. Tabs never cross those boundaries, and other spaces are untouched.

Pinned tabs participate in grouping only when **Include pinned tabs in duplicate
actions** is enabled in the mod's Sine settings. The setting is off by default, and
essential tabs are always protected. Pinned duplicates are matched by Zen's saved pin
target when available, so a temporarily navigated pin still groups with copies of its
saved URL.

## Install

Enable **Install JS from unofficial sources** in Sine, then install:

    https://github.com/gvanderclay/zen-mods/tree/main/mods/tab-deduplicator

## Development

Run from the repository root:

    pnpm run install:local tab-deduplicator  # quit Zen first
    pnpm --filter @zen-mods/tab-deduplicator check
    pnpm --filter @zen-mods/tab-deduplicator dev

The committed `dist/` file is generated. Edit `src/`, never `dist/` directly.
