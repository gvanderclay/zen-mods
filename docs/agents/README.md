# Agent context index

This directory is progressive context for coding agents and contributors. The root `AGENTS.md` is the short map; read only the page that matches the task, then consult source and tests as the authority.

## Choose the smallest relevant context

- [`architecture.md`](architecture.md) — repository boundaries, mod layering, generated bundles, and the Keep Loaded application/window split.
- [`workflow.md`](workflow.md) — checkpoint discipline, implementation order, validation, evidence, and handoff.
- [`project-memory.md`](project-memory.md) — consolidated project history, durable decisions, rejected paths, and supported open work.
- [`../performance/spidermonkey-gecko.md`](../performance/spidermonkey-gecko.md) — required measurement lane for performance, memory, startup, or bundle-size work.
- `mods/<id>/AGENTS.md` — the authoritative rules for the mod being changed; read the nearest one before editing that mod.
- `notes/<id>/PLAN.md` and `DECISIONS.md` — local, gitignored checkpoint state and durable decisions for an active mod.

Do not copy large source snippets into these pages. Link to the source, test, or exact external reference and explain what the reader should verify. If a rule can be enforced deterministically by a formatter, test, build graph, or hook, keep it there instead of adding prose instructions.

## Instruction precedence

User and system instructions come first. Within this repository, a deeper `AGENTS.md` narrows the root map for its directory. `CLAUDE.md` is an alternate entry point that imports the root map; it is not a second policy document.
