# Live Harness

Node-only infrastructure for exact Zen and Sine integration probes.

The package owns four explicit seams:

- `@zen-mods/live-harness/core` validates probe evidence.
- `@zen-mods/live-harness/marionette` speaks the privileged Marionette protocol.
- `@zen-mods/live-harness/platform-stamp` validates the exact Zen/Sine version stamp.
- `@zen-mods/live-harness/zen-launcher` stages one allowlisted mod in a throwaway profile.

Browser-side probe scenarios remain inside their owning mods. This package has no
production entry point and must never be reachable from a mod bundle.

The launcher defaults to the package's synthetic Sine lifecycle fixture. Production
probes pass an explicit `stagedMod` allowlist for their owning mod.

Routine probes use `platformMode: "observed"`: the launcher captures the installed
Zen metadata and the exact Zen/Sine hashes before launch, returns that stamp with the
run, then checks the same files again after Zen exits. Cleanup still removes the
throwaway profile when that final check detects drift.

Recorded benchmark or historical evidence uses `platformMode: "pinned"`. That mode
also requires the observed installation to match `src/platform-stamp.json`; the file is
a known-good reference, not a prerequisite for routine smoke tests.
