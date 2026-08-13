# Tab Deduplicator

A manual, folder-aware duplicate-tab manager for
[Zen Browser](https://zen-browser.app), packaged as a
[Sine](https://github.com/CosmoCreeper/Sine) mod. It adds direct actions to Zen's
native tab and folder context menus; there is no custom dashboard or background
deduplication. Close actions open one transient review so the exact keep/close plan is
visible before tabs are removed.

## Actions

Right-click any tab to use the current-space actions:

- **Group Duplicate Tabs** groups each folder, the top-level pinned
  lane, and the top-level ordinary lane independently.
- **Close Duplicate Tabs** closes the aggregated candidates from those
  independent lanes after showing one grouped review. Matching tabs in different
  folders do not make each other removable.

Right-click empty space in Zen's sidebar to use the same current-space close action in
the native tabbar Actions block, immediately before **Reopen Closed Tabs**.

Right-click one pinned, non-essential tab to use **Unpin and close pinned tab…** beside
Zen's normal unpin command. This separate action does not depend on the duplicate-tab
preference and never appears for ordinary tabs, essentials, or a multiselection.

Right-click a Zen folder label to use the folder actions:

- **Group Duplicate Tabs** moves duplicate copies beside their
  keeper without changing folder, pin, collapsed, loaded, or selected state.
- **Close Duplicate Tabs** reviews and closes candidates only inside
  that folder.

The review lists each duplicate cluster's exact URL, folder or top-level lane,
container number when present, tab title, keeper, close candidates, and protected
tabs. It is a confirmation surface, not a persistent history or management page.

While the mod is active, it hides Firefox's native tab-menu duplicate command so only
the folder-aware policy is presented. It leaves Firefox's internal removal helper
intact and restores the native command when the mod unloads.

The space-close action retains the stable customization ID
`tab-deduplicator-context-item`. If Sidebar Context Menu Customizer previously placed
it under **More actions**, that placement persists across upgrades; select it in
**Customize context menu…** to return it to the root.

## Matching and keepers

A duplicate identity is the exact effective URL plus the container. Query parameters,
fragments, and other URL differences are significant. The mod never normalizes URLs
or infers related pages.

Each Zen folder, the top-level pinned lane, and the top-level ordinary lane is a
separate scope within the current space. Other spaces are not inspected. For pinned
tabs, Zen's saved target URL is authoritative when available, so a temporarily
navigated pin still matches copies of its saved target. When Zen exposes
`about:blank` instead, the mod checks the active SessionStore entry before deciding
identity. This prevents unrelated restored pins from being reported as duplicates.

Essentials always survive. Otherwise a pinned copy is preferred as the keeper, then
the most recently active copy. Equal activity times resolve by lane position and then
stable tab ID.

## Pinned tabs

**Include pinned tabs in duplicate actions** is off by default in Sine settings.

- Off: grouping and closing leave pinned tabs untouched. A protected pin can still be
  the keeper for redundant ordinary copies in the same lane.
- On: pinned tabs can move during grouping. Eligible pinned close candidates appear in
  the review behind a checked **Include N pinned duplicates** control. Clear it to keep
  those pinned copies.

The candidate plan is recomputed after confirmation. If membership, keeper, lane,
pin category, or protection changed while the review was open, the review refreshes
and requires another confirmation. Essentials remain excluded regardless of the
preference or review choice.

## Closing behavior

Candidate selection belongs to the mod's folder-aware policy, while actual closing is
delegated to Firefox's duplicate-removal helper and normal `removeTabs` path. This
retains browser-owned bulk-close safeguards, `beforeunload` handling, SessionStore,
tab-group cleanup, Undo Close Tab, and confirmation feedback.

The mod disables an affected close action if its required private browser API is
missing. It does not fall back to direct DOM removal. It also does not watch tab opens,
navigations, or timers: tabs move or close only after a context-menu command.

**Unpin and close pinned tab…** runs immediately without an extra confirmation.
Firefox still runs the target page's `beforeunload` check while the tab is pinned. If
that page prompt is canceled, the tab stays pinned in its original folder. After a
successful preflight, Zen removes the pinned/folder state and Firefox closes through
its normal SessionStore-aware path, so Undo Close Tab remains available. The normal
tab disappearance is the success feedback; the mod adds no custom prompt, toast, or
localization resource.

## Compatibility

Private browser surfaces were extracted and verified against:

- Zen `1.21.13b`, build `20260809044209`
- Zen source commit `6c5a150de637c8c54a780de8da1b17249a608abd`
- Firefox/Gecko `153.0.3`

The mod relies on Zen's active-space `gBrowser.tabs` list, folder/group relationships,
saved pinned target state, essential marker, folder and tab context-menu IDs, and Sine
unload hook. It also relies on Firefox's `moveTabAfter`, `isTabGroupLabel`,
`_removeDuplicateTabs`, `closingTabsEnum.DUPLICATES`, XUL fragment creation, and the
browser document's HTML dialog support. The unpin-and-close action additionally relies on
`runBeforeUnloadForTabs`, Zen's `unpinTab`, Firefox's `removeTabs` with
`skipPermitUnload`, and `TabContextMenu.contextTab`. These are private APIs and may
require a compatibility update after Zen or Firefox changes them.

## Install

Enable **Install JS from unofficial sources** in Sine, then install:

    https://github.com/gvanderclay/zen-mods/tree/main/mods/tab-deduplicator

## Development

Run from the repository root:

    pnpm run install:local:restart tab-deduplicator
    pnpm --filter @zen-mods/tab-deduplicator check
    pnpm --filter @zen-mods/tab-deduplicator dev

The explicit lifecycle smoke stages the production bundle in a throwaway stamped
Zen/Sine profile, opens two browser windows, reloads both generations, closes the
secondary natively, and disables the survivor:

    pnpm --filter @zen-mods/tab-deduplicator test:live-lifecycle

The committed `dist/` file is generated. Edit `src/`, never `dist/` directly.
