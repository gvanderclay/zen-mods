# Repository agent map

This repository is a pnpm monorepo of independently installable [Sine](https://github.com/CosmoCreeper/Sine) mods for Zen Browser. The root owns shared tooling; each child of `mods/` owns its package, source, tests, and generated bundle.

Read the nearest nested `AGENTS.md` before changing a mod. Deeper instructions are more specific. `CLAUDE.md` imports this file, so keep one source of truth instead of maintaining parallel instructions.

## Start here

- Read [the agent context index](docs/agents/README.md), then only the focused architecture or workflow page relevant to the task.
- Read the target mod's `AGENTS.md` and its local checkpoint plan in `notes/<id>/` (the notes are intentionally gitignored).
- Preserve unrelated user changes. Work on one checkpoint at a time and leave its changes uncommitted until the user approves.

## Repository map

- `mods/<id>/` — independently installable Sine packages and their committed generated `dist/`.
- `scripts/` — shared build, graph, verification, and harness tooling.
- `docs/` — durable engineering and measurement guidance.
- `notes/<id>/` — local checkpoint plan and decision ledger; do not publish or delete casually.
- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`, `vitest.config.ts` — shared workspace defaults.

## Common commands

```text
pnpm run check                  # repository gate: typecheck, lint, tests, docs, dist freshness
pnpm run build                  # build every mod
pnpm run bundle:report          # validate bundles and write ignored graphs
pnpm --filter <package> check   # one mod's gate
pnpm --filter <package> test    # one mod's tests
pnpm run install:local:restart <id>  # build, link, and reopen Zen
```

Run `pnpm run check` before declaring work complete. TypeScript is intentionally pinned to 6.0.3; do not upgrade it to 7.x. The pre-commit hook formats staged code and checks staged Markdown. Use the repository's deterministic formatters and linters rather than encoding style preferences here.

## Non-negotiable boundaries

- Never edit `dist/` directly. Change source, then rebuild and verify the generated output.
- Keep mod IDs, preference namespaces, window state, and teardown ownership isolated between mods.
- Keep pure decisions in a mod's `src/core/`; privileged Firefox/Zen APIs belong behind `src/platform/` adapters and composition belongs in the entry/runtime layer.
- Cite exact installed Zen/Firefox source when documenting private platform behavior; a preference declaration alone is not evidence.
- Before performance, memory, startup, or bundle-size work, read [`docs/performance/spidermonkey-gecko.md`](docs/performance/spidermonkey-gecko.md). Node benchmarks measure V8 and do not establish SpiderMonkey or browser-chrome improvements.
- Use the checkpoint's required commit prefix and stage only that checkpoint's files. Do not commit without explicit user approval.

When a root command conflicts with a nested mod rule, the more specific nested rule governs that mod. User and system instructions always take precedence over this file.
