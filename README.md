# Zen Mods

Personal [Sine](https://github.com/CosmoCreeper/Sine) mods for
[Zen Browser](https://zen-browser.app). Each directory under `mods/` is an
independently installable mod with its own manifest, settings, source, and committed
build output. Reusable browser-chrome UI primitives live under `packages/` and are
bundled into each consuming mod.

## Mods

| Mod | Install URL | What it does |
|---|---|---|
| [Keep Loaded](mods/keep-loaded/README.md) | `https://github.com/gvanderclay/zen-mods/tree/main/mods/keep-loaded` | Keeps selected pinned tabs awake for notifications while the rest restore lazily |
| [Tab Deduplicator](mods/tab-deduplicator/README.md) | `https://github.com/gvanderclay/zen-mods/tree/main/mods/tab-deduplicator` | Manually closes duplicate tabs in the current space while protecting pinned and essential tabs |
| [Sidebar Context Menu Customizer](mods/sidebar-context-menu-customizer/README.md) | `https://github.com/gvanderclay/zen-mods/tree/main/mods/sidebar-context-menu-customizer` | Hides unwanted actions from the sidebar tab context menu |

## Development

The repository shares one TypeScript, Biome, Vitest, esbuild, and Lefthook toolchain.
Run commands from the repository root:

    pnpm install
    pnpm run build
    pnpm run check

`pnpm run check` typechecks, lints, tests, checks documentation, rebuilds every
scripted mod, and verifies that its committed `dist/` output is current.

Mod-specific commands are owned by that mod's pnpm workspace:

    pnpm --filter @zen-mods/keep-loaded dev
    pnpm --filter @zen-mods/keep-loaded probe:wiring

For local Sine development, quit Zen and build and install every mod workspace with:

    pnpm run install:local:all

Or install an individual workspace with:

    pnpm run install:local keep-loaded
    pnpm run install:local tab-deduplicator
    pnpm run install:local sidebar-context-menu-customizer

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
