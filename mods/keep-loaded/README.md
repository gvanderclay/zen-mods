# Keep Loaded

A [Sine](https://github.com/sineorg) mod for [Zen Browser](https://zen-browser.app)
that lets pinned tabs restore lazily while keeping a chosen few awake.

Zen restores pinned tabs lazily, and unlike Firefox it does so by default:
`browser/omni.ja` `defaults/preferences/firefox.js` declares
`browser.sessionstore.restore_pinned_tabs_on_demand` `false` at Firefox's line 517,
then `true` again in Zen's own block, and the later declaration wins.

That keeps startup cheap, but it takes everything with it — including the tabs you
keep pinned *because* you want their notifications. They come back as unloaded
shells that receive nothing until clicked. Firefox has no per-tab exception: both
decision points in session restore key on `pinned` and nothing else.

This mod adds the exception. After session restore it finds pinned tabs matching
an allowlist, wakes the ones that came back as unloaded shells, and marks them
non-discardable so the memory-pressure unloader skips them.

## Requirements

Zen Browser with [Sine](https://github.com/CosmoCreeper/Sine) installed, then:

1. In Sine's settings, tick **Enable installing JS from unofficial sources**.
   Sine runs a mod's scripts only when that is on or the mod came from its store,
   so without it this mod is installed but silently inert.
2. Install the mod from its
   [repository subdirectory](https://github.com/gvanderclay/zen-mods/tree/main/mods/keep-loaded).

That is the whole setup — no `user.js`, no `about:config`. The mod owns
`restore_pinned_tabs_on_demand` from the setting below, and since Zen already
defaults it on, that write usually only confirms what Zen does anyway.

## Settings

Editable from the mod's own settings in Sine. Every row applies without a reload.

| Pref | Default | Meaning |
|---|---|---|
| `zen.keep-loaded.match` | `mail.google.com,calendar.google.com,slack.com` | Comma-separated substrings matched against pinned tab URLs |
| `zen.keep-loaded.lazy-pinned` | `true` | Let Zen restore pinned tabs lazily, which is what gives this mod something to do. Drives `browser.sessionstore.restore_pinned_tabs_on_demand`; Zen reads that while restoring the session, so it applies from the next start |
| `zen.keep-loaded.crash-attempts` | `3` | How many times the mod re-wakes the same crashed tab inside the window below before leaving it alone. The count survives a Sine hot reload during the same Zen process. `0` turns recovery off and keeps the crash reporting. Anything that is not a count falls back to 3 |
| `zen.keep-loaded.crash-window-minutes` | `60` | How far back that count looks. Three crashes inside this many minutes and the mod stops recovering that tab; three spread wider than it and every one is recovered. A full Zen restart starts a fresh owner and budget. Anything that is not a positive number falls back to 60 |
| `zen.keep-loaded.freshen-seconds` | `0` | How often to run a kept tab's page while the tab is unselected, so its title keeps up. `0`, the default, never does. See *Stale titles* below before turning it on |
| `zen.keep-loaded.freshen-hold-seconds` | `5` | How long each of those runs lasts. Clamped to the interval above, so a run can never outlast the next one |
| `zen.keep-loaded.debug` | `true` | Log to the Browser Console under `[keep-loaded]` |

A pinned tab can also be kept individually, regardless of the allowlist:
right-click it and tick **Keep loaded**. The choice is stored with the tab in the
session, so it survives a restart. For a tab the allowlist already covers the item
reads *Keep loaded (allowlist)* and is greyed out, because the per-tab flag can
only add to the allowlist, never subtract from it.

Kept tabs carry a small lock on the favicon corner, drawn in the tab's own text
colour. To restyle it, override
`.tabbrowser-tab[zen-keep-loaded] .tab-icon-stack::after` in your own
`userChrome.css`.

## How it works

Waking a pending tab has exactly one clean primitive, and it is not the obvious
one. `reload()` on a lazy browser is a substitute property that only inserts the
browser and defers the real reload to `SSTabRestoring` — an event that never
fires, because `TabRestoreQueue.shift()` refuses the pinned bucket while
`restore_pinned_tabs_on_demand` is true. Selecting the tab works, but in Zen that
switches spaces.

So the mod drops the pref for the duration of the wake and inserts the browsers,
letting SessionStore restore them itself:

    _insertBrowser -> TabBrowserInserted -> restoreTab -> TabRestoreQueue.add
                   -> restoreNextTab -> restoreTabContent

Then it restores the pref. Session history and scroll position survive, nothing
is selected, and no space switches. Only tabs whose browsers we insert enter the
restore queue, so untouched pinned tabs stay lazy.

Every browser window registers a narrow delegate with one process-scoped Keep Loaded
system module. That owner runs one browser operation at a time, coalesces all sweep
requests under one key, and keeps at most one queued recovery per exact tab. A sweep
visits every currently live window in registration order; repeated requests update the
existing key without jumping ahead of older work. Closing or reloading a window
unregisters its delegate and cancels its recovery keys, while an already-running call
keeps the application slot until its stopped controller settles. The shared restore
preference is read and written only inside this owner, so two windows cannot restore
over one another.

Sine caches the owner module for the lifetime of the Zen process even while it
cache-busts and reloads window scripts. Both bundles therefore carry one explicit owner
protocol. A compatible hot reload re-registers fresh window delegates on the same
owner; an incompatible owner change fails closed with a restart-required error instead
of running new window code against stale process code.

Tabs are enumerated through `gZenWorkspaces.allStoredTabs`, not `gBrowser.tabs` —
Zen scopes the latter to the active space, so a sweep over it silently skips every
other space.

Once a tab is awake, the mod keeps a note of when it last showed a sign of life.
Run `zenKeepLoaded.liveness()` in the Browser Console for one row per kept tab:
`label` means the page changed its own title, so its own JS ran, and only counts while
the tab is loaded — the browser rewrites the label of an unloaded tab, and of a tab
showing a crash page, itself; `awake` only means it had a live browser when a sweep
looked; `discarded` and `crashed` mean it was taken away, and both are acted on.

When a kept tab's content process dies, the mod logs what it found: the tab's real
url — which the crash itself hides, since Firefox parks the crashed browser at
`about:blank` — and the state a recovery would have to work from. A
`restart-required` sign is the one crash no retry can fix: it means Zen was updated
while running, so a new-build content process cannot talk to the old-build parent,
and only restarting Zen brings that tab back.

Then it puts the tab back. Firefox leaves a crashed browser non-remote, which
blocks the unload that would make the tab lazy again, so the mod flips the
remoteness, discards the browser, and takes the wake path above — the tab returns
with the history it had before the crash, in the background, without a crash page.
Three attempts per tab per rolling window by default, then it says so and leaves the
tab alone, because a tab that crashes on every load is not one more wake away from
working. The budget lives in the process-scoped Keep Loaded owner, so a Sine hot
reload does not reset it; a full Zen restart starts a fresh owner. The window is
rolling and defaults to an hour, so a tab that crashes three times over a day is
recovered every time; only a genuine loop exhausts the budget.
Both numbers are settings: narrow the window to give up sooner, widen it to keep
trying for longer, raise or lower the count, or set it to `0` to keep the crash
reporting with no recovery at all. Clicking a
crashed tab before the mod gets to it ends that attempt — Firefox clears the restore
state as it shows you the crash page.

`zenKeepLoaded.sockets()` reports the other half of that picture: how many websockets
each kept tab has open, how many frames have crossed them since the mod attached, and
when the last one arrived. Frames are counted, never read. This is a measurement in
progress — whether a parent-process listener receives them at all is the question
M04.C04a-D exists to answer, so a reading of `no frames seen at all` is a result rather
than a fault.

Sleep is the other way a kept tab goes quiet, and it is not a crash: macOS reclaims
content processes while the machine is asleep, so those tabs come back as unloaded
shells with nothing to notice them. The mod re-sweeps when the machine wakes, when a
network link comes back, and when the browser leaves offline mode — but not while the
network is known to be unusable, because a resume arrives before Wi-Fi has associated
and waking a tab then would restore an error page instead of the site. It waits for
the link instead, which is one of the same signals.

All of that is readable without a console. The mod adds a **Keep Loaded** button to the
bottom of Zen's sidebar, beside Zen's own buttons; clicking it opens a panel listing every
kept tab under its space's own name, with one state word each — `alive`, `quiet`,
`asleep`, `crashed`, or `unseen` — and a line saying what the mod last saw the tab do and
what its websockets have been up to. Hovering a row shows the full url. It is an ordinary
toolbar button, so *Customize* can move it to another toolbar or take it off entirely.

`quiet` means only that nothing has been seen from the tab for a while. Nothing acts on
it: a tab that has not changed its title in fifteen minutes is usually just a tab nobody
has emailed (D023).

At the bottom of the panel is one action, labelled with what it would do — `Wake 2
sleeping tabs`, or `All kept tabs are awake` when there is nothing to do. It runs the same
sweep the mod runs on startup and on resume, so it can do nothing the mod would not do by
itself, and the panel stays open and refreshes while it works (D024).

### Stale titles

A kept tab can show a title that is minutes out of date. There are two separate reasons
for that, and they need separate fixes: the page stops producing new titles, and the tab
refuses to display them.

**The tab refuses.** Zen will not let a tab change its own label unless the tab carries
`_zenContentsVisible`, and its restore path hands that flag to every tab *except* pinned
ones. So a pinned tab that came back with the session cannot update its own title at all:
not when its page retitles, not when you focus it, not when you reload it. Clicking the
tab, or leaving the space and returning, grants the flag — which is why a click appears to
fix it and a hard refresh does not. This mod listens for the same `pagetitlechanged` event
`tabbrowser.js` answers, and re-applies the label immediately after Zen has refused it,
using the local escape hatch (`_zenChangeLabelFlag`) Zen's own code uses for this. Tabs
you renamed are left alone, as are tabs Zen is already keeping up to date. This needs no
setting and costs nothing when no title changes.

**The page stops.** An unselected tab's browser is marked inactive, which suspends
`requestAnimationFrame`, clamps its timers to one a second, and — the part that matters —
reports `document.visibilityState` as `hidden`. Gmail and the rest defer refreshing while
hidden, so they stop retitling themselves, and nothing outside the page can change that
decision. Fixing the label above does not help a page that has nothing new to say.

What can be changed is what the page is told. `zen.keep-loaded.freshen-seconds` runs each
kept tab's page briefly on an interval — the tab stays unselected, stays where it is, and
its page believes it is visible for the length of the hold. Measured in the harness
against a page shaped like Gmail: frozen when left alone, 3.86 retitles a second while
held, zero between holds.

It is off by default because it is not free. A tab whose page is running paints at
something like the display's refresh rate for as long as the hold lasts, so `5` seconds
every `120` is about four percent of the cost of leaving the tab awake in the foreground,
and `5` every `10` is half of it. Start at the long end.

Three things the pulse will not do, each of them deliberate. It never activates a tab
something else already activated — the selected tab, a split view, picture-in-picture —
because it would then be the thing that deactivated them later. It never deactivates a
tab that has become selected while it was held; it drops its claim instead. And it hands
every docshell back when the setting goes to `0` or the mod unloads.

Freshness scheduling is application-wide even though the tabs belong to individual
browser windows. One serial pulse operation walks the currently kept tabs one at a time,
so only one mod-owned docshell is active at once. A slow pass gets at most one trailing
cycle at its next fair opportunity; it does not replay every missed interval or overlap a
second pass. The same pass produces the summary, and turning the setting off or closing a
window cancels the active hold before any later tab is considered.

Zen's own **"unload space"** and **"unload all other spaces"** will unload a kept tab.
That is not a bug in Zen: the `undiscardable` flag the mod sets is only consulted when
Firefox unloads tabs under memory pressure, and an unload you asked for on purpose
skips that check entirely. Both commands do skip tabs marked *essential* in Zen, which
is the only exemption that exists without this mod. So the mod notices the unload and
queues reconciliation, which also covers unloads from extensions or any other mod. The
one exception is the synchronous discard performed by this mod's current crash
recovery: that exact tab/token owns the discard, so it is not mistaken for an external
unload. If you want an unload to stick, release the tab first — the tab context menu's
keep-loaded toggle — and it will stay unloaded.

## Development

The mod is written in TypeScript under `mods/keep-loaded/src/` and bundled to two
**committed** scripts: per-window `dist/keep-loaded.uc.mjs` and process-scoped
`dist/keep-loaded.sys.mjs`. Sine installs a mod by downloading the repository, so
there is no build step on the way in. Never edit `dist/` by hand. Run commands from
the repository root:

    pnpm install     # deps plus the git hooks
    pnpm --filter @zen-mods/keep-loaded dev
    pnpm run check   # typecheck, lint, tests, docs, and dist freshness

Sine maps `chrome://sine/content/` to `<profile>/chrome/sine-mods/` (see
`chrome/utils/chrome.manifest`). Quit Zen, then use the repository installer to build,
link, and register the working copy under the mod's id:

    pnpm run install:local keep-loaded

Pass `--profile <path>` if default-profile discovery is not the profile you want. The
installer adds an entry in that directory's `mods.json`, mirroring
`theme.json` plus `enabled: true`, `origin: "local"`, and `no-updates: true`. The
last one matters: Sine's update loop skips mods carrying it, and without it Sine would
try to update this mod from `homepage`. It makes a timestamped database backup before
the atomic replacement.

Sine reads every path from `mods.json` at load time, never from `theme.json`, so
the entry needs all three keys or the corresponding half of the mod is silently
absent: `scripts` (both `dist/keep-loaded.sys.mjs` and
`dist/keep-loaded.uc.mjs`), `preferences`
(`preferences.json`) for the settings rows, and `style`
(`{ "chrome": "styles/chrome.css" }`) for the kept-tab badge. On a real install
Sine fills them in by scanning the downloaded archive.

Editing `mods.json` while Zen is running is racy — Sine rewrites the file when a
mod is installed, toggled, or updated, which drops hand-added entries. Edit it
with Zen closed, or re-add the entry afterwards.

Do not uninstall the mod from Sine's UI while it is symlinked. `removeMod` calls
`IOUtils.remove(modFolder, { recursive: true })` on the symlink path. Gecko's file
implementation is expected to unlink the symlink rather than follow it, but that
was not verified here, and the downside is deleting the working tree. Disable the
mod instead.

### Answering chrome-API questions without a browser session

Some questions can only be settled by running privileged code — the service behind
them is C++, so no amount of reading `omni.ja` answers them. `tools/harness/`
drives a throwaway Zen over Marionette so those get measured instead of read back
from the Browser Console by hand:

    pnpm --filter @zen-mods/keep-loaded probe:sockets
    pnpm --filter @zen-mods/keep-loaded probe:overhead
    pnpm --filter @zen-mods/keep-loaded probe:panel
    pnpm --filter @zen-mods/keep-loaded probe:mail
    pnpm --filter @zen-mods/keep-loaded probe:title
    pnpm --filter @zen-mods/keep-loaded probe:freshness
    pnpm --filter @zen-mods/keep-loaded probe:pulse
    pnpm --filter @zen-mods/keep-loaded probe:label
    pnpm --filter @zen-mods/keep-loaded probe:relabel
    pnpm --filter @zen-mods/keep-loaded probe:wiring
    pnpm --filter @zen-mods/keep-loaded test:live-production-window-close
    pnpm --filter @zen-mods/keep-loaded test:live-production-widget-ownership
    pnpm --filter @zen-mods/keep-loaded test:live-production-widget-creator-close
    pnpm --filter @zen-mods/keep-loaded test:live-production-widget-stale-generation
    pnpm --filter @zen-mods/keep-loaded test:live-production-wake-transaction
    pnpm --filter @zen-mods/keep-loaded test:live-production-crash-reload

`probe:relabel` and `probe:wiring` load both generated bundles rather than
reimplementing them. They stage `dist/keep-loaded.sys.mjs` under a temporary resource
substitution, redirect only the window bundle's fixed application-owner URI to that
exact file, then wrap `dist/keep-loaded.uc.mjs` in an async IIFE for its top-level
`await` and hand it to `Services.scriptloader.loadSubScript`. That runs the window
entry in the chrome window's own global—the same scope Sine gives it, `window` and all.
The wiring probe then drives real tabs, prefs, and lifecycle events, so its resource
claims are measurements of the shipped mod rather than a reimplementation.

The `probe:wiring` run also performs the M13.C01 resource-release gate against that
bundle: while a real pulse is active it selects the tab, unpins it, and closes it in
separate phases. Each phase checks the iterable owned-claim count, the actual
`nsIWebSocketEventService` listener, and the application owner's queued-key snapshot;
selection leaves a user-owned docshell alone, while unpin/close release the mod-owned
docshell and all per-tab resources. A failed phase exits nonzero.

The deterministic M13.C02 scheduler and application-owner tests add the cross-window
serial proof: one pulse key, one active operation, one trailing cycle under overload, and
one active tab at a time. `probe:wiring` is the exact shipped-bundle behavior gate for
settings-off, selection, unpin, close, and teardown. The production wake, close, and
crash-reload gates remain separate because they exercise SessionStore and lifecycle
transactions rather than freshness timing. The unchanged pulse-summary benchmark is
used only as a no-regression diagnostic; this checkpoint makes no speed claim.

The same trick works for the chrome DOM. `probe:panel` rebuilds the status button and
its panelview in the throwaway browser and reports what the DOM did with them — the
computed icon, whether the toolbar draws the label at all, whether the fill callback
ran. That is how both of the panel's first-attempt bugs were found: a callback that
throws inside a panel is swallowed silently, so "empty panel" and "panel threw" look
identical from the outside (D022).

It launches Zen headless with `--no-remote` and a temporary profile — both
load-bearing, since without them it would drive the browser you are working in —
and deletes the profile afterwards. The probe serves its own websocket and uses
the page's title as a control, so a silent listener is reported as inconclusive
rather than as a negative result. If node is killed mid-run the browser outlives
it; `pgrep -f zen-harness` finds the orphan.

### Exact multi-window lifecycle harness

The lifecycle gate is explicit and is not part of the normal `check` command:

    pnpm --filter @zen-mods/keep-loaded test:live-multi-window

It verifies stamped Zen artifacts and the complete installed Sine JS/utils trees against
`tools/harness/platform-stamp.json`, then copies only that Sine installation and a
synthetic lifecycle mod into a temporary `--no-remote` profile. It never stages
Keep Loaded's production source or bundle. The probe opens two browser windows,
uses Sine's real enable, rebuild, and disable paths plus Zen's exact close-window
command, and retains the per-window listener/timer callbacks so canceled work can
be delivered after teardown. The required assertion list is exact and
duplicate-free; a fatal error, missing or extra assertion, non-boolean verdict,
stale mutation, crossed window owner, or per-owner leak makes the command fail
closed.

Raw evidence is written atomically to
`.benchmarks/live/keep-loaded-lifecycle.smoke.json`. It includes the platform
stamp, fixture hashes, carrier sequence, per-window resource records, and the
forced-callback deliveries. Fatal and timeout paths also sweep the unique profile
argument and verify that no matching Zen process remains before deleting the
profile.

The shared fixture carrier is loaded with `ChromeUtils.importESModule`. A static
`.sys.mjs` import from a non-system `.uc.mjs` belongs to the caller window's module
map and is not an application-wide carrier. A forced-identical-`Date.now` control
on both windows still produces distinct window owners, generations, and scalar
module tokens, so the early cache-busting-collision hypothesis is refuted; the
canonical artifact retains that control and a summary of the original diagnostic.
Sine does not unload background modules, so production use of this pattern still
needs an explicit version handshake, owner unregister, and last-owner drain.

The initial stamped Zen 1.21.12b / Sine 2.3.3.0 close checkpoint was deliberately
red. The exact `cmd_closeWindow` command removes the second window and emits
`domwindowclosed`, followed by `pagehide` and `unload`, but emits no `beforeunload`.
Sine 2.3.3.0 registers its per-window cleanup only on `beforeunload`, so the original
fixture generation and its listener/timer remained until the later mod-scoped
disable. The fixture now owns a one-shot native `unload` fallback that reaches the
same idempotent terminal stop as Sine's callback. The gate requires that fallback to
stop exactly once and drain the closed window before close completion, while the
production gate below proves the shipped controller uses the same boundary. The exact
source path, interactive reproduction, impact, and local workaround boundary are preserved in
[`docs/sine-window-close-cleanup-gap.md`](docs/sine-window-close-cleanup-gap.md).

### Production window-close gate

The production close gate is also explicit and outside the normal `check` command:

    pnpm --filter @zen-mods/keep-loaded test:live-production-window-close

It builds both committed production entry points, copies only the real manifest's
bundles, preferences, and chrome stylesheet into the stamped throwaway Zen/Sine profile,
and lets Sine enable that mod in two real browser windows. One eligible pending fixture
per window makes the serialization check non-vacuous: while the first insert is held,
the other must not start, repeated observer triggers must remain one semantic sweep key,
and both windows must eventually run without preference drift. The probe then hot
reloads both generations on the same system-module owner, closes the secondary window
through Zen's exact `#cmd_closeWindow` command, and verifies that native `unload`
unregisters and drains that production controller while primary work and UI stay live.
Finally, Sine disable must leave the owner with no registrations, keys, trailing work,
or active drain.

Raw evidence, including the exact platform stamp and both staged bundle/manifest hashes, is
written to `.benchmarks/live/keep-loaded-production-window-close.smoke.json`.

### Production status-widget ownership gates

M14.C01 keeps the `CustomizableUI` widget application-global while every browser window
owns only its own panel view and command callback. The stable system-module owner grants
one lease per live window: the first lease creates the widget, closing any non-last
window removes only that window's view, and the last lease destroys the widget. A direct
registration test covers creator-first and survivor-first release orders; the exact
production gates cover the shipped bundles and real Zen close/disable paths:

    pnpm --filter @zen-mods/keep-loaded test:live-production-widget-ownership
    pnpm --filter @zen-mods/keep-loaded test:live-production-widget-creator-close
    pnpm --filter @zen-mods/keep-loaded test:live-production-widget-stale-generation

The first gate opens three real windows, verifies one widget identity, closes two
secondary windows in sequence, checks that the remaining creator still fills its own
panel, and confirms disable drains the final lease. The creator-close gate uses
Marionette window switching so the actual widget-creating window can close while its
survivor remains the execution context; it verifies the widget identity and survivor
panel before disabling. The stale-generation gate retains the real G1
`CustomizableUI` view callback, public facade fill, runtime panel disposer, and a
settled panel-wake completion; it hot-reloads Sine to G2, then releases each retained
path individually. Every release must preserve the exact G2 facade/controller/widget/
view identity, the one current widget lease and owner snapshot, and a mutation-free G2
panel; a final real G2 widget command must still fill the panel. All three gates retain
stamped platform, bundle hashes, owner snapshots, and exact assertion manifests under
`.benchmarks/live/`. The stale-generation evidence is
`.benchmarks/live/keep-loaded-production-widget-stale-generation.smoke.json`.

### Production wake-transaction gate

The recoverable-wake gate is explicit and outside the normal `check` command:

    pnpm --filter @zen-mods/keep-loaded test:live-production-wake-transaction

It builds and stages both production bundles in the stamped throwaway Zen/Sine
profile, then creates four genuine remote lazy pinned tabs against a loopback HTTP
fixture. Three restores occupy Firefox's exact SessionStore limit while the fourth
remains inserted and pending beyond the production 20-second deadline. The gate
requires Keep Loaded to return that fourth tab to a genuine lazy state before any
preference release, retain the preference continuously across one bounded retry,
and preserve its SessionStore data.

While the retry is pending, the probe changes the lazy-pinned setting and hot reloads
the real mod. It then proves the old generation rolls back, the replacement keeps the
same process owner with a new registration, releasing one real restore slot starts the
fourth tab, the latest desired preference wins, and a later fast wake still completes.
The production window-close gate remains the complementary proof for native secondary
window destruction.

Raw evidence, including every pref/tab/server event, the exact platform stamp, and
both staged bundle hashes, is written to
`.benchmarks/live/keep-loaded-production-wake-transaction.smoke.json`.

### Production crash-reload gate

The crash-state gate is explicit and outside the normal `check` command:

    pnpm --filter @zen-mods/keep-loaded test:live-production-crash-reload

It stages the real system and window bundles, drives a stamped Zen/Sine window through
the production `oop-browser-crashed` liveness event, hot-reloads the window generation,
and checks that the process owner retains the same rolling budget. It covers exhaustion,
window aging, closed-tab invalidation, external unload reconciliation, and owner drain
on disable. The trigger is a synthetic crash event delivered through the real production
observer; it is not a content-process kill. The deterministic/runtime tests remain the
authoritative proof of the actual reset-and-wake mutation, while this exact gate proves
that the event evidence, stable owner, budget, and unload boundaries survive a Sine reload.

Raw evidence, including the stamped platform, both staged bundle hashes, owner snapshots,
tab events, and the synthetic-trigger disclosure, is written to
`.benchmarks/live/keep-loaded-production-crash-reload.smoke.json`.

## Status

Early, and used daily by its author. The roadmap and the decision ledger behind the
`D0##` citations in the source are kept out of this repository; every claim they hold
about Firefox or Zen internals is repeated in the comment that depends on it.
