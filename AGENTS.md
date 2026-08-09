# AGENTS.md

A monorepo of [Sine](https://github.com/CosmoCreeper/Sine) mods for Zen Browser.
Every child of `mods/` is an independent Sine package; the repository root owns the
shared development toolchain.

## Commands

| Command | What it does |
|---|---|
| `pnpm run check` | typecheck, lint, tests, docs, and dist freshness for the repository |
| `pnpm run build` | run every mod workspace's build |
| `pnpm run bundle:report` | validate bundles and write ignored esbuild graphs |
| `pnpm run bench` | run every mod benchmark serially |
| `pnpm run bench:record` | record a local comparison baseline under `.benchmarks/` |
| `pnpm run bench:compare` | compare current timings with the recorded baseline |
| `pnpm run clean:sine-backups` | delete local-installer backups from Sine |
| `pnpm run typecheck` | run every mod workspace's typecheck |
| `pnpm run lint` | Biome check |
| `pnpm run format` | Biome check with `--write` |
| `pnpm test` | run every mod workspace's tests |
| `pnpm run install:local <id>` | build and link one mod into Sine; Zen must be closed |
| `pnpm run install:local:all` | build and link every mod into Sine; Zen must be closed |
| `pnpm run install:local:restart <id>` | quit Zen, install one mod, and reopen Zen |
| `pnpm run install:local:all:restart` | quit Zen, install every mod, and reopen Zen |
| `pnpm run docs` | markdownlint |

Run `pnpm run check` before saying work is done. TypeScript is pinned to 6.0.3 on
purpose. Version 7.x is the Go compiler and ships no `tsserver` or importable
library, which breaks the editor and programmatic consumers. Do not upgrade it.
The pre-commit hook applies Biome's safe fixes to staged TypeScript, JavaScript,
JSON, and JSONC files and re-stages those fixes; errors Biome cannot fix still stop
the commit. It also checks staged Markdown. Bundle freshness remains enforced by
`pnpm run check` and the pre-push hook without changing normal Git commit behavior.

## Repository layout

    mods/<id>/         independently installable Sine and pnpm package
    scripts/            shared mod build tooling
    tsconfig.base.json  shared compiler defaults
    vitest.config.ts    shared test defaults
    package.json        aggregate commands and shared dependencies
    pnpm-lock.yaml      one lockfile for every workspace
    pnpm-workspace.yaml workspace membership and install policy
    notes/<id>/         gitignored checkpoint plan and decision ledger

Each mod directory owns its `package.json`, thin `tsconfig.json`, `theme.json`,
preferences, source, types, styles, README, and committed `dist/`. Shared build,
compiler, and test defaults stay at the root. Sine must be given the mod's
subdirectory URL and, for local development, the profile's `sine-mods/<id>` path
must link to that child directory rather than the monorepo root. Run a mod-only
command with `pnpm --filter <package-name> <command>`.

Never edit a `dist/` file directly. Edit its source and rebuild. Keep IDs, preference
namespaces, window state, and runtime teardown isolated between mods even when code or
tooling is shared.

## Working agreement

Each mod's nested `AGENTS.md` contains its invariants and checkpoint rules. Work on
one checkpoint at a time, stop with its changes uncommitted, and commit only after
the user approves. Stage only that checkpoint's files and use the commit prefix
required by the mod.
