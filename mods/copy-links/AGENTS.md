# AGENTS.md

A manual Sine mod that adds a plain-text Copy Link(s) action to Zen's native tab
context menu. It runs with browser-chrome privileges.

## Commands

| Command | What it does |
|---|---|
| `pnpm --filter @zen-mods/copy-links check` | checks this mod |
| `pnpm --filter @zen-mods/copy-links test` | runs this mod's unit tests |
| `pnpm --filter @zen-mods/copy-links test:live-xul` | runs the exact-Zen menu and lifecycle smoke |

Run commands from the repository root.

## Invariants

1. The action is manual and copies only the tab or multiselection represented by
   Firefox's current Share menu context.
2. Firefox owns shareable-URL filtering and selected-tab order through
   `SharingUtils.getLinksToShare`.
3. The clipboard receives one plain-text value: URLs separated by `\n`, with no HTML
   or `text/x-moz-url` flavor added by the mod.
4. The browser-owned Share submenu remains intact. This mod owns one top-level action.
5. Runtime registrations belong to one terminal `@zen-mods/sine-lifecycle` scope.
6. Pure formatting and menu state stay in `src/core`; privileged APIs and DOM work stay
   in `src/platform`.
7. `dist/` is generated and committed. Edit `src/` and rebuild.

Private Firefox and Zen surfaces must be cited beside the platform code that uses
them. Work is checkpointed in `notes/copy-links/` and committed only after approval
with `copy-links(M01.C01):`.
