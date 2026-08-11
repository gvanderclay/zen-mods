# AGENTS.md

A public-ready ESM library of lifecycle primitives proven across this repository's
Sine mods. It is currently private while the workspace dogfoods version 0.1.

## Commands

| Command | What it does |
|---|---|
| `pnpm --filter @zen-mods/sine-lifecycle build` | emits committed JavaScript and declarations into `dist/` |
| `pnpm --filter @zen-mods/sine-lifecycle typecheck` | checks source and tests without emitting |
| `pnpm --filter @zen-mods/sine-lifecycle test` | runs contracts, bundle isolation, clean emit, and packed-consumer checks |
| `pnpm --filter @zen-mods/sine-lifecycle check` | runs the package typecheck and tests |

## Invariants

1. Public runtime APIs are explicit leaf exports. Do not add a root barrel.
2. Modules have no import-time browser effects and remain safe under `sideEffects: false`.
3. `disposable-scope` owns synchronous terminal LIFO cleanup; `generation-scope`
   additionally owns waits, timers, and abort; `sine-window` only binds lifecycle
   signals. Product state, logging, and policy stay in the consumer.
4. Sine and native unload callbacks converge on one caller-owned idempotent stop. The
   native listener remains non-capturing and once-only.
5. The package targets the current repository stack: Firefox 153, Sine 2.3.3,
   ES2023, ESM, and native `DisposableStack`. Do not add compatibility branches,
   CommonJS, or a polyfill without a separate measured requirement.
6. Every export must pass the packed-consumer and esbuild contribution tests. An
   unused subpath must contribute zero bytes to a consumer bundle.
7. `dist/` is generated. Edit `src/`, build, and compare a clean emit; never edit it
   directly.
8. Changes require every consuming mod's tests and bundle graph. Lifecycle behavior
   also requires the relevant exact staged Zen/Sine reload and close probes.

Do not remove `private: true` or publish a package without explicit user approval.
