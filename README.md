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
`label` means the page changed its own title, so its own JS ran; `awake` only means
it had a live browser when a sweep looked; `discarded` and `crashed` mean it was
taken away. Nothing acts on any of that yet.

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

## Status

Early. See [PLAN.md](PLAN.md) for the roadmap and [DECISIONS.md](DECISIONS.md) for
why things are built the way they are.
