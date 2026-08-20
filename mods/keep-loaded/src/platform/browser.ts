/** SessionStore wake/reset and tab facts; each claim is cited beside its code. */

import type { WakeCandidateState } from "../application-protocol.ts";
import type { Probe } from "../core/capabilities.ts";
import type { CrashFacts, CrashKind } from "../core/crash.ts";
import type { TabLoadState } from "../core/liveness.ts";
import type { TabFacts } from "../core/policy.ts";
import { resolveUrl, urlFromTabState } from "../core/url.ts";
import { log } from "./log.ts";

const { SessionStore } = ChromeUtils.importESModule<{
  SessionStore: SessionStoreModule;
}>("resource:///modules/sessionstore/SessionStore.sys.mjs");

const TAB_FLAG = "zenKeepLoaded";
const MARKER_ATTR = "zen-keep-loaded";
const closedWakeCandidates = new WeakSet<BrowserTab>();

export const whenSessionRestored = () => SessionStore.promiseAllWindowsRestored;

/** `_hasInitializedTabsStrip` is set before this resolves — see D003. */
export const whenSpacesReady = () => window.gZenWorkspaces?.promiseInitialized;

/**
 * `gBrowser.tabs` is space-scoped in Zen: `tabs.js` builds `allTabs` from the
 * active space's containers only, so a sweep over it silently skips every other
 * space. `allStoredTabs` walks all of them — see D003.
 */
export const pinnedTabs = (): BrowserTab[] => {
  const zen = window.gZenWorkspaces;
  if (!zen?._hasInitializedTabsStrip) {
    log("space containers not built yet — falling back to the active space");
    return [...window.gBrowser.tabs].filter(tab => tab.pinned);
  }
  zen._allStoredTabs = null; // drop the memo, it predates our sweep
  return [...zen.allStoredTabs].filter(tab => tab.pinned);
};

/**
 * Serialises the whole tab, and touching `linkedBrowser` materialises a lazy tab's
 * stub browser — so this is only ever reached through `resolveUrl`'s thunk, i.e.
 * when the tab has no usable url of its own.
 */
const tabStateUrl = (tab: BrowserTab) => urlFromTabState(SessionStore.getTabState(tab));

/**
 * Touching `tab.linkedBrowser` instantiates a lazy browser, so route around it for
 * a tab that has no panel. Either answer can come back as `about:blank` — a
 * crashed tab is parked there deliberately — hence the session fallback (D017).
 */
const urlFor = (tab: BrowserTab) => {
  const live =
    (tab.linkedPanel
      ? tab.linkedBrowser?.currentURI?.spec
      : SessionStore.getLazyTabValue(tab, "url")) || "";
  return resolveUrl(live, () => tabStateUrl(tab));
};

const spaceOf = (tab: BrowserTab) =>
  tab.getAttribute("zen-workspace-id")?.replace(/[{}]/g, "").slice(0, 8) || "-";

/**
 * Zen's own name for the space a tab is in, prefixed with its emoji the way Zen
 * labels its own space menu (`ZenSpaceManager.mjs` 1117-1120 — an icon ending in
 * `.svg` is a picture, not a character, so it is left off). Falls back to the short id
 * `factsFor` reports, so losing this costs readability and nothing else.
 *
 * The attribute holds the same string as `workspace.uuid` — both are
 * `Services.uuid.generateUUID().toString()`, braces included — so it is looked up
 * unmodified rather than through `spaceOf`'s trimmed form.
 */
export const spaceNameFor = (tab: BrowserTab): string => {
  const id = tab.getAttribute("zen-workspace-id");
  // `getWorkspaceFromId` swallows its own failures and returns undefined, so this
  // needs no try of its own — only the optional call, for a Zen that dropped it.
  const space = id ? window.gZenWorkspaces?.getWorkspaceFromId?.(id) : null;
  const name = space?.name?.trim();
  if (!name) {
    return spaceOf(tab);
  }
  const icon = space?.icon;
  return icon && !icon.endsWith(".svg") ? `${icon} ${name}` : name;
};

export const isPending = (tab: BrowserTab) => tab.hasAttribute("pending");

/**
 * Set only by the two methods that display a crash page (`ContentCrashHandlers`
 * 530, 554), and cleared by `reviveCrashedTab` and `maybeExitCrashedState`. Not
 * `SessionStore.isBrowserInCrashedSet`, which throws unless
 * `browser.sessionstore.debug` is set — see D017.
 */
export const isCrashedPage = (tab: BrowserTab) => tab.hasAttribute("crashed");

/** What {@link isLifeSign} needs to judge a label change. */
export const loadStateOf = (tab: BrowserTab): TabLoadState => ({
  pending: isPending(tab),
  crashedPage: isCrashedPage(tab),
});

/** Snapshot of everything the policy layer needs, so it never sees a tab. */
export const factsFor = (tab: BrowserTab, pending = isPending(tab)): TabFacts => ({
  space: spaceOf(tab),
  url: urlFor(tab),
  pending,
  flagged: SessionStore.getCustomTabValue(tab, TAB_FLAG) === "true",
});

/**
 * Persisted with the session, so a tab kept individually survives a restart.
 * `setCustomTabValue` rejects non-strings, hence the explicit `"true"`/`"false"`.
 */
export const setFlag = (tab: BrowserTab, keep: boolean, current?: boolean) => {
  const target = keep ? "true" : "false";
  const present = current ?? SessionStore.getCustomTabValue(tab, TAB_FLAG) === "true";
  if (present !== keep) {
    SessionStore.setCustomTabValue(tab, TAB_FLAG, target);
  }
};

/**
 * The attribute `styles/chrome.css` hangs the badge off. Written for every pinned
 * tab on every sweep, `false` included, so a tab that stops being kept stops
 * claiming it — unlike `undiscardable`, this one is ours alone to clear (D015).
 */
export const setMarker = (tab: BrowserTab, kept: boolean) => {
  if (kept) {
    if (tab.getAttribute(MARKER_ATTR) !== "true") {
      tab.setAttribute(MARKER_ATTR, "true");
    }
  } else if (tab.getAttribute(MARKER_ATTR) !== null) {
    tab.removeAttribute(MARKER_ATTR);
  }
};

/**
 * Read once, when the crash is noticed. Every field is a state the recovery in
 * M04.C02b would have to work from, and reading them later is too late: the tab
 * is revived and rewritten within the same event dispatch — see D017.
 */
export const crashFactsFor = (tab: BrowserTab, kind: CrashKind): CrashFacts => {
  const browser = tab.linkedBrowser;
  return {
    url: urlFor(tab),
    kind,
    pending: isPending(tab),
    remote: browser?.isRemoteBrowser === true,
    connected: browser?.isConnected === true,
    crashedPage: isCrashedPage(tab),
  };
};

/**
 * Consulted only by `TabUnloader`'s memory-pressure weighting. `_mayDiscardBrowser`
 * ignores it, so an explicit unload still takes the tab — see D005.
 */
export const markUndiscardable = (tab: BrowserTab) => {
  if (tab.undiscardable !== true) {
    tab.undiscardable = true;
  }
};

/**
 * Private, and the only clean way to wake a pending tab without selecting it.
 * Makes SessionStore call `restoreTab`, which needs the restore queue un-gated to
 * hand the tab back out — see D002.
 */
export const insertBrowser = (tab: BrowserTab) => {
  window.gBrowser._insertBrowser(tab);
};

/**
 * The application owner needs the browser's actual restore state before it may
 * release the global restore preference. `pending` stays set both before and
 * after `_insertBrowser`; `linkedPanel` distinguishes a still-lazy tab from one
 * inserted into SessionStore's restore queue. Once SessionStore starts the tab,
 * `markTabAsRestoring` removes `pending` (`SessionStore.sys.mjs` 6790-6817).
 */
export const wakeCandidateState = (tab: BrowserTab): WakeCandidateState => {
  // The native unload callback runs while this window's chrome objects are still
  // callable. `window.closed` is already true there, but connected inactive-space
  // tabs can still be present in SessionStore's process-wide restore queue and must
  // be rolled back synchronously before this realm disappears (D042).
  if (tab.isConnected === false || closedWakeCandidates.has(tab)) {
    return "gone";
  }
  if (!isPending(tab)) {
    return "started";
  }
  return tab.linkedPanel ? "inserted-pending" : "lazy";
};

/**
 * Removes only a browser this wake transaction inserted but SessionStore has not
 * started. `discardBrowser(tab, true)` calls `resetBrowserToLazyState`, whose
 * cleanup removes a `TAB_STATE_NEEDS_RESTORE` tab from `TabRestoreQueue`, then
 * destroys the inserted panel and recreates the lazy browser (`tabbrowser.js`
 * 3188-3273; `SessionStore.sys.mjs` 3574-3583, 8150-8178).
 *
 * The observed state is authoritative: a return value cannot prove the queue and
 * panel were cleaned up, while a candidate that concurrently started or closed is
 * already terminal and needs no rollback.
 */
export const rollbackWakeCandidate = (tab: BrowserTab): boolean => {
  if (wakeCandidateState(tab) !== "inserted-pending") {
    return true;
  }
  if (window.closed) {
    // During native close, Zen can detach an inactive workspace tab's progress
    // filters before Firefox's full discard reaches them. The full discard has
    // already called this exact SessionStore reset when it then throws at
    // `tabbrowser.js` 3224. Call the narrower primitive directly: it synchronously
    // removes NEEDS_RESTORE from TabRestoreQueue (SessionStore.sys.mjs 3574-3583,
    // 3667-3683, 8150-8178), while native window destruction owns the panel itself.
    SessionStore.resetBrowserToLazyState(tab);
    closedWakeCandidates.add(tab);
    return true;
  }
  window.gBrowser.discardBrowser(tab, true);
  return wakeCandidateState(tab) !== "inserted-pending";
};

/**
 * Returns a crashed tab to the lazy state the wake path needs, by the same two calls
 * `TabUnloader` uses. Both halves are load-bearing:
 *
 * - the remoteness flip, because `_mayDiscardBrowser` refuses a non-remote browser
 *   and a crash leaves one behind. `updateBrowserRemotenessByURL` predicts the type
 *   from the url it is given, so it gets the resolved one — the browser's own
 *   `currentURI` is `about:blank` and would predict `NOT_REMOTE`, i.e. no flip.
 * - `discardBrowser`, because `resetBrowserToLazyState` alone leaves the browser in
 *   the document. Forced, since an unforced discard defers to `beforeunload` — there
 *   is no content left to ask.
 *
 * `resetBrowserToLazyState` does not touch the `TabStateCache`, so the tab keeps the
 * history it had before the crash and comes back as itself — see D018.
 */
export const resetToLazy = (tab: BrowserTab, url: string): boolean => {
  window.gBrowser.updateBrowserRemotenessByURL(tab.linkedBrowser, url);
  return window.gBrowser.discardBrowser(tab, true);
};

export const sleep = (ms: number) =>
  new Promise(resolve => window.setTimeout(resolve, ms));

/**
 * Presence checks for every private API above. Optional means losing it costs one
 * feature rather than the mod: `allStoredTabs` only narrows the sweep to the active
 * space (D003), and `updateBrowserRemotenessByURL` only costs crash recovery (D018).
 * `discardBrowser` is load-bearing for recoverable wake rollback (D035), as are the
 * remaining required APIs. `allStoredTabs` is probed with `in` rather than by reading,
 * so the getter never runs — it walks every space's containers.
 */
export const browserProbes = (): Probe[] => {
  const zen = window.gZenWorkspaces;
  return [
    {
      name: "SessionStore.promiseAllWindowsRestored",
      present: "promiseAllWindowsRestored" in SessionStore,
      required: true,
    },
    {
      name: "SessionStore.getLazyTabValue",
      present: typeof SessionStore.getLazyTabValue === "function",
      required: true,
    },
    {
      name: "SessionStore.getCustomTabValue",
      present: typeof SessionStore.getCustomTabValue === "function",
      required: true,
    },
    {
      name: "SessionStore.setCustomTabValue",
      present: typeof SessionStore.setCustomTabValue === "function",
      required: true,
    },
    {
      name: "SessionStore.getTabState",
      present: typeof SessionStore.getTabState === "function",
      required: true,
    },
    {
      name: "SessionStore.resetBrowserToLazyState",
      present: typeof SessionStore.resetBrowserToLazyState === "function",
      required: true,
    },
    {
      name: "gBrowser._insertBrowser",
      present: typeof window.gBrowser._insertBrowser === "function",
      required: true,
    },
    {
      name: "gBrowser.updateBrowserRemotenessByURL",
      present: typeof window.gBrowser.updateBrowserRemotenessByURL === "function",
      required: false,
    },
    {
      name: "gBrowser.discardBrowser",
      present: typeof window.gBrowser.discardBrowser === "function",
      required: true,
    },
    {
      // Read off the selected browser because it is the one browser certain to exist.
      // Not required: losing it costs the freshness pulse and nothing else (D027).
      name: "browser.docShellIsActive",
      present:
        !!window.gBrowser.selectedBrowser &&
        "docShellIsActive" in window.gBrowser.selectedBrowser,
      required: false,
    },
    {
      // Not required: losing it costs the title repair and nothing else (D028).
      name: "gBrowser.setTabTitle",
      present: typeof window.gBrowser.setTabTitle === "function",
      required: false,
    },
    {
      name: "gZenWorkspaces.allStoredTabs",
      present: !!zen && "allStoredTabs" in zen,
      required: false,
    },
    {
      name: "gZenWorkspaces.getWorkspaceFromId",
      present: typeof zen?.getWorkspaceFromId === "function",
      required: false,
    },
  ];
};
