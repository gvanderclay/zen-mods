# Keep Loaded status panel design and acceptance

Status: implemented and accepted through `M16.C04`.

## Purpose

The panel should answer three questions in order:

1. Is Keep Loaded working?
2. Which kept tabs need attention?
3. Is there a safe action I can take now?

It is a status surface, not a second settings page and not a debugging console. Detailed
network counters can support a diagnosis, but they must not outrank whether a tab is awake,
sleeping, quiet, or crashed.

## Evidence from the pre-M16 UI

The exact Zen panel probe rendered the current mixed state at 316 by 209 pixels. It placed
the widget in `zen-sidebar-foot-buttons`, rendered three 39-pixel rows across two spaces,
kept the footer open during a wake, and changed its action to disabled `Waking…`. This
confirms that the native `CustomizableUI` subview is the right physical surface.

The audit also found these state-specific problems:

| State | Current presentation | Problem |
|---|---|---|
| Empty | `nothing kept` plus disabled `Nothing to wake` | It gives no path to add a kept tab and repeats the absence twice. |
| Mixed | A dense heading, space labels, and two diagnostic clauses per row | Health, evidence, and WebSocket diagnostics have equal weight. |
| Busy | The previous rows remain and the footer reads `Waking…` | The interaction is safe, but there is no explicit progress/status announcement. |
| Crash budget | A row reads `crashed`, without attempt or limit information | A user cannot tell whether recovery is running, exhausted, disabled, or restart-bound. |
| Failure | Rows become `something went wrong`, while the prior footer can survive | Stale success and a live-looking action can remain after status collection failed. |

The current rows are correctly grouped by Zen space, sort concerns before healthy tabs,
spell state words out instead of relying on color, retain full URLs in tooltips, and leave
renamed tabs alone. Those behaviors remain.

## Research and platform review

This proposal was checked against the current Firefox design system and the actual browser
surface rather than an unrelated web-dashboard pattern:

- [Acorn](https://acorn.firefox.com/latest/get-started/resources/fa-qs/mozilla-design-systems-landscape-g56QlqB6)
  is Firefox's current design system; Photon is deprecated. Acorn's
  [empty-state guidance](https://acorn.firefox.com/latest/content/patterns/writing-for-empty-states-NQLxhgJJ)
  favors a concise, sentence-case benefit or next step instead of a negative `No …`
  headline. The proposed empty title is therefore `Keep a pinned tab awake`, with one
  sentence explaining the Sine-settings and pinned-tab-menu paths.
- Acorn's [button guidance](https://acorn.firefox.com/latest/desktop/components/button-gsFv3Uj9)
  calls for active, sentence-case labels, no more than one primary action per screen, and
  room for at least 50% text growth. `Wake …` is the only primary action; reset is a
  default/quiet action, and neither receives a fixed text width.
- Firefox's
  [PanelMultiView lifecycle](https://firefox-source-docs.mozilla.org/browser/components/customizableui/docs/panelmultiview.html)
  can move a view before it is visible, size it asynchronously off-screen, and preserve
  keyboard state while it remains open. That reinforces using the native panel header,
  separator, scrolling body, and footer, and updating captured nodes rather than assuming
  a stable cache parent.
- W3C's [`role=status` technique](https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA22)
  requires the live container to exist before its message changes. The feedback node is
  permanent, polite, and explicitly `aria-atomic=true`; it is not created only after an
  operation finishes.
- The exact installed Zen chrome styles import Firefox's design-system panel CSS, set the
  native menu width, and make `.panel-subview-body` vertically scrollable without horizontal
  overflow (`chrome/browser/skin/classic/browser/customizableui/panelUI-shared.css` 5,
  17, and 223–229). Native views use `.panel-header`, `.panel-subview-body`, and
  `.panel-subview-footer-button` (`chrome/browser/content/browser/browser.xhtml` 786–792
  and `panelUI-shared.css` 1337 and 1766–1800). The proposal keeps that anatomy and its
  semantic panel/text/border/button tokens. It adds no custom product palette.

The design probe opens a real `CustomizableUI`/`PanelMultiView` in a throwaway headless Zen,
records the real popup dimensions, then moves those same rendered XUL contents to a
chrome-document capture surface because headless Gecko omits native popup layers from
screenshots. The capture is suitable for reviewing hierarchy, wrapping, density, and token
contrast. Popup anchoring remains covered by native `PanelMultiView` behavior and the exact
button interaction gates rather than by a composited headless screenshot.

The reviewed 325-pixel dark-theme prototypes measured 424 pixels high for three mixed rows,
307 for busy and recovery-limit, 158 for empty, and 216 for unavailable. Visual review
changed the draft in four concrete ways: neutral `Awake`/`Quiet` labels lost unnecessary
badge chrome, row evidence collapsed to one subordinate line, busy copy stopped repeating
the same progress three times, and a crashed-only panel no longer claims every tab is
awake. Those ignored audit captures live under `.benchmarks/ui/m16-c01d/`. The completed
C04 matrix lives under `.benchmarks/ui/m16-c04/`; reproduce it with:

```sh
node mods/keep-loaded/tools/harness/probe-panel-design.mjs
```

## Implemented information architecture

The panel has four stable regions:

```text
Keep Loaded
3 kept tabs
1 sleeping · 2 awake

WORK
mail.google.com                         Sleeping
Unloaded 2m ago

slack.com                                 Awake
Title changed 12s ago · WebSocket activity 3s ago

HOME
calendar.google.com                       Quiet
Last sign 18m ago

──────────────────────────────────────────────
Wake 1 sleeping tab
Reset crash recovery history
[polite status feedback]
```

The order is deliberate:

- The title identifies the product, not the current count.
- The total and state summary provide the glanceable answer.
- Space groups and concern-first rows provide the evidence.
- The primary wake action stays in a fixed footer outside the scrolling body.
- Crash-history reset is a quiet secondary action, not a peer of the normal wake path.
- Action feedback uses a dedicated polite status line rather than replacing row content.

### Vocabulary

Internal state names can remain unchanged, but visible labels use:

| Internal | Visible | Meaning |
|---|---|---|
| `crashed` | `Crashed` | The content process failed or needs restart/recovery attention. |
| `asleep` | `Sleeping` | SessionStore still has a lazy browser shell. |
| `unseen` | `No signal yet` | The tab is awake but has not produced evidence since observation began. |
| `quiet` | `Quiet` | The last sign is old; this is information, not a failure. |
| `alive` | `Awake` | The browser is live and recent evidence exists. |

Every state remains written in text. Styling may reinforce rank, but color alone must never
carry meaning.

## Presentation states

The presentation layer is a pure tagged state. A render replaces the whole semantic body
and both actions together, so success from one state cannot survive a later failure.

### Loading

- Title: `Keep Loaded`
- Summary: `Checking kept tabs…`
- Primary action: disabled `Checking…`
- No empty success message and no stale rows

The initial panel markup contains this state before the first runtime fill, even though the
normal inventory is synchronous. This prevents a blank panel if a platform read is delayed
or a future implementation becomes asynchronous.

### Ready

- Shows the total, compact state counts, space groups, and rows.
- The primary action is enabled only when one or more kept tabs are sleeping.
- When every kept tab is awake, the disabled action reads `All kept tabs are awake`.
- When attention is required but no tab is sleeping, the wake action is hidden; a crashed
  tab must never sit beside a false `All kept tabs are awake` claim.
- `Quiet` and `No signal yet` are neutral. They do not enable a recovery action.

Zero-frame WebSocket text is omitted because silence is not a fault. Recent socket activity
may appear as a secondary evidence clause. A missing watcher on an awake tab remains visible
because that is a diagnostic failure.

### Empty

- Title: `Keep Loaded`
- Headline: `Keep a pinned tab awake`
- Guidance: `Add sites in Sine settings, or use Keep loaded in a pinned tab’s menu.`
- The primary wake action is hidden rather than repeating `Nothing to wake`.
- Crash-history reset remains available only if the application owner reports history.

### Busy

- Retains the most recent safe row snapshot.
- The count summary remains stable. The permanent status node announces
  `Waking 1 sleeping tab…` or `Recovering mail.google.com…` when the application owner can
  distinguish the operation.
- Primary action is disabled and reads the short `Waking…` or `Recovering…` label.
- Completion replaces the snapshot with fresh facts exactly once.
- Closing and reopening the panel during work reconstructs the busy state from ownership,
  not from a window-local animation flag.

### Unavailable

- Title: `Keep Loaded`
- Summary: `Status unavailable`
- Explanation: `Keep Loaded couldn’t inspect tabs. Check the Browser Console for details.`
- Primary action: visible, disabled, labelled `Unavailable`
- All previous rows, counts, and success feedback are cleared.

First-render failure and success-to-failure use this same state. A later successful open may
recover normally. A stopped or stale generation cannot repaint it.

### Crash recovery

A crashed row distinguishes these cases in its detail:

- `Recovering · attempt 2 of 3`
- `Recovery limit reached · 3 of 3 attempts used`
- `Automatic recovery is off`
- `Restart Zen to recover this tab`

The secondary action is `Reset crash recovery history`. Its scope is all kept tabs in all
windows for the current Zen process. It does not change the configured limit, cancel queued
or active recovery, reload a tab, or affect a later Zen process. A reset atomically replaces
the owner’s prior attempt ledger; work charged after that point belongs to the new history.
The panel announces `Crash recovery history reset for this Zen session` and refreshes every
current window. No confirmation dialog is needed because the action deletes only a safety
budget and its label names the consequence.

## Status-button setting

Add a live checkbox to Sine settings:

> Show the Keep Loaded status button in Zen’s sidebar

The default is on. Turning it off removes every window view and the application-global
widget, but does not stop tab keeping, waking, crash recovery, or freshness. Turning it on
creates one shared widget and one current view per browser window. The setting must preserve
CustomizableUI placement during ordinary reloads; an explicit off then on may restore the
default sidebar placement.

The runtime owns one replaceable panel resource per window. It registers one terminal
disposer with the generation scope and swaps the current panel lease on preference changes,
rather than accumulating one disposer per toggle. The existing application owner remains
the only authority for first/last widget creation.

## Settings copy and grouping

Sine 2.3.3.0 accepts mod preference types `separator`, `checkbox`, `dropdown`, `text`, and
`string` (`core/preferences.sys.mjs` 9–16 and 118–126). Its installed-mod path passes every
row through that parser (`core/manager.sys.mjs` 358–373), so a product action button in
`preferences.json` would be silently rejected. Use separators and the following order:

1. **General**
   - `Show the Keep Loaded status button in Zen’s sidebar`
   - `Restore other pinned tabs lazily after restarting Zen`
2. **Kept tabs**
   - `Keep pinned tabs whose URL contains (comma-separated)`
3. **Crash recovery**
   - `Recover a crashed tab at most this many times (0 disables recovery)`
   - `Count crashes within this many minutes`
4. **Freshness**
   - `Refresh kept tabs every this many seconds (0 disables freshness)`
   - `Keep each refresh active for this many seconds`
5. **Diagnostics**
   - `Write Keep Loaded details to the Browser Console`

The reset action stays in the panel because Sine has no supported mod-action preference and
because the panel can describe process-wide scope and announce the result immediately.

## Density, theme, and interaction rules

- The footer remains visible while the row body scrolls.
- At 280 CSS pixels there is no horizontal overflow; long titles truncate visually while
  the full URL remains available as a tooltip.
- The body stops growing after the viewport-safe maximum. A fixture with 20 tabs across
  five spaces scrolls without moving the header or footer.
- The normal compact row target is 36–44 CSS pixels, depending on whether secondary detail
  is present. A diagnostic clause must not force an empty second line.
- Secondary evidence uses one line where space permits (`Title changed 12s ago · WebSocket
  activity 3s ago`). Neutral states are plain text; only attention/error states need a
  stronger outlined indicator.
- Use Firefox/Zen semantic panel, text, border, focus, and button tokens with system-color
  fallbacks. Do not introduce a product palette or hard-coded light/dark RGB values.
- Light, dark, `prefers-contrast`, and forced-colors retain readable text and borders.
- State words, disabled attributes, and feedback text remain meaningful without color.
- Footer actions are keyboard reachable and activate with the native command semantics.
- Focus stays in the open panel across refreshes; a render does not replace the focused
  footer node unnecessarily.
- The feedback node exists before updates and uses `role="status"`, `aria-live="polite"`,
  and `aria-atomic="true"`. Errors use text, not motion.
- Reduced-motion users receive no required animation. Any optional transition is cosmetic.

## Objective acceptance matrix

### M16.C02 — explicit failures

- Pure tests cover loading, ready, empty, busy, unavailable, recovery, and stopped states.
- First-open failure renders only unavailable content and a disabled `Unavailable` action.
- A ready-to-failure transition removes all old rows, counts, and action labels.
- A stale completion after reload, stop, or panel replacement changes no current node.
- Closing and reopening after a transient failure can render a later success.

### M16.C03 — controls

- The show-button preference passes off, on, and off transitions in two windows.
- Hidden state has zero widget leases/views while runtime work remains registered and live.
- Reload, native non-last close, and final close preserve the first/last owner invariants.
- Reset clears application-wide history and reports its exact Zen-session scope.
- Reset during queued recovery does not cancel it; its future charge enters the new ledger.
- Reset during active recovery does not cancel or rewind that operation; later crashes start
  from the reset history.
- Repeated hide/show and reset actions are idempotent and leak no disposer, callback, or
  application token.

### M16.C04 — visual refresh

- Exact-Zen screenshots cover light and dark themes at representative 280-, 320-, and
  480-pixel panel widths.
- Fixtures cover empty, healthy, mixed, unavailable, recovery-limit, and 20-tab overflow
  states across multiple spaces.
- Exact production gates separately cover the hidden-button setting, multiple windows,
  native placement, non-last close, reload, and final disable. Panel content does not own
  sidebar-side placement; native `CustomizableUI` anchoring does.
- Rows, state labels, tooltips, stable footer nodes, live feedback, and actions remain
  usable at 200% text scaling. Forced-colors and contrast use explicit system-color and
  semantic-token fallbacks guarded by static regressions.
- First-open rendering performs one panel inventory, introduces no recurring timer or
  observer, and has no blank successful frame.
- Bundle composition and first-open timing are compared with the C01-D parent. A visual
  change does not claim a speed improvement without an exact browser measurement.
- Final approval requires objective matrix success and visual review of representative
  generated screenshots and exact interactions.

## M16.C04 implementation evidence

The implementation keeps the approved native surface and changes only window-local
presentation code, settings copy, and the generated window bundle. No application-owner
contract or protocol changed in C04.

- Pure and platform tests cover vocabulary, concern-first ordering, positive empty copy,
  crash-detail variants, zero-frame omission, busy labels, permanent feedback, whole-state
  error replacement, and stable footer controls.
- The exact chrome-DOM panel probe records one first-open fill, three 41–43-pixel mixed
  rows, same-line state labels, a footer outside the scrolling body, an open-panel wake,
  complete unavailable replacement, and later recovery.
- The C04 visual probe generated and reviewed 72 PNGs: six states (`mixed`, `busy`,
  `recovery-limit`, `empty`, `unavailable`, and 20-tab `overflow`) at 280, 320, and 480 CSS
  pixels, in light and dark schemes, at 100% and 200% text. Representative review confirmed
  readable hierarchy and contrast, compact empty/error wrapping, title truncation without
  horizontal overflow, and a fixed footer over the scrolling 20-tab body.
- The exact staged production window-close gate passes 27/27, including live off/on/off/on
  status-resource replacement, reset feedback, hot reload, native secondary close, a real
  surviving panel fill, later application work, and final drain. The stale-generation gate
  passes 11/11, and the aggregate multi-window/reload/active-disable gate passes 19/19.
- The C01-D and C04 chrome probes were each sampled three times in the same environment.
  Median open-to-`ViewShowing` was 0.281 ms and 0.282 ms respectively; median synchronous
  three-row fixture fill was 0.106 ms and 0.121 ms. These sub-millisecond ranges overlap
  normal harness variation, so C04 makes no speed claim. The more important structural
  invariant remains one first-open inventory and no new recurring panel timer or observer.
- Relative to the C03 parent, the readable UC bundle grows from 93,115 to 97,348 bytes
  (+4,233); the 43,740-byte stable SYS owner is unchanged. Relative to the C01-D decision
  parent, the completed C02–C04 sequence adds 10,267 UC bytes and 1,415 SYS bytes, including
  explicit failure states, live visibility/reset controls, and the refreshed presentation.

The screenshot surface cannot prove native popup shadow pixels or operating-system
forced-color composition because headless Gecko omits the popup compositor layer. It does
exercise the actual native popup before moving the same XUL nodes for capture; exact command,
placement, focus-preserving node ownership, and lifecycle behavior are covered by the panel
and staged production gates. This is an evidence boundary, not an untested custom popup.

## Shared-package decision

Do not extract or consume a new `browser-chrome-ui` primitive for M16.

That package currently owns an anchored, per-window editor under `#mainPopupSet`: HTML
controls, search, dialog focus, popup positioning, and editor body/footer slots. Keep Loaded
uses an application-global `CustomizableUI` view with one stable system-module owner,
per-window XUL views, native subview navigation, and generation-safe first/last leases.
Their common needs are design principles—semantic colors, focus visibility, forced-colors,
and complete teardown—not a cohesive second API consumer. Extracting a generic panel now
would either leak Keep Loaded’s ownership protocol into an editor primitive or erase the
native subview behavior the status panel already gets for free.

Revisit extraction only when a second application-global status/list panel needs the same
CustomizableUI lease, exact-view dispatch, and per-window view lifetime.

## Deliberately out of scope

- Changing which tabs are kept from inside the status panel
- Per-tab crash-history reset
- A general log viewer or WebSocket inspector
- Search, sorting controls, pagination, or virtualization
- Freshness concurrency controls
- Replacing Sine’s settings surface
