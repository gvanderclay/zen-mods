# AGENTS.md

A manual Sine mod that adds editable tab actions to Zen's shortcut manager. The current
shipping action moves the active tab into a real synced browser window.

## Commands

| Command | What it does |
|---|---|
| `pnpm --filter @zen-mods/extended-tab-shortcuts check` | checks this mod |
| `pnpm --filter @zen-mods/extended-tab-shortcuts test` | runs focused unit tests |
| `pnpm --filter @zen-mods/extended-tab-shortcuts test:live-xul` | runs the exact-Zen multi-window and lifecycle smoke |

Run commands from the repository root.

## Invariants

1. Zen's Keyboard Shortcuts screen owns rebinding for every registered action.
2. Registration adds or removes all owned shortcut rows with one save and one rebuild.
3. The mod never overwrites an existing user binding or a shortcut ID owned by another action.
4. Disabling the mod removes its commands and rows but retains each user binding.
5. The current Pop Out action keeps `Cmd+Ctrl+N` and its synced-window behavior until a later approved checkpoint changes them.
6. Every command and listener belongs to one terminal `@zen-mods/sine-lifecycle` scope.
7. Private Firefox and Zen behavior is cited beside the platform adapter that uses it.
8. `dist/` is generated and committed. Edit `src/` and rebuild.

Work is checkpointed in `notes/extended-tab-shortcuts/` and committed only after
approval with `extended-tab-shortcuts(M02.C01):`.
