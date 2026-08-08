# Zen Mods

Personal [Sine](https://github.com/CosmoCreeper/Sine) mods for
[Zen Browser](https://zen-browser.app). Each directory under `mods/` is an
independently installable mod with its own manifest, settings, source, and committed
build output.

## Mods

| Mod | Install URL | What it does |
|---|---|---|
| [Keep Loaded](mods/keep-loaded/README.md) | `https://github.com/gvanderclay/zen-mods/tree/main/mods/keep-loaded` | Keeps selected pinned tabs awake for notifications while the rest restore lazily |

## Development

The repository shares one TypeScript, Biome, Vitest, esbuild, and Lefthook toolchain.
Run commands from the repository root:

    npm install
    npm run build
    npm run check

`npm run check` typechecks, lints, tests, checks documentation, rebuilds every
scripted mod, and verifies that its committed `dist/` output is current.

Mod-specific commands are owned by that mod's npm workspace:

    npm run dev --workspace @zen-mods/keep-loaded
    npm run probe:wiring --workspace @zen-mods/keep-loaded

For local Sine development, link the individual mod directory rather than this
repository root:

    ln -s ~/workspace/zen-mods/mods/keep-loaded \
      "~/Library/Application Support/zen/Profiles/<profile>/chrome/sine-mods/keep-loaded"

That keeps Sine's one-folder-per-mod installation model while all source and tooling
remain in one repository.
