# AGENTS.md

A manual Sine mod that confirms Zen's built-in Duplicate Tab keyboard command with
Zen's native toast UI.

## Commands

| Command | What it does |
|---|---|
| `pnpm --filter @zen-mods/duplicate-tab-toast check` | checks this mod |
| `pnpm --filter @zen-mods/duplicate-tab-toast test` | runs focused unit tests |
| `pnpm --filter @zen-mods/duplicate-tab-toast test:live-xul` | runs the exact-Zen lifecycle smoke |

Run commands from the repository root.

## Invariants

1. Zen owns the Duplicate Tab command, shortcut binding, tab copies, and placement.
2. Feedback appears only after that command emits at least one `TabOpen`.
3. Context-menu and programmatic duplication outside `cmd_zenDuplicateTab` stay unchanged.
4. The native Zen toast manager owns presentation and timing; the mod owns only its text.
5. Every listener and pending continuation belongs to one terminal Sine generation.
6. Private Firefox and Zen behavior is cited beside the platform adapter that uses it.
7. `dist/` is generated and committed. Edit `src/` and rebuild.

Work is checkpointed in `notes/duplicate-tab-toast/` and committed only after approval
with `duplicate-tab-toast(M01.C01):`.
