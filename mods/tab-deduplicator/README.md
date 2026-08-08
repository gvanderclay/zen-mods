# Tab Deduplicator

A manual, folder-aware duplicate-tab manager for
[Zen Browser](https://zen-browser.app), packaged as a
[Sine](https://github.com/CosmoCreeper/Sine) mod. It adds direct actions to Zen's
native tab and folder context menus; there is no custom dashboard or background
deduplication.

## Actions

Right-click any tab to use the current-space actions:

- **Group N duplicate tabs in this space** groups each folder, the top-level pinned
  lane, and the top-level ordinary lane independently.
- **Close N duplicate tabs in this space** closes the aggregated candidates from those
  independent lanes. Matching tabs in different folders do not make each other
  removable.

Right-click a Zen folder label to use the folder actions:

- **Group N duplicate tabs in this folder** moves duplicate copies beside their
  keeper without changing folder, pin, collapsed, loaded, or selected state.
- **Close N duplicate tabs in this folder…** closes candidates only inside that
  folder.

The space-close action retains the stable customization ID
`tab-deduplicator-context-item`. If Sidebar Context Menu Customizer previously placed
it under **More actions**, that placement persists across upgrades; select it in
**Customize tab menu…** to return it to the root.

## Matching and keepers

A duplicate identity is the exact effective URL plus the container. Query parameters,
fragments, and other URL differences are significant. The mod never normalizes URLs
or infers related pages.

Each Zen folder, the top-level pinned lane, and the top-level ordinary lane is a
separate scope within the current space. Other spaces are not inspected. For pinned
tabs, Zen's saved target URL is authoritative when available, so a temporarily
navigated pin still matches copies of its saved target.

Essentials always survive. Otherwise a pinned copy is preferred as the keeper, then
the most recently active copy. Equal activity times resolve by lane position and then
stable tab ID.

## Pinned tabs

**Include pinned tabs in duplicate actions** is off by default in Sine settings.

- Off: grouping and closing leave pinned tabs untouched. A protected pin can still be
  the keeper for redundant ordinary copies in the same lane.
- On: pinned tabs can move during grouping. Before any pinned duplicate closes, a
  native alert offers **Include pinned**, **Ignore pinned** (the default), and
  **Cancel**.

The candidate plan is recomputed after the alert. A folder action prompts for that
folder; a space action uses one aggregate prompt for every affected lane. Essentials
remain excluded regardless of the preference or prompt choice.

## Closing behavior

Candidate selection belongs to the mod's folder-aware policy, while actual closing is
delegated to Firefox's duplicate-removal helper and normal `removeTabs` path. This
retains browser-owned bulk-close safeguards, `beforeunload` handling, SessionStore,
tab-group cleanup, Undo Close Tab, and confirmation feedback.

The mod disables an affected close action if its required private browser API is
missing. It does not fall back to direct DOM removal. It also does not watch tab opens,
navigations, or timers: tabs move or close only after a context-menu command.

## Compatibility

Private browser surfaces were extracted and verified against:

- Zen `1.21.12b`, build `20260807120242`
- Zen source commit `6096aaed30dc8da4229a3d6a0b58379726223ae6`
- Firefox/Gecko `153.0.3`

The mod relies on Zen's active-space `gBrowser.tabs` list, folder/group relationships,
saved pinned target state, essential marker, folder and tab context-menu IDs, and Sine
unload hook. It also relies on Firefox's `moveTabAfter`, `isTabGroupLabel`,
`_removeDuplicateTabs`, `closingTabsEnum.DUPLICATES`, prompt-service button flags, and
XUL fragment creation. These are private APIs and may require a compatibility update
after Zen or Firefox changes them.

## Install

Enable **Install JS from unofficial sources** in Sine, then install:

    https://github.com/gvanderclay/zen-mods/tree/main/mods/tab-deduplicator

## Development

Run from the repository root:

    pnpm run install:local:restart tab-deduplicator
    pnpm --filter @zen-mods/tab-deduplicator check
    pnpm --filter @zen-mods/tab-deduplicator dev

The committed `dist/` file is generated. Edit `src/`, never `dist/` directly.
