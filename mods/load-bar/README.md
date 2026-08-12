# Load Bar

A clean-room [Sine](https://github.com/CosmoCreeper/Sine) mod for
[Zen Browser](https://zen-browser.app). It shows a delayed activity line in each visible
browser pane without presenting fake page-load percentages.

## Behavior

- Ordinary, split, and Glance panes each own their exact activity line.
- Fast loads that finish before the reveal delay do not flash a line.
- Successful loads complete the sweep before fading. Canceled and failed loads fade in
  place.
- Hidden background tabs keep Zen's native tab-loading UI instead of drawing content UI.
- Webpage-controlled DOM fullscreen hides the line. Browser-window fullscreen does not.
- Reduced motion uses a stationary full-width line. Forced colors uses the system
  highlight color.
- Zen's native loading preference is never changed. The native pill is hidden only while
  a ready Load Bar generation owns that browser window.

## Settings

Sine exposes four settings:

- **Position:** top or bottom;
- **Thickness:** 2, 3, or 4 pixels;
- **Color:** Firefox loading blue or Zen accent;
- **Reveal delay:** 0, 100, 200, or 500 milliseconds.

Position, thickness, and color update current lines immediately. A changed reveal delay
applies to the next load.

## Install

Enable **Install JS from unofficial sources** in Sine, then install:

    https://github.com/gvanderclay/zen-mods/tree/main/mods/load-bar

If the archived Load Bar is installed, disable it before enabling this replacement. The
two mods target the same visual role and should not be enabled together.

The archived mod's preferences are not migrated because its declared settings and CSS
behavior do not agree. Choose the four replacement settings directly in Sine.

## Rollback

Disable this mod in Sine to restore Zen's native loading indicator immediately. To return
to the archived Load Bar, keep this replacement disabled and enable the archived mod.
No browser preference needs to be reset: this mod does not write Zen's loading-indicator
preference or persistent browser state.

## Compatibility

Private browser surfaces were extracted and verified against:

- Zen `1.21.13b`, build `20260809044209`;
- Zen source commit `6c5a150de637c8c54a780de8da1b17249a608abd`;
- Firefox/Gecko `153.0.3`;
- Sine `2.3.3.0`.

The mod relies on Firefox tab progress listeners and Zen's tab panel, split-view, Glance,
and pane lifecycle surfaces. These are private APIs and may require a compatibility
update after Zen or Firefox changes them. Platform drift stops the custom generation,
removes its nodes and timers, and exposes Zen's native indicator instead of guessing.

## Known limits

- The line reports activity, not bytes, completion percentage, loading stage, or ETA.
- Only visible content panes receive a line. Background activity remains tab-level UI.
- The four documented settings are the complete v1 surface; custom colors and motion
  controls are not included.
- Browser engines do not expose one stable, truthful page-level percentage for all
  navigations, so percentage and hybrid progress remain a separate future decision.

## Development

Run from the repository root:

    pnpm --filter @zen-mods/load-bar check
    pnpm --filter @zen-mods/load-bar dev
    pnpm --filter @zen-mods/load-bar test:live-default-pane
    pnpm --filter @zen-mods/load-bar test:live-pane-seam
    pnpm --filter @zen-mods/load-bar test:live-settings
    pnpm --filter @zen-mods/load-bar test:live-visible-panes

The default-pane gate also validates Sine reload while the line is waiting, visible,
completing, and canceling. Every exact browser artifact records the staged production
hashes and the Zen, Gecko, and Sine stamp.

The committed `dist/` file is generated. Edit `src/`, never `dist/` directly.
