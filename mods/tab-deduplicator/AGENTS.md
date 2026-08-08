# AGENTS.md

A manual Sine mod that adds folder-aware duplicate-tab actions to Zen's native sidebar
context menus. It runs with browser-chrome privileges.

## Commands

| Command | What it does |
|---|---|
| `pnpm run check` | checks every workspace plus repository lint and docs |
| `pnpm --filter @zen-mods/tab-deduplicator check` | checks this mod |
| `pnpm --filter @zen-mods/tab-deduplicator dev` | rebuilds this mod on change |
| `pnpm --filter @zen-mods/tab-deduplicator test` | runs this mod's tests |

Run commands from the repository root. Shared compiler, test, and build defaults live
there; this workspace owns its scripts, thin `tsconfig.json`, sources, types, manifest,
README, and generated distribution.

## Invariants

1. The mod is manual. It never observes tab opens or navigations and never deduplicates
   without the user choosing its menu action.
2. Exact duplicate identity, lane scope, keeper choice, and custom candidate selection
   stay in `src/core`. Actual closure goes through Firefox's native duplicate-removal
   helper so warnings, `beforeunload`, SessionStore, and normal group handling remain
   browser-owned.
3. Essential tabs are protected independently as a documented invariant: Zen pins a
   tab in `ZenPinnedTabManager.addToEssentials`, and SessionStore restores essentials
   with `pinned = true`.
4. Explicit unpin-and-close preflights `beforeunload` while the target is still pinned;
   a blocked close must leave its pin and folder state unchanged.
5. Every runtime registration is pushed to `window.zenTabDeduplicator.disposers` and
   removed during Sine teardown. Reloads must not duplicate UI or listeners.
6. `src/core` remains pure. Browser globals and DOM work stay in `src/platform`.
7. `dist/` is generated and committed. Edit `src/` and rebuild.

Every claim about a private Firefox or Zen surface must cite the extracted source that
was checked. The current citations are beside the platform code that relies on them.

## Working agreement

Work is checkpointed in the gitignored `notes/tab-deduplicator/PLAN.md`, with durable
choices in `notes/tab-deduplicator/DECISIONS.md`. Write a failing core test before its
implementation, stop after one checkpoint with changes uncommitted, and commit only
after user approval using `tab-deduplicator(M##.C##):`.
