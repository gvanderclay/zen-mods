# AGENTS.md

A Sine mod that applies a versioned semantic palette file to Zen browser chrome.
It runs with browser-chrome privileges.

## Commands

| Command | What it does |
|---|---|
| `pnpm --filter @zen-mods/palette-bridge check` | checks this mod |
| `pnpm --filter @zen-mods/palette-bridge test` | runs focused unit tests |
| `pnpm --filter @zen-mods/palette-bridge build` | generates the committed bundle |

Run commands from the repository root.

## Invariants

1. `palette.schema.json` is the public producer contract. Runtime validation must
   remain exact and reject incomplete updates.
2. Palette fields stay semantic. Zen property names and element IDs remain private to
   the platform adapter.
3. `src/core/` is pure. File, preference, DOM, Sine, and Zen APIs stay in
   `src/platform/`, with composition in `src/runtime.ts` and `src/main.ts`.
4. Every timer, observer, listener, read continuation, and style declaration belongs to
   one terminal window generation.
5. Private and unsynced windows keep Zen's native treatment.
6. Teardown restores only values still owned by the stopping generation.
7. Private Firefox and Zen behavior is cited beside the adapter that uses it.
8. `dist/` is generated and committed. Edit source and rebuild it.

Work is checkpointed in `notes/palette-bridge/` and committed only after approval with
`palette-bridge(M01.C##):`.
