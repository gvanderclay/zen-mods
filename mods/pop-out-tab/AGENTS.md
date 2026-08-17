# AGENTS.md

A manual Sine mod that moves the active Zen tab into a real synced browser window
through an action registered in Zen's shortcut manager.

## Commands

| Command | What it does |
|---|---|
| `pnpm --filter @zen-mods/pop-out-tab check` | checks this mod |
| `pnpm --filter @zen-mods/pop-out-tab test` | runs focused unit tests |
| `pnpm --filter @zen-mods/pop-out-tab test:live-xul` | runs the exact-Zen multi-window and lifecycle smoke |

Run commands from the repository root.

## Invariants

1. `Cmd+Ctrl+N` is the initial binding; Zen's Keyboard Shortcuts screen owns rebinding.
2. Zen owns window creation and tab adoption through `replaceTabWithWindow`.
3. The new window is explicitly marked synced; unsynced window policy stays outside the mod.
4. The mod never overwrites an existing user binding for its shortcut ID.
5. Disabling the mod removes its command and shortcut row but retains the user's binding.
6. The command and every listener belong to one terminal `@zen-mods/sine-lifecycle` scope.
7. Private Firefox and Zen behavior is cited beside the platform adapter that uses it.
8. `dist/` is generated and committed. Edit `src/` and rebuild.

Work is checkpointed in `notes/pop-out-tab/` and committed only after approval with
`pop-out-tab(M01.C01):`.
