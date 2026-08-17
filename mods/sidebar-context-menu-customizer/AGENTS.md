# AGENTS.md

A Sine mod for customizing context menus shown from Zen's sidebar. The first
checkpoint covers the tab context menu; empty-sidebar customization follows later.

## Commands

| Command | What it does |
|---|---|
| `pnpm run check` | checks every workspace plus repository lint and docs |
| `pnpm --filter @zen-mods/sidebar-context-menu-customizer check` | checks this mod |
| `pnpm --filter @zen-mods/sidebar-context-menu-customizer dev` | rebuilds this mod on change |
| `pnpm --filter @zen-mods/sidebar-context-menu-customizer test` | runs this mod's tests |
| `pnpm --filter @zen-mods/sidebar-context-menu-customizer test:live-xul` | drives the shipped bundle through stamped Zen/Sine in a throwaway profile |
| `pnpm --filter @zen-mods/sidebar-context-menu-customizer test:live-xul:headed` | opens that path for a native macOS visual smoke |
| `pnpm --filter @zen-mods/sidebar-context-menu-customizer test:live-xul:record` | records 30 live popup/editor/reload samples locally |

## Invariants

1. Customization changes presentation only. It never invokes or replaces a browser
   menu command.
2. The customizer itself cannot be hidden, so the user always has a recovery path.
3. Firefox and Zen calculate each live action's context state before the mod changes
   presentation. Actions excluded from the root are temporarily reparented into the
   mod-owned **More actions** popup without changing their browser-owned `hidden`,
   `disabled`, command, or submenu state. Their exact root order and any separator
   visibility overrides are restored before the next browser calculation, on popup
   close, and on teardown. Late action replacements are observed and moved into the
   same presentation without losing their restored position. This is required for
   native macOS context menus, which do not apply chrome CSS.
4. Items added by other mods are discovered when the persistent editor opens;
   no fixed allowlist decides what can be hidden.
5. Context-specific variants with the same displayed label are one logical editor row;
   toggling it updates every represented preference key.
6. Excluded actions move as live nodes so their browser commands remain intact. The
   customizer does not proxy submenu commands or copy Firefox's command policy.
7. Runtime registrations belong to one terminal `@zen-mods/sine-lifecycle` scope.
   Sine reload, replacement, and native window close converge on its idempotent stop.
8. The editor shell comes from the reusable `@zen-mods/browser-chrome-ui` workspace;
   tab-menu inventory and preference policy remain inside this mod.
9. `src/core` is pure, and `dist/` is generated and committed.

The live-XUL harness is an explicit platform check, not part of ordinary `pnpm run
check`: it requires the locally installed Zen/Sine versions recorded in
`../../packages/live-harness/src/platform-stamp.json`. It must start from an isolated
`--no-remote` profile and never copy the user's mods, browsing data, or preferences.

Private Firefox and Zen surfaces must be cited beside the platform code that uses
them. Work is checkpointed in `notes/sidebar-context-menu-customizer/` and committed
only after approval with `sidebar-context-menu-customizer(M##.C##):`.
