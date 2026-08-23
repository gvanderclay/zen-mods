# AGENTS.md

A style-only Sine mod that gives Zen compact mode a calmer, Safari-like panel.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm --filter @zen-mods/safari-zen check` | validates this package |
| `pnpm --filter @zen-mods/safari-zen install:local` | installs it into the default Zen profile |

Run commands from the repository root.

## Invariants

1. Change compact-mode UI only. Do not affect normal Zen layout, web content, or Firefox sidebars.
2. Keep all settings in the `mod.safari-zen.*` namespace.
3. Do not write macOS defaults, Zen-owned preferences, or persistent browser state.
4. Do not ship privileged scripts or patch Zen JavaScript methods.
5. Preserve Zen's acrylic setting as an explicit user choice.
6. Use Zen and Firefox design tokens instead of fixed theme colors.

The installed compatibility boundary is `browser/omni.ja`,
`chrome/browser/content/browser/zen-styles/zen-compact-mode.css`, from Zen
1.21.15b (build 126.8.18). Revalidate its selectors and variables when Zen changes
compact mode.

Work is checkpointed in `notes/safari-zen/` and committed only after approval with
`safari-zen(R01.C##):`.
