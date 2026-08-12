# AGENTS.md

A clean-room Sine mod that replaces the archived Load Bar with an honest activity
indicator for each visible Zen browser pane. It runs with browser-chrome privileges.

## Commands

| Command | What it does |
|---|---|
| `pnpm run check` | checks every workspace plus repository lint and docs |
| `pnpm --filter @zen-mods/load-bar check` | checks this mod |
| `pnpm --filter @zen-mods/load-bar dev` | rebuilds this mod on change |
| `pnpm --filter @zen-mods/load-bar test` | runs this mod's tests |

Run commands from the repository root.

## Invariants

1. The line means loading activity, not byte percentage or estimated completion.
2. Every visible pane owns its exact browser record and node. Hidden background tabs
   rely on native tab loading UI.
3. Zen's loading-indicator preference is never changed. A generation may hide the
   native pill only after its own listener and renderer are ready, and exact-token
   teardown must reveal native behavior again.
4. Webpage-controlled DOM fullscreen hides the custom line. Browser-window fullscreen
   does not.
5. Every runtime resource belongs to one terminal `@zen-mods/sine-lifecycle` scope.
6. `src/core` is pure. Firefox, Zen, Sine, DOM, and preference APIs stay in
   `src/platform`, with composition in `src/runtime.ts` and `src/main.ts`.
7. The implementation is clean-room. Do not copy the archived GPL Load Bar source.
8. `dist/` is generated and committed. Edit `src/` and rebuild.

Private Firefox and Zen behavior must be cited beside the adapter that depends on it.
Work is checkpointed in `notes/load-bar/` and committed only after approval with
`load-bar(R04.C##):`.
