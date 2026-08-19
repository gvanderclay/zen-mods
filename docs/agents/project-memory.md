# Project memory

This page preserves the durable result of the project's Codex and Claude history
through 2026-08-19. It is a map, not a replacement for current source, tests, or the
local checkpoint ledgers.

## Source priority

When records disagree, use this order:

1. Current source, tests, manifests, and generated-bundle checks.
2. Root and nested `AGENTS.md` files plus the committed pages under `docs/agents/`.
3. The active local `notes/<id>/PLAN.md` and `DECISIONS.md` ledgers.
4. This page.
5. Historical chat transcripts.

Chats contain abandoned experiments, superseded advice, and findings from older Zen
builds. Do not restore a historical proposal merely because it was once approved in a
conversation. Confirm it against the current tree and exact installed platform first.

## Audit coverage

This consolidation reviewed:

- 131 Codex threads recorded directly against this repository: 7 main conversations
  and 124 subagent threads;
- 4 additional Codex conversations started elsewhere but verified by topic to have
  produced or diagnosed Keep Loaded, Copy Links, Pop Out Tab, or Zen resource work;
- 4 Claude project transcripts, the original Keep Loaded build transcript that began
  in a Dotfiles-scoped session, and the project's Claude memory files;
- every main user turn, assistant handoff or compaction summary, and available subagent
  final result;
- the full Git history, current source and READMEs, and every local plan and decision
  ledger.

Other histories that merely inherited an old repository path were excluded after their
recorded working directory and first task showed unrelated Dotfiles, Android, or Brick
work.

## Project evolution

| Period | Durable result |
|---|---|
| 2026-08-04–06 | Keep Loaded began as a local script, became a typed Sine mod, and gained settings, per-tab control, crash recovery, exact-Zen probes, title freshness, and a status panel. |
| 2026-08-07–08 | The standalone project became a pnpm monorepo. Tab Deduplicator and Sidebar Context Menu Customizer established the independent-mod layout and local install workflow. |
| 2026-08-09–10 | Root bundle and benchmark guards landed. Keep Loaded was rebuilt around terminal controller generations, one application owner, recoverable wake transactions, serial freshness, and application-owned widget state. |
| 2026-08-11–12 | Proven lifecycle and live-harness leaves became shared packages. Load Bar and Sidebar Polish replaced selected third-party mods after product and exact-platform research. |
| 2026-08-13–17 | Context-menu behavior was narrowed, native duplicate presentation was replaced without cross-mod metadata, and the Copy Links and Pop Out Tab mods shipped. |
| 2026-08-18 | The working directory was renamed to `zen-mods`. Repository guidance and new chats use the new path. |
| 2026-08-19 | Duplicate Tab Toast added native Zen confirmation for the built-in keyboard command without replacing duplication or shortcut ownership. |

The commit subjects remain a useful chronological record. Older
`zen-keep-loaded(M##.C##)` prefixes describe the original product, not the current
repository name.

## Durable repository decisions

### Workspace and ownership

- Each child of `mods/` is independently installable and owns its manifest,
  preferences, source, tests, styles, and committed `dist/`.
- Sine must link or install each mod directory, never the monorepo root. GitHub
  subdirectory installs are supported now that this is a true host repository with
  multiple `theme.json` files.
- IDs, preference namespaces, window expandos, logs, and teardown stay product-local.
- Shared packages contain only small behavior already proven identical in concrete
  consumers. They are bundled into consumers; they are not one shared browser runtime.

### Code and lifecycle

- Pure policy belongs in `src/core/`. It receives snapshots and never privileged tabs,
  windows, `Services`, or DOM nodes.
- Firefox, Zen, and Sine APIs live behind `src/platform/`. Runtime or entry layers own
  composition, current generations, and effects.
- A stopped generation is terminal. Late callbacks, waits, timers, observers, menu
  handlers, and panel completions must recheck generation ownership.
- Sine hot unload and native window close converge on one idempotent cleanup path.
  Sine 2.3.3.0 does not by itself cover every native close path.
- Keep Loaded is the exception to simple per-window ownership: window controllers own
  window resources, while one stable application owner serializes process-wide wake,
  recovery, freshness, preference, and status-widget work.

### Build and evidence

- Edit source and rebuild; never edit `dist/` directly. Production graph validation
  rejects test, benchmark, fixture, and harness leakage.
- CI is intentionally absent. Local hooks plus `pnpm run check` are the repository
  gate. Do not add CI incidentally to another checkpoint.
- Benchmarks are evidence, not pass/fail timing thresholds. Node measures V8, not the
  SpiderMonkey browser-chrome runtime.
- Private platform behavior requires the exact installed source or an exact-Zen probe.
  Routine probes record the observed Zen/Sine metadata and hashes and reject platform
  drift during the run. Strict evidence runs additionally require the known-good
  reference in
  [`platform-stamp.json`](../../packages/live-harness/src/platform-stamp.json). Refresh
  that pin when a recorded claim must target a different exact build; refresh the
  performance guide as well only for a new performance claim.
- Favor visible correctness and measured browser work over speculative abstractions,
  minification, engine folklore, or single-digit-millisecond cleanup.

## Current product map

### Keep Loaded

[`mods/keep-loaded`](../../mods/keep-loaded/README.md) is complete through M17.C01. It
keeps selected pinned tabs awake while other pins remain lazy, supports per-tab keep
state, handles crash and explicit-unload recovery, re-sweeps after resume/network
events, repairs restored pinned-tab titles, serializes optional freshness pulses, and
shows application-owned status and controls across windows.

Important boundaries:

- Closing a tab is intentional removal. Keep Loaded does not reopen closed tabs.
- An unloaded or crashed kept tab is recovered; an intentionally closed tab is not.
- The title problem had two causes: a hidden page can stop updating its own title, and
  Zen can reject title writes from restored pinned tabs. Freshness pulses address the
  first; the temporary `_zenChangeLabelFlag` repair addresses the second without using
  the session-persisted manual-rename field.
- `undiscardable` affects Firefox's memory-pressure selection, not Zen's explicit
  unload commands. The mod answers explicit unload by waking the kept tab again.
- WebSocket counters prove parent-process visibility but attach late, see no already
  open event, and intentionally do not inspect payloads. They are evidence, not a
  generic notification detector.
- The detailed architecture and source evidence live in
  [`architecture.md`](architecture.md), the mod's
  [`AGENTS.md`](../../mods/keep-loaded/AGENTS.md), and the local
  [`DECISIONS.md`](../../notes/keep-loaded/DECISIONS.md).

### Tab Deduplicator

[`mods/tab-deduplicator`](../../mods/tab-deduplicator/README.md) provides folder-aware
grouping and reviewed closing across structural lanes, optional pinned participation,
safe unpin-and-close, and native removal through Firefox's close machinery. It replaces
Firefox's visible tab-context duplicate action but retains Firefox's underlying close
behavior, SessionStore, undo, and unload safety.

The mod and Sidebar Context Menu Customizer remain independent. A cross-mod ownership
and replacement metadata scheme was tried and explicitly removed. The customizer sees
the live resulting menu without knowing which other mod produced it.

The M04 popup/planner rewrites remain measurement-deferred: the complete 500-tab
exact-browser popup path measured about 5.846 ms median and 6.970 ms p95. The optional
beforeunload document-swap probe remains a safety investigation, not an approved fix.

### Sidebar Context Menu Customizer

[`mods/sidebar-context-menu-customizer`](../../mods/sidebar-context-menu-customizer/README.md)
customizes the tab context menu. Root actions stay live; unchecked actions move under
**More actions**. The searchable anchored editor owns compact-sidebar visibility and
all delayed focus, observer, popup, and teardown work.

The old one-off **From submenus** Copy Link promotion was removed when Copy Links took
ownership. Generic submenu promotion, empty-sidebar customization, action reordering,
and custom grouping are not current behavior.

### Copy Links

[`mods/copy-links`](../../mods/copy-links/README.md) adds a separate top-level action
that copies Firefox's shareable selected tabs as newline-separated plain text. It does
not replace or modify the native **Share → Copy Link(s)** command. It exists because
the native mixed clipboard formats caused some receiving apps to paste only one URL.

### Duplicate Tab Toast

[`mods/duplicate-tab-toast`](../../mods/duplicate-tab-toast/README.md) observes Zen's
built-in **Duplicate Tab** command, counts the synchronous `TabOpen` events it produces,
and shows singular or plural confirmation through Zen's native toast manager. It does
not register or replace the shortcut, and direct or context-menu duplication remains
unchanged.

### Pop Out Tab

[`mods/pop-out-tab`](../../mods/pop-out-tab/README.md) exposes **Pop Out Current Tab**
through Zen's editable keyboard-shortcut system and moves the active tab into a synced
window for an external tiler such as AeroSpace. Disabling the mod removes its shortcut
row while retaining the last binding for re-enable.

A proposed **close all other Zen windows** action was rejected as destructive and
surprising, especially for private or unsynced windows. AeroSpace tiling after pop-out
was not manually verified in the implementation checkpoint.

### Load Bar

[`mods/load-bar`](../../mods/load-bar/README.md) is an activity indicator, not a fake
percentage. It owns one line per visible ordinary, split, or Glance pane, avoids flashes
for fast loads, supports position/thickness/color/delay, respects reduced motion and
forced colors, and uses the accepted clipped line-wobble motion.

Multiple hybrid and sticky progress estimates were prototyped and rejected because no
stable browser signal supplied a truthful page-level percentage. Do not restart that
work without a new platform signal.

### Sidebar Polish

[`mods/sidebar-polish`](../../mods/sidebar-polish/README.md) integrates Firefox's native
Bookmarks and History sidebars with Zen's geometry and interaction language. It also
adds native-equivalent History removal and the measured legacy-sidebar motion. It
deliberately leaves Synced Tabs, extension sidebars, Zen's tab sidebar, and web panels
unchanged.

## Shared package boundaries

- [`@zen-mods/sine-lifecycle`](../../packages/sine-lifecycle/README.md) owns terminal
  disposable scopes, generation-owned waits/timers, and dual Sine/native window
  binding. It is not a state, queue, effects, or application framework. A higher-level
  generation factory was tested and removed after increasing small-consumer bundles
  without enough benefit.
- [`@zen-mods/live-harness`](../../packages/live-harness/README.md) owns exact installed
  platform capture, optional pinned validation, the Zen launcher, Marionette transport,
  and evidence validation. Browser scenarios, assertions, product manifests, and
  artifact schemas remain in the mods that own them.
- [`@zen-mods/browser-chrome-ui`](../../packages/browser-chrome-ui/README.md) owns the
  current anchored editor-panel surface. It has one product consumer. Do not broaden
  it or merge unrelated panel ownership models until a second cohesive consumer proves
  the same contract. Its behavior is currently covered through the consumer's exact
  live-XUL gate.

## Platform findings worth retaining

- `gBrowser.tabs` is scoped to the active Zen space. Cross-space code uses
  `gZenWorkspaces.allStoredTabs` and treats its memo invalidation as privileged work.
- Sine reads installed script, style, and preference paths from the profile's
  `mods.json`, not directly from the repository's `theme.json` during each load.
- Toggling a Sine mod can reload every enabled JavaScript mod. Missing cleanup becomes
  duplicate listeners and stale generations quickly.
- Context-menu nodes do not expose creator provenance after insertion. A live DOM node
  cannot always prove whether Firefox, Zen, or a mod created it. Do not recreate the
  rejected cross-mod metadata convention without a new concrete consumer.
- A CustomizableUI widget is application-scoped while its view and callbacks are
  window-scoped. Stable widget callbacks must route to the exact current view and
  generation.
- A panelview parked in `#appMenu-viewCache` uses `ownerDocument.defaultView`;
  `ownerGlobal` can be undefined, and PanelMultiView can swallow the resulting error.
- The user's Browser Console has historically allowed reading output while rejecting
  evaluation unless both chrome-debug prefs are enabled. Prefer the throwaway-profile
  harness. When manual validation is unavoidable, give exact UI paths, actions,
  expected output, pass/fail conditions, and cleanup.
- Verify agent work directly when the harness can reach it. Manual validation is for
  signed-in state, real window-manager behavior, or visual judgment the harness cannot
  establish.

## Open work with durable support

No checkpoint is currently active at the repository root. Re-read the target plan
before selecting work.

The best-supported small production candidate from the latest review is removing Keep
Loaded's unused first verdict pass in `pulseCycle`: start from ordered pinned tabs, then
retain the existing fresh facts and keep verdict immediately before each tab acts. It
removes one discarded privileged facts read per pinned tab per enabled pulse. Freshness
is off by default, so this is a call-count cleanup, not a user-visible performance
claim. It has not been authorized for implementation.

Other retained work:

- Keep Loaded socket-gated freshness needs real comparative data; staleness reload is
  still off by default and data-gated. Title reformatting and the window-actor route are
  separate later products.
- A closed-tab timeout was discussed but never planned or implemented. The user's
  preferred shape was a positive delay with `0` disabling it, plus a cancelable
  **Keep closed** notice. Treat this as a new product decision, not current behavior.
- Context Menu Customizer may later add empty-sidebar ownership, reordering, and custom
  groups. Each broadens its platform matrix and requires a new checkpoint.
- Tab Deduplicator's exact beforeunload/document-swap probe remains optional. Planner
  micro-optimizations stay deferred until exact popup measurements cross the value
  gate.
- Configurable Keep Loaded freshness concurrency, startup wake batching, and proactive
  idle unloading remain later experiments.

Source-backed new-mod candidates worth retaining, but not approved:

| Candidate | Evidence and boundary |
|---|---|
| Shortcut Guard | Zen shortcuts default to non-reserved, matching reports where sites consume browser shortcuts. Reserve only user-selected commands after each keyset rebuild. Live reproduction is still required. |
| Reliable Space Routing | Exact-source reproduction found hostname `contains` false positives and an incorrectly escaped multi-tab regex. Fix newly created domain rules; do not reinterpret existing user rules silently. |
| Session Rescue | Zen retains multiple timestamped session backups but automatic recovery considers only `clean.jsonlz4` and the newest timestamped file. Start read-only: list, summarize, compare, and export. Never overwrite the live session while Zen runs. |
| Resource Peek | No Sine-packaged resource monitor was found. FirefoxTaskMonitor and ErgoZen are implementation references. Prefer an on-demand panel over a permanent meter, and treat CPU/memory numbers as approximate process attribution. |
| Inactive Workspace Governor | Zen has real manual workspace-unload paths but no automatic inactive-workspace policy. Measure memory and background CPU before building; preserve media, calls, downloads, selected tabs, and Keep Loaded ownership. |

## Decisions not to reopen casually

- No generic runtime, state, queue, effect, lifecycle, or context-menu framework.
- No broad Keep Loaded split without a behavioral checkpoint and exact gates.
- No production minification by default; the A/B kept readable bundles.
- No generic JavaScript or Wasm micro-optimization work without exact-browser evidence.
- No Mail.app relay. Gmail's kept page already delivers notifications; Mail introduced
  Apple Events permission, launch, freshness, and data-consistency problems. The Atom
  feed works but is container-specific and was viable-not-chosen.
- No GitHub Live Folder status mod. The user dropped it after confirming native favicons
  already update. Notifications-only work was not pursued.
- No SuperPins replacement. The user removed it and decided its remaining value did
  not justify ownership.
- No full Better Sidebar clone. The native sidebars were sufficient; Sidebar Polish
  owns only the accepted integration improvements.
- No Load Bar percentage estimate without a truthful platform signal.
- No Pop Out Tab command that closes every other window.

## Maintaining this page

Update this page only when a later checkpoint changes a cross-project fact, resolves a
listed open item, or accepts/rejects a retained candidate. Product-specific details
belong in the owning README, source, tests, and local decision ledger.

Do not turn this into a second roadmap. The active `notes/<id>/PLAN.md` remains the
checkpoint authority.
