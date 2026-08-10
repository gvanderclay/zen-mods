# Architecture context

This is a navigation page, not a substitute for source review. Use it to find the boundary that owns a change.

## Workspace boundaries

The root owns pnpm workspaces, TypeScript/Vitest defaults, build graph validation, bundle freshness, shared harnesses, and repository-wide docs. A mod owns its manifest, preferences, source, tests, styles, README, and committed generated `dist/`. Never link Sine to the monorepo root when developing a mod; link the mod's own directory.

## Typical mod layering

- `src/core/` contains pure state and policy decisions. It receives snapshots, not browser objects.
- `src/platform/` is the narrow adapter boundary for Firefox/Zen, Sine, preferences, browser tabs, logging, and privileged events.
- `src/runtime.ts` or an equivalent controller owns a terminal generation and its continuations, timers, observers, listeners, and disposers.
- `src/main.ts` composes platform ports and starts/stops the generation; it should not become a second policy engine.
- `types/` contains hand-maintained declarations for private browser APIs. Treat them as incomplete and verify behavior against installed sources.
- `dist/` is generated output. Source and build-graph checks, not manual edits, determine its contents.

## Keep Loaded-specific boundary

Keep Loaded has a per-window UC entry and a process-scoped stable system owner. The owner serializes application-wide work; window controllers own window resources and register with that owner. The application owner uses a protocol handshake because Sine can cache the stable system-module URI while reloading cache-busted window code. Changes to the owner or its entry require the protocol/version rule in `mods/keep-loaded/AGENTS.md`, a rebuild, and the relevant exact live gate.

Do not move browser effects into `src/core/`, park state on Sine or `Services` expandos, or treat a synthetic fixture as proof that the shipped bundle registered a listener. For private APIs, record the installed source path, revision/stamp, extracted lines, and the behavior those lines establish in the mod's decision ledger.

## Where proof belongs

- Pure invariants and state transitions: unit tests near `src/core/` or the owning application/controller.
- Adapter contracts and callback liveness: platform tests with forced retained callbacks, not only ordinary dispatch.
- Bundle composition and leakage: build graph and dist verification.
- Cross-window, reload, close, and browser-chrome behavior: staged exact-Zen probes with raw evidence and fail-closed assertion manifests.
- Performance or engine claims: the measurement lane in `docs/performance/spidermonkey-gecko.md`; a Node/V8 benchmark is diagnostic, not SpiderMonkey evidence.
