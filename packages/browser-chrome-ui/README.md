# Browser Chrome UI

Shared, source-only UI primitives for the browser-chrome surfaces used by this
repository's Sine mods. Consumers import a primitive through the workspace package;
esbuild bundles it into that mod's committed `dist/`, so installed mods do not need
this package at runtime.

`anchored-editor-panel` provides a compact, theme-aware XUL panel with an HTML editor
surface, search field, responsive sizing, focus management, Escape and outside-click
closing, opener focus restoration, and complete teardown. It resets native HTML form
appearance and maps Firefox/Zen semantic colors into stable component tokens. It
deliberately exposes body and footer slots instead of knowing anything about tabs or a
particular mod. Consumers can also append panel-scoped author-origin CSS with the
`styles` option, so browser rules cannot unexpectedly repaint product controls.
