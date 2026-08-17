# Zen Mods

Personal [Sine](https://github.com/CosmoCreeper/Sine) mods for
[Zen Browser](https://zen-browser.app). Each directory under `mods/` is an
independently installable mod with its own manifest, settings, source, and committed
build output. Reusable production primitives and Node-only test infrastructure live
under `packages/`; only production imports are bundled into consuming mods.

## Libraries

| Package | Purpose |
|---|---|
| [`@zen-mods/browser-chrome-ui`](packages/browser-chrome-ui/README.md) | Browser-chrome panel and editor UI primitives |
| [`@zen-mods/live-harness`](packages/live-harness/README.md) | Exact-Zen launcher, Marionette client, and evidence validation for live tests |
| [`@zen-mods/sine-lifecycle`](packages/sine-lifecycle/README.md) | Terminal cleanup, generation-owned async work, and Sine/native unload binding |

## Mods

| Mod | Install URL | What it does |
|---|---|---|
| [Copy Links](mods/copy-links/README.md) | `https://github.com/gvanderclay/zen-mods/tree/main/mods/copy-links` | Copies a tab or multiselection as newline-separated plain-text URLs |
| [Keep Loaded](mods/keep-loaded/README.md) | `https://github.com/gvanderclay/zen-mods/tree/main/mods/keep-loaded` | Keeps selected pinned tabs awake for notifications while the rest restore lazily |
| [Tab Deduplicator](mods/tab-deduplicator/README.md) | `https://github.com/gvanderclay/zen-mods/tree/main/mods/tab-deduplicator` | Manually closes duplicate tabs in the current space while protecting pinned and essential tabs |
| [Sidebar Context Menu Customizer](mods/sidebar-context-menu-customizer/README.md) | `https://github.com/gvanderclay/zen-mods/tree/main/mods/sidebar-context-menu-customizer` | Hides unwanted actions from the sidebar tab context menu |
| [Sidebar Polish](mods/sidebar-polish/README.md) | `https://github.com/gvanderclay/zen-mods/tree/main/mods/sidebar-polish` | Makes Firefox's Bookmarks and History sidebars feel native to Zen |

## Development

The repository shares one TypeScript, Biome, Vitest, esbuild, and Lefthook toolchain.
Run commands from the repository root:

    pnpm install
    pnpm run build
    pnpm run check

`pnpm run check` typechecks, lints, tests, checks documentation, rebuilds every
scripted mod, and verifies that its committed `dist/` output is current.

The pre-commit hook formats staged source and configuration files, stages those safe
fixes, and checks staged Markdown without changing normal Git commit behavior.
Production bundle freshness remains enforced by `pnpm run check` and pre-push.

Performance measurements run one mod at a time so the workspaces do not compete for
the same CPU. Record a machine-local baseline before an optimization, then compare the
same fixed workloads afterward:

    pnpm run bench:record
    pnpm run bench:compare

The ignored `.benchmarks/` directory contains the raw samples and environment metadata.
`pnpm run bundle:report` also writes each mod's esbuild graph there while enforcing the
same production-only graph rules used by every normal build. Benchmarks are diagnostic;
they are intentionally not noisy pass/fail thresholds in `pnpm run check`. Comparison
fails closed when recording was interrupted or the workload, runner, machine, or saved
artifacts no longer match, instead of printing a misleading ratio.

Before changing code primarily for speed, memory, startup, or bundle size, consult the
[SpiderMonkey and Gecko performance guide](docs/performance/spidermonkey-gecko.md). It
records the exact browser execution model, measurement lanes, WebAssembly decision,
and project-specific optimization route so Node/V8 microbenchmarks are not mistaken for
proof about Zen's parent process.

Mod-specific commands are owned by that mod's pnpm workspace:

    pnpm --filter @zen-mods/keep-loaded dev
    pnpm --filter @zen-mods/keep-loaded probe:wiring

For local Sine development, quit Zen and build and install every mod workspace with:

    pnpm run install:local:all

Or install an individual workspace with:

    pnpm run install:local copy-links
    pnpm run install:local keep-loaded
    pnpm run install:local tab-deduplicator
    pnpm run install:local sidebar-context-menu-customizer
    pnpm run install:local sidebar-polish

On macOS, restart-aware actions quit Zen cleanly, wait for it to exit, install, and
reopen it automatically:

    pnpm run install:local:restart tab-deduplicator
    pnpm run install:local:all:restart

If Zen does not quit within 30 seconds—such as when a page presents a quit prompt—the
action stops without editing Sine's database. Zen is reopened after an installation
failure as well as after success. The individual action accepts the same
`--profile <path>` override as `install:local`; the aggregate action does not.

The aggregate command uses pnpm's `mods/*` workspace filter and runs each install
serially because they share Sine's `mods.json`. Each install discovers the default Zen
profile, builds the mod, links its directory, backs up `mods.json`, and registers it as
an enabled local mod. It refuses to edit the database while Zen is running; pass
`--profile <path>` to the individual command to override profile discovery. This keeps
Sine's one-folder-per-mod installation model while all source and tooling remain in one
repository.

Those timestamped local-installer backups can be previewed and deleted with:

    pnpm run clean:sine-backups --dry-run
    pnpm run clean:sine-backups

Cleanup only matches files named `mods.json.bak-local-<timestamp>`; it does not touch
Sine's live database or backups created by anything else.
