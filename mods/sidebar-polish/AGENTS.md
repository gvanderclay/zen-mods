# AGENTS.md

A CSS-only Sine mod that makes Firefox's legacy Bookmarks and History sidebars
feel native to Zen without replacing their behavior.

## Commands

| Command | What it does |
|---|---|
| `pnpm --filter @zen-mods/sidebar-polish check` | validates the style-only package |
| `pnpm --filter @zen-mods/sidebar-polish install:local` | installs it into the default Zen profile |

Run commands from the repository root.

## Invariants

1. Keep Firefox's sidebar header, close button, icon, throbber, focus, selection,
   drag/drop, and resize behavior native.
2. Scope rules to legacy Bookmarks and History content documents. Do not restyle
   Synced Tabs, extension sidebars, Zen's tab sidebar, or web panels.
3. Use Firefox and Zen design tokens instead of hard-coded theme colors.
4. Keep the mod CSS-only. Do not add JavaScript for visual behavior.
5. Treat legacy sidebar selectors as a compatibility boundary and revalidate them
   when Zen changes its sidebar implementation.

Work is checkpointed in `notes/sidebar-polish/` and committed only after approval
with `sidebar-polish(R01.C##):`.
