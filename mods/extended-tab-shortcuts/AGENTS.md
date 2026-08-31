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
7. Pop Out moves the active tab or complete multiselection into one focused unsynced window and leaves one empty current-space tab when needed.
8. Relative space moves append to the destination list and honor Zen's ordered spaces and wrap preference while preserving the moved tabs' order, pinned state, active tab, and selection.
9. Every command and listener belongs to one terminal `@zen-mods/sine-lifecycle` scope.
10. Private Firefox and Zen behavior is cited beside the platform adapter that uses it.
11. `dist/` is generated and committed. Edit `src/` and rebuild.

Work is checkpointed in `notes/extended-tab-shortcuts/` and committed only after
approval with `extended-tab-shortcuts(M02.C04):`.
