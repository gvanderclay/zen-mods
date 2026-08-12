# Load Bar

A clean-room [Sine](https://github.com/CosmoCreeper/Sine) mod for
[Zen Browser](https://zen-browser.app). It will show a delayed, indeterminate loading
line in each visible browser pane without presenting fake page-load percentages.

## Status

This package is under checkpointed development. The current foundation defines the
activity and settings contracts but does not install browser UI yet.

The accepted v1 will support:

- top or bottom placement;
- 2, 3, or 4-pixel thickness;
- Firefox loading blue or Zen's accent color;
- 0, 100, 200, or 500-millisecond reveal delay;
- reduced motion, forced colors, and DOM-fullscreen behavior;
- exact cleanup on Sine reload, window close, and disable.

Zen's own loading-indicator preference remains untouched. The custom line will hide
Zen's native pill only after the replacement is ready in that exact browser window.

## Development

Run from the repository root:

    pnpm --filter @zen-mods/load-bar check
    pnpm --filter @zen-mods/load-bar dev

The committed `dist/` file is generated. Edit `src/`, never `dist/` directly.
