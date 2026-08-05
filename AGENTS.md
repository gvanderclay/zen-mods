# AGENTS.md

A [Sine](https://github.com/CosmoCreeper/Sine) mod for Zen Browser. Zen restores
pinned tabs lazily when asked to; this mod re-wakes an allowlist of them so tabs
you keep for notifications stay live. It runs with full browser-chrome privileges.

## Commands

| Command | What it does |
|---|---|
| `npm run check` | typecheck, lint, tests, docs, dist freshness — run this before saying you are done |
| `npm run build` | bundle `src/main.ts` to `dist/keep-loaded.uc.mjs` |
| `npm run dev` | same, rebuilding on save |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Biome check |
| `npm run format` | Biome check with `--write` |
| `npm test` | vitest, single run |
| `npm run docs` | markdownlint |

`typescript` is pinned to 6.0.3 on purpose. 7.x is the Go compiler and ships no
`tsserver` and no importable library, which breaks editor language servers and any
tool that loads TypeScript programmatically. Do not "upgrade" it.

## Layout

    src/main.ts     entry point Sine loads (bundled): orchestration only
    src/core/       pure logic. No window, no Services, no gBrowser.
    src/platform/   every privileged API touch: prefs, browser, sine, log
    types/          hand-authored types for Zen and Firefox internals
    dist/           committed build output — generated, never edited
    theme.json      mod manifest Sine installs from
    preferences.json  settings rows Sine renders; defaults must match core/defaults.ts

No published TypeScript types exist for Firefox chrome internals, so `types/` is
written by hand and is expected to be incomplete.

## Invariants

1. `src/core` stays free of browser globals. It decides on `TabFacts` snapshots
   taken by `platform/browser.ts` and never receives a tab. That is what makes it
   testable without a browser, and the test suite is the only fast signal here.
2. Every claim about Zen or Firefox internals cites the source file it was
   verified against. Zen ships at least one documented pref
   (`zen.tab-unloader.excluded-urls`) with no consumer anywhere, so documentation
   is not evidence. Extract the real sources:

       unzip -o /Applications/Zen.app/Contents/Resources/browser/omni.ja -d /tmp/bomni
       unzip -o /Applications/Zen.app/Contents/Resources/omni.ja -d /tmp/tk

3. Anything registered at runtime — listener, observer, timer, menu item — is
   pushed onto `state.disposers` and undone in teardown. Sine reloads every
   enabled mod whenever any mod is toggled, so a missing disposer means duplicate
   listeners (see D006).
4. State that must survive a mod reload lives on `window.zenKeepLoaded`. Module
   scope is discarded on every re-import.
5. The mod never changes a global pref outside its documented set, and never
   leaves `browser.sessionstore.restore_pinned_tabs_on_demand` flipped.
6. `dist/` is generated. Edit `src/` and rebuild.

## Working agreement

Work is split into checkpoints (`M##.C##`) listed in `notes/PLAN.md`.

- **Test-first.** Write the test for new `src/core` behavior, run it, watch it
  fail, then implement. If something worth testing is stuck inside
  `src/platform`, move the decision into `src/core` so it can be tested at all.
- Implement one checkpoint, then **stop with the changes uncommitted**.
- Provide manual test steps whenever the diff alone cannot prove the change:
  what to do, expected output, and what would count as a failure.
- Commit only after the user approves, staging only that checkpoint's files, with
  the message prefixed `zen-keep-loaded(M##.C##):`.
- A durable design choice gets a record in `notes/DECISIONS.md` in the checkpoint that
  makes it. Accepted records are superseded, never rewritten.

Most checkpoints are reviewable without restarting Zen: toggle the mod off and on
in Sine's mod list and watch the Browser Console (Cmd+Shift+J) for `[keep-loaded]`
lines.

## Reference

`notes/` is gitignored: the roadmap and the ledger are local working notes, not part
of what this repository publishes. Both are load-bearing for the work anyway.

- `notes/PLAN.md` — checkpoints and their order
- `notes/DECISIONS.md` — what was decided, why, and against which source
- `README.md` — user-facing behavior and the dev install
