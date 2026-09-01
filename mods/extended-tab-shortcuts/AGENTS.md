# AGENTS.md

A manual Sine mod that adds editable tab selection and window actions to Zen's shortcut
manager.

## Commands

| Command | What it does |
|---|---|
| `pnpm --filter @zen-mods/extended-tab-shortcuts check` | checks this mod |
| `pnpm --filter @zen-mods/extended-tab-shortcuts test` | runs focused unit tests |
| `pnpm --filter @zen-mods/extended-tab-shortcuts test:live-xul` | runs the exact-Zen selection, multi-window, and lifecycle smoke |

Run commands from the repository root.

## Invariants

1. Zen's Keyboard Shortcuts screen owns rebinding for every registered action.
2. Registration adds or removes all owned shortcut rows with one save and one rebuild.
3. The mod never overwrites an existing user binding or a shortcut ID owned by another action.
4. Disabling the mod removes its commands and rows but retains each user binding.
5. Keyboard selection is anchored at the active tab, follows visible sidebar order, skips collapsed tabs, never wraps, and never crosses the pinned boundary.
6. A contiguous external selection becomes the next keyboard range; a non-contiguous one restarts from the active tab.
7. `Cmd+Ctrl+O` moves the active tab or complete multiselection between shared and unsynced windows, reusing the first enumerated isolated window and leaving one empty current-space tab when needed.
8. Relative space moves append to the destination list, reveal the active moved tab when the destination overflows, and honor Zen's ordered spaces and wrap preference while preserving the moved tabs' order, pinned state, active tab, and selection.
9. Merge Back appends to the corresponding destination space, focuses it, preserves selection, and closes an isolated source only when no real tabs remain.
10. Folder moves target regular folders in the current space or one new root folder, preserve tab order, active tab, and selection, and expose the first nine valid destinations as `1`–`9`.
11. Every command, panel, and listener belongs to one terminal `@zen-mods/sine-lifecycle` scope.
12. Private Firefox and Zen behavior is cited beside the platform adapter that uses it.
13. `dist/` is generated and committed. Edit `src/` and rebuild.

Work is checkpointed in `notes/extended-tab-shortcuts/` and committed only after
approval with `extended-tab-shortcuts(M03.C01):`.
