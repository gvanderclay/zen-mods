# Tab Deduplicator

A [Sine](https://github.com/CosmoCreeper/Sine) mod for
[Zen Browser](https://zen-browser.app) that puts a manual duplicate-tab action in
Zen's sidebar tab menu.

## Behavior

Right-click any tab in the current space. The added item reports how many duplicate
tabs would close, or is disabled when there are none. The space action evaluates each
folder, top-level pinned lane, and top-level ordinary lane independently, so matching
tabs in different folders do not make each other removable.

The mod compares exact effective URLs within the same container and lane and keeps the
protected or most recently used copy. It only considers tabs in the current Zen space.
Essentials are always protected. Ordinary tabs that duplicate a pinned or essential tab
can still close; the protected tab itself does not.

The close actions hand their selected candidates to Firefox's normal close path, so
bulk-close safeguards, individual `beforeunload` prompts, and Undo Close Tab still
work.

Right-click a Zen folder label to group duplicate tabs within that folder. The action
reports how many tabs need to move, keeps the chosen copy in place, and moves only its
duplicates beside it. It never moves a tab across a folder boundary or changes pin,
collapsed, loaded, or selected state.

The tab menu also provides a space-wide grouping action. It applies the same operation
to every folder, top-level pinned tabs, and top-level ordinary tabs independently in
the current space. Tabs never cross those boundaries, and other spaces are untouched.

A folder label's context menu can also close duplicate tabs inside only that folder.
With pinned participation off, pinned tabs are excluded. With it on, a pinned close
shows a native alert with **Include pinned**, **Ignore pinned** (the default), and
**Cancel**. The candidate list is refreshed after the alert, and essentials are always
excluded. The command uses Firefox's normal bulk-close warning and removal path, so
page prompts and Undo Close Tab still work.

Pinned tabs participate in grouping and closing only when **Include pinned tabs in
duplicate actions** is enabled in the mod's Sine settings. A space-wide close uses one
aggregate confirmation for all affected lanes. The setting is off by default, and
essential tabs are always protected. Pinned duplicates are matched by Zen's saved pin
target when available, so a temporarily navigated pin still matches copies of its
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
