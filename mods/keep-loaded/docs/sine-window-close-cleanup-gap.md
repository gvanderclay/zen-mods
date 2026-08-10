# Sine browser-window close cleanup gap

Status: confirmed against the exact installed release and independently reproduced in
an ordinary interactive Zen session on August 9, 2026.

This note records a Sine engine defect that Keep Loaded will work around locally in
`M11.C02`. It is not an upstream issue or patch proposal. The evidence is preserved so
the behavior can be diagnosed later without repeating the investigation.

## Summary

Sine stores each mod script's unload callback under its browser-window object, but asks for
that callback only from a `beforeunload` listener. A normal Zen browser-window close
does not emit `beforeunload`; it emits:

```text
domwindowclosed
pagehide persisted=false
unload
```

Consequently, Sine does not invoke the mod callback when a secondary browser window
closes. Its singleton manager continues strongly retaining the closed window and the
callback until a later explicit mod unload can reach that entry or the process exits.

Keep Loaded still needs Sine's callback for hot reload, disable, and removal. Its local
workaround is therefore one synchronous, idempotent stop operation reached by both
Sine and a native, non-capturing, one-shot `window.unload` listener.

## Exact versions and artifacts

The installed browser and engine stamped by the lifecycle harness are:

| Component | Identity |
|---|---|
| Zen | `1.21.12b` |
| Build ID | `20260807120242` |
| Gecko | `153.0.3` |
| Zen source stamp | `6096aaed30dc8da4229a3d6a0b58379726223ae6` |
| Sine engine | `2.3.3.0` |
| Sine tag commit | `1d2879b4d2c69d11a84e447be994431376e6576b` |

The installed files byte-match Sine's official `v2.3.3` release:

| File | SHA-256 |
|---|---|
| `core/manager.sys.mjs` | `645d9ecadd7c89aa04470d2ed4b733d44f9bac35cbbe4ece8bd3ed33082fb7ad` |
| `services/module_loader.mjs` | `e1d4cb5619aace39129b4d1fcb30f3bdcb73606987a136d6f136dc441882c2c7` |
| `utils/dom.mjs` | `99183193bc8fc96dcb004b9f72fc717af06cc16087e61786b862bad693cb2942` |
| `core/preferences.sys.mjs` | `84ca5df008d30fc5cfea73a62ed92cb1d6568332e4b050c58be0a524743e7240` |

The official `engine.zip` SHA-256 is
`c98be8e0234e8c4d5b41dc277bd201a365a2dcc418dcba82d4749d27a64a3d65`.
The defect remains present on Sine `main` commit
`107efff07fb0d21280076287926bcc8fee498028`.

## Source path

The relevant registry is an object of ordinary maps:

```text
script URL -> Map(window -> callback)
```

The manager singleton registers callbacks, triggers explicit hot unload, and sweeps a
window from that registry in
[`manager.sys.mjs`](https://github.com/CosmoCreeper/Sine/blob/1d2879b4d2c69d11a84e447be994431376e6576b/src/core/manager.sys.mjs#L19-L104).
The only automatic callsite for that window sweep is the `beforeunload` handler in
[`Manager.observe()`](https://github.com/CosmoCreeper/Sine/blob/1d2879b4d2c69d11a84e447be994431376e6576b/src/core/manager.sys.mjs#L184-L225).
There is no native `unload`, `pagehide`, or `domwindowclosed` path.

There is a second, source-confirmed coverage gap. Sine's current
[`getProcesses()`](https://github.com/CosmoCreeper/Sine/blob/107efff07fb0d21280076287926bcc8fee498028/src/core/utils.sys.mjs#L110-L139)
adds tab `contentWindow` globals to rebuild targets, while the manager installs its
automatic teardown hook only for `chrome-document-global-created` in
[`Manager.observe()`](https://github.com/CosmoCreeper/Sine/blob/107efff07fb0d21280076287926bcc8fee498028/src/core/manager.sys.mjs#L197-L238).
That content-global path has not been runtime-probed here. Keep Loaded targets only the
browser chrome window, so its local native-window fallback does not depend on it.

The browser's close gate asks each tab's content browser whether it permits closing; it
does not dispatch a chrome-window `beforeunload` event. The exact Firefox base is
visible in
[`browser.js`](https://github.com/mozilla-firefox/firefox/blob/0c39e9282688363f5028d0541c17784f7fa5117c/browser/base/content/browser.js#L3633-L3689).
Firefox then unregisters the top-level window, emits `domwindowclosed`, destroys the
docshell, and dispatches `pagehide` followed by `unload`:

- [`AppWindow::Destroy`](https://github.com/mozilla-firefox/firefox/blob/0c39e9282688363f5028d0541c17784f7fa5117c/xpfe/appshell/AppWindow.cpp#L503-L595)
- [`nsWindowWatcher::RemoveWindow`](https://github.com/mozilla-firefox/firefox/blob/0c39e9282688363f5028d0541c17784f7fa5117c/toolkit/components/windowwatcher/nsWindowWatcher.cpp#L1730-L1760)
- [`nsDocShell::Destroy`](https://github.com/mozilla-firefox/firefox/blob/0c39e9282688363f5028d0541c17784f7fa5117c/docshell/base/nsDocShell.cpp#L4365-L4407)
- [`DocumentViewerImpl::PageHide`](https://github.com/mozilla-firefox/firefox/blob/0c39e9282688363f5028d0541c17784f7fa5117c/layout/base/nsDocumentViewer.cpp#L1237-L1306)

The faulty Sine handler was introduced by
[`508bd87`](https://github.com/CosmoCreeper/Sine/commit/508bd8731d213736a9feacb0fb8d0a789f2433b7),
whose intent was to remove listeners from old windows.

## Reproduction evidence

The repository's exact-product probe is:

```sh
pnpm --filter @zen-mods/keep-loaded test:live-multi-window
```

It launches a temporary, isolated profile with the stamped Zen and Sine files, opens
two browser windows, instruments both before enabling its synthetic lifecycle mod, and
closes the second window through Zen's real `#cmd_closeWindow` command. Raw evidence is
written atomically to
`.benchmarks/live/keep-loaded-lifecycle.smoke.json`. That diagnostic artifact is local
and gitignored; this tracked note preserves the exact version stamp, verdict, and compact
close sequence needed by a clean checkout.

Before the workaround, the close checkpoint deliberately fails three assertions:

- the second generation is not stopped during close before the harness's post-close
  marker;
- its listener and timer remain in the harness ledger;
- its application-carrier registration remains active.

The later exact mod-scoped Sine disable drains both generations. That distinguishes a
missed close signal from a fixture that never registered cleanup.

The current hardened close-gap capture passed 35 of 38 assertions and preserved this
ordered carrier excerpt:

```text
41 close-request
42 domwindowclosed
43 window pagehide
44 window unload
45 document pagehide
46 close-observed
51 window B teardown call, delivered only by the later mod-scoped disable
52 window B terminal stop
```

Exactly the three close-cleanup assertions were red; identity, reload, stale-work,
cross-window ownership, later disable, and final cleanup checks were green.

The same defect was independently reproduced in the user's normal interactive Zen
profile with a uniquely namespaced callback registered directly through Sine. Before
the probe's targeted manual cleanup:

```json
{
  "callbackFired": false,
  "sawBeforeUnload": false,
  "sawPageHide": true,
  "sawUnload": true,
  "sawDomWindowClosed": true
}
```

Calling Sine's explicit trigger afterward delivered that callback. That proves the
registry entry survived the actual window close.

## Impact and why it is quiet

The ordinary `Map` strongly retains its window key and callback value. A callback can
retain its module closure and anything captured from that browser window. Repeatedly
opening and closing secondary windows while another window keeps Zen alive can retain
closed globals and process-wide resources that teardown should have released.

The failure is easy to miss:

- closing the only window normally ends the process and releases everything;
- DOM-owned listeners and timers often die with their document anyway;
- the window closes successfully and Sine emits no error;
- the registry is private;
- functional failures often appear only after a later reload or as duplicate global
  observers, stale callbacks, or increased memory use.

Sine itself is affected. Its locale injection installs a strong preference observer
and removes it only on `beforeunload` in
[`dom.mjs`](https://github.com/CosmoCreeper/Sine/blob/1d2879b4d2c69d11a84e447be994431376e6576b/src/utils/dom.mjs#L114-L141).
Preference-condition observers have the same lifecycle in
[`preferences.sys.mjs`](https://github.com/CosmoCreeper/Sine/blob/1d2879b4d2c69d11a84e447be994431376e6576b/src/core/preferences.sys.mjs#L75-L115).

`supportsUnload: true` does not change any of this. Sine reads that field only to decide
whether to show restart-warning toasts on disable or uninstall. It is a manifest
promise made by a mod, not a loader capability or verification result.

## Keep Loaded workaround contract

The production workaround belongs to `M11.C02`, after this red harness checkpoint. It
must have these properties:

1. One controller instance owns one terminal generation and one idempotent `stop()`.
2. Sine hot unload and native `window.unload` call the same exactly-once stop wrapper.
3. The native listener is non-capturing and `{ once: true }`; it closes over the window
   rather than trusting `event.target`, which Gecko reports as the document here.
4. A Sine-driven stop removes the native listener before replacement code starts.
5. Stop marks the generation inert before touching resources, then drains synchronous
   disposers despite individual failures.
6. Every continuation after an `await` verifies that its immutable generation is still
   current before mutating window or application state.
7. No correctness-critical cleanup is asynchronous. Browser close and observer
   notifications do not await returned promises.
8. `beforeunload` is not used. `pagehide` is diagnostic only because it also represents
   document transitions and back-forward cache activity.

Mozilla uses the same dual-path idea in
[`RFPHelper`](https://github.com/mozilla-firefox/firefox/blob/0c39e9282688363f5028d0541c17784f7fa5117c/toolkit/components/resistfingerprinting/RFPHelper.sys.mjs#L636-L663):
native per-window unload and process-level window observation converge on one repeat-safe
detach operation.

The workaround stops Keep Loaded's own behavior and releases its resources. Its native
close path cannot immediately delete Sine's private retained callback entry. A later
mod-scoped disable or removal can invoke and clear that entry; otherwise it survives
until process exit. The workaround also cannot remove Sine's own leaked
preference observers, which remain an engine issue until Sine fixes their lifecycle or
the process exits.

## Possible later upstream work

No upstream contribution is planned in the current roadmap. If this is revisited, the
minimum browser-window correction is a non-capturing, one-shot native `unload` handler.
A durable engine fix should also:

- remove and prune registry entries before invoking mod code;
- isolate synchronous throws and rejected promises per callback;
- keep close-time cleanup synchronous while using settled results for explicit unload;
- serialize or generation-guard disable and rebuild;
- replace Sine's own other `beforeunload` cleanup sites;
- repair the loader's unreachable trusted `scriptPath` branch in
  [`appendInterfaceToDOM()`](https://github.com/CosmoCreeper/Sine/blob/1d2879b4d2c69d11a84e447be994431376e6576b/src/core/manager.sys.mjs#L80-L97).

That last defect is adjacent but separate: the function tests an uninitialized `script`
variable before assigning the caller URI. As a result, Sine can key a `.uc.mjs` loaded
marker to its module loader rather than the target mod, preventing mod-scoped removal
and adding another path that retains closed windows.
