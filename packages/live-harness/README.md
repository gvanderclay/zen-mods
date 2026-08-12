# Live Harness

Node-only infrastructure for exact Zen and Sine integration probes.

The package owns three explicit seams:

- `@zen-mods/live-harness/core` validates evidence and platform stamps.
- `@zen-mods/live-harness/marionette` speaks the privileged Marionette protocol.
- `@zen-mods/live-harness/zen-launcher` stages one allowlisted mod in a throwaway profile.

Browser-side probe scenarios remain inside their owning mods. This package has no
production entry point and must never be reachable from a mod bundle.

The launcher defaults to the package's synthetic Sine lifecycle fixture. Production
probes pass an explicit `stagedMod` allowlist for their owning mod.
