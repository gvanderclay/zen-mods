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
2. Install this mod from its repository URL.

That is the whole setup — no `user.js`, no `about:config`. The mod owns
`restore_pinned_tabs_on_demand` from the setting below, and since Zen already
defaults it on, that write usually only confirms what Zen does anyway.

## Settings

Editable from the mod's own settings in Sine. Every row applies without a reload.

| Pref | Default | Meaning |
|---|---|---|
| `zen.keep-loaded.match` | `mail.google.com,calendar.google.com,slack.com` | Comma-separated substrings matched against pinned tab URLs |
| `zen.keep-loaded.lazy-pinned` | `true` | Let Zen restore pinned tabs lazily, which is what gives this mod something to do. Drives `browser.sessionstore.restore_pinned_tabs_on_demand`; Zen reads that while restoring the session, so it applies from the next start |
| `zen.keep-loaded.crash-attempts` | `3` | How many times the mod re-wakes the same crashed tab inside the window below before leaving it alone. `0` turns recovery off and keeps the crash reporting. Anything that is not a count falls back to 3 |
| `zen.keep-loaded.crash-window-minutes` | `60` | How far back that count looks. Three crashes inside this many minutes and the mod stops recovering that tab; three spread wider than it and every one is recovered. Anything that is not a positive number falls back to 60 |
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
Three attempts per tab per window by default, then it says so and leaves the tab
alone, because a tab that crashes on every load is not one more wake away from
working. The window is rolling and defaults to an hour, so a tab that crashes three
times over a day is recovered every time; only a genuine loop exhausts the budget.
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

Zen's own **"unload space"** and **"unload all other spaces"** will unload a kept tab.
That is not a bug in Zen: the `undiscardable` flag the mod sets is only consulted when
Firefox unloads tabs under memory pressure, and an unload you asked for on purpose
skips that check entirely. Both commands do skip tabs marked *essential* in Zen, which
is the only exemption that exists without this mod. So the mod notices the unload and
wakes the tab again, which also covers unloads from extensions or any other mod. If you
want an unload to stick, release the tab first — the tab context menu's keep-loaded
toggle — and it will stay unloaded.

## Development

The mod is written in TypeScript under `src/` and bundled to
`dist/keep-loaded.uc.mjs`, which is **committed** — Sine installs a mod by
downloading the repo, so there is no build step on the way in. Never edit `dist/`
by hand; the pre-commit hook rebuilds it and stages the result.

    npm install     # deps plus the git hooks
    npm run dev     # rebuild dist/ on save
    npm run check   # typecheck, lint, tests, docs, and dist freshness

Sine maps `chrome://sine/content/` to `<profile>/chrome/sine-mods/` (see
`chrome/utils/chrome.manifest`), so a working copy is installed by symlinking this
repo into that directory under the mod's id:

    ln -s ~/workspace/zen-keep-loaded \
      "~/Library/Application Support/zen/Profiles/<profile>/chrome/sine-mods/keep-loaded"

The mod then needs an entry in that directory's `mods.json`, mirroring
`theme.json` plus `enabled: true`, `origin: "local"`, and `no-updates: true`. The
last one matters: Sine's update loop skips mods carrying it, and without it Sine
would try to update this mod from `homepage`.

Sine reads every path from `mods.json` at load time, never from `theme.json`, so
the entry needs all three keys or the corresponding half of the mod is silently
absent: `scripts` (`dist/keep-loaded.uc.mjs`), `preferences`
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

    npm run probe:sockets    # does a parent-process websocket listener see frames?
    npm run probe:overhead   # what does watching them cost the UI thread?
    npm run probe:panel      # does the status button draw, and does its panel fill?

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

## Status

Early. See [PLAN.md](PLAN.md) for the roadmap and [DECISIONS.md](DECISIONS.md) for
why things are built the way they are.
