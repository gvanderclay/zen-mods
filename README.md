# Keep Loaded

A [Sine](https://github.com/sineorg) mod for [Zen Browser](https://zen-browser.app)
that lets pinned tabs restore lazily while keeping a chosen few awake.

Zen restores pinned tabs eagerly by default, so a browser full of pinned tabs
reloads all of them at startup. Turning that off
(`browser.sessionstore.restore_pinned_tabs_on_demand`) fixes the memory cost but
takes everything with it, including the tabs you keep pinned *because* you want
their notifications. Firefox has no per-tab exception: both decision points in
session restore key on `pinned` and nothing else.

This mod adds the exception. After session restore it finds pinned tabs matching
an allowlist, wakes the ones that came back as unloaded shells, and marks them
non-discardable so the memory-pressure unloader skips them.

## Requirements

- Zen Browser with Sine installed
- `browser.sessionstore.restore_pinned_tabs_on_demand` = `true`
- `sine.allow-unsafe-js` = `true` — Sine only runs scripts from mods whose origin
  is the store, so a mod installed from a repo needs this pref

## Settings

| Pref | Default | Meaning |
|---|---|---|
| `zen.keep-loaded.match` | `mail.google.com,calendar.google.com,slack.com` | Comma-separated substrings matched against pinned tab URLs |
| `zen.keep-loaded.debug` | `true` | Log to the Browser Console under `[keep-loaded]` |

A tab can also be kept individually, regardless of the allowlist, via the
`zenKeepLoaded` session-store value.

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

`mods.json` is also where the script path is read from at load time, not
`theme.json` — so its `scripts` key must be `dist/keep-loaded.uc.mjs` to match.

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
