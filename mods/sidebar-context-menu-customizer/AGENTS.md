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

## Invariants

1. Customization changes presentation only. It never invokes or replaces a browser
   menu command.
2. The customizer itself cannot be hidden, so the user always has a recovery path.
3. Browser-owned `hidden` state is snapshotted after Firefox and Zen calculate it.
   Custom hiding temporarily overrides that state while the popup is open, then
   restores the exact snapshot on popup close and teardown. This is required for
   native macOS context menus, which do not apply chrome CSS.
4. Items added by other mods are discovered when the customization submenu opens;
   no fixed allowlist decides what can be hidden.
5. Context-specific variants with the same displayed label are one logical editor row;
   toggling it updates every represented preference key.
6. Promoted actions proxy the browser's command against its live context. They never
   reparent browser-owned submenu nodes or copy Firefox's command policy.
7. Runtime registrations are pushed onto window-persistent state and disposed when
   Sine reloads the mod.
8. `src/core` is pure, and `dist/` is generated and committed.

Private Firefox and Zen surfaces must be cited beside the platform code that uses
them. Work is checkpointed in `notes/sidebar-context-menu-customizer/` and committed
only after approval with `sidebar-context-menu-customizer(M##.C##):`.
