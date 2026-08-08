# AGENTS.md

A monorepo of [Sine](https://github.com/CosmoCreeper/Sine) mods for Zen Browser.
Every child of `mods/` is an independent Sine package; the repository root owns the
shared development toolchain.

## Commands

| Command | What it does |
|---|---|
| `npm run check` | typecheck, lint, tests, docs, and dist freshness for the repository |
| `npm run build` | run every mod workspace's build |
| `npm run typecheck` | run every mod workspace's typecheck |
| `npm run lint` | Biome check |
| `npm run format` | Biome check with `--write` |
| `npm test` | run every mod workspace's tests |
| `npm run docs` | markdownlint |

Run `npm run check` before saying work is done. TypeScript is pinned to 6.0.3 on
purpose. Version 7.x is the Go compiler and ships no `tsserver` or importable
library, which breaks the editor and programmatic consumers. Do not upgrade it.

## Repository layout

    mods/<id>/         independently installable Sine and npm package
    package.json       aggregate commands and shared dependencies
    package-lock.json  one lockfile for every workspace
    notes/<id>/        gitignored checkpoint plan and decision ledger

Each mod directory owns its `package.json`, build/test configuration, `theme.json`,
preferences, source, types, styles, README, and committed `dist/`. Sine must be
given the mod's subdirectory URL and, for local development, the profile's
`sine-mods/<id>` path must link to that child directory rather than the monorepo
root. Run a mod-only command with `--workspace <package-name>`.

Never edit a `dist/` file directly. Edit its source and rebuild. Keep IDs, preference
namespaces, window state, and runtime teardown isolated between mods even when code or
tooling is shared.

## Working agreement

Each mod's nested `AGENTS.md` contains its invariants and checkpoint rules. Work on
one checkpoint at a time, stop with its changes uncommitted, and commit only after
the user approves. Stage only that checkpoint's files and use the commit prefix
required by the mod.
