/**
 * Every privileged browser touch lives here. Each claim below was verified against
 * the extracted `omni.ja` sources, and the reasoning lives in the comment beside it.
 */

import type { WakeCandidateState } from "../application-coordinator.ts";
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
const TITLE_EVENT = "pagetitlechanged";

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
export const factsFor = (tab: BrowserTab): TabFacts => ({
  space: spaceOf(tab),
  url: urlFor(tab),
  pending: isPending(tab),
  flagged: SessionStore.getCustomTabValue(tab, TAB_FLAG) === "true",
});

/**
 * Persisted with the session, so a tab kept individually survives a restart.
 * `setCustomTabValue` rejects non-strings, hence the explicit `"true"`/`"false"`.
 */
export const setFlag = (tab: BrowserTab, keep: boolean) => {
  SessionStore.setCustomTabValue(tab, TAB_FLAG, keep ? "true" : "false");
};

/**
 * The attribute `styles/chrome.css` hangs the badge off. Written for every pinned
 * tab on every sweep, `false` included, so a tab that stops being kept stops
 * claiming it — unlike `undiscardable`, this one is ours alone to clear (D015).
 */
export const setMarker = (tab: BrowserTab, kept: boolean) => {
  if (kept) {
    tab.setAttribute(MARKER_ATTR, "true");
  } else {
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
  tab.undiscardable = true;
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
  if (window.closed || tab.isConnected === false) {
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

/**
 * Whether the tab's page is running. `linkedPanel` first, as everywhere else: touching
 * `linkedBrowser` on a lazy tab instantiates the browser. A missing property reads as
 * inactive, which makes the pulse decide `activate` and `setDocShellActive` report the
 * failure once — better than a silent `true` that would never pulse at all.
 */
export const isDocShellActive = (tab: BrowserTab): boolean => {
  if (!tab.linkedPanel) {
    return false;
  }
  try {
    return tab.linkedBrowser?.docShellIsActive === true;
  } catch {
    // A discarded or half-torn-down browser can throw here. Not an error worth
    // reporting: the tick asks this of every kept tab, once a second.
    return false;
  }
};

/**
 * Runs, or stops running, a tab's page without selecting it. The setter reaches
 * `nsIDocShell::SetIsActive` through `browsingContext.isActive`, which is what resumes
 * `requestAnimationFrame`, unclamps timers and flips `visibilityState` — see D026.
 *
 * Only ever called for a tab this mod activated itself, or is about to: the docshell of
 * the selected tab, of a split view, of picture-in-picture and of print preview all
 * belong to somebody else (`shouldActivateDocShell`, `tabbrowser.js` 8307), and the
 * decision to leave those alone is `core/freshness.ts`.
 */
export const setDocShellActive = (tab: BrowserTab, active: boolean): boolean => {
  const browser = tab.linkedPanel ? tab.linkedBrowser : null;
  if (!browser || !("docShellIsActive" in browser)) {
    return false;
  }
  try {
    browser.docShellIsActive = active;
    return true;
  } catch (error) {
    console.error("[keep-loaded] could not change a tab's docshell activity", error);
    return false;
  }
};

/** What the page calls itself, or `""` when there is no browser to ask (D028). */
export const pageTitle = (tab: BrowserTab): string => {
  if (!tab.linkedPanel) {
    return "";
  }
  try {
    return tab.linkedBrowser?.contentTitle ?? "";
  } catch {
    return "";
  }
};

/** What the tab strip is showing right now. */
export const tabLabel = (tab: BrowserTab): string => tab.getAttribute("label") ?? "";

/**
 * Whether the user renamed this tab. The same test `_setTabLabel` makes before letting
 * `zenStaticLabel` win over the page's title (`tabbrowser.js` 2426), empty string
 * included — an empty static label does not override, so it is not a rename.
 */
export const isRenamed = (tab: BrowserTab): boolean =>
  typeof tab.zenStaticLabel === "string" && tab.zenStaticLabel !== "";

/** Whether Zen is already letting this tab write its own label (D028). */
export const isLabelManaged = (tab: BrowserTab): boolean =>
  tab._zenContentsVisible === true;

/**
 * Puts the page's own title into the tab's label, and reports whether the label actually
 * changed — `_setTabLabel` returns false both when it refuses and when the label it was
 * given is the one already there (`tabbrowser.js` 2459).
 *
 * `_zenChangeLabelFlag` is the local escape hatch Zen's own code uses for exactly this
 * (`ZenUIManager` 1617, `SessionStore` 5208), and unlike `_zenContentsVisible` it means
 * nothing to the window-sync bookkeeping: that flag records which *window* holds a tab's
 * contents, and 1090, 1143 and 1162 delete it to hand a docshell over, so a mod that set
 * it would be lying about where the page lives. Deleted in a `finally`, so a tab is left
 * exactly as it was found however `setTabTitle` turns out.
 */
export const writeLabelFromPage = (tab: BrowserTab): boolean => {
  if (typeof window.gBrowser.setTabTitle !== "function") {
    return false;
  }
  tab._zenChangeLabelFlag = true;
  try {
    return window.gBrowser.setTabTitle(tab) === true;
  } catch (error) {
    console.error("[keep-loaded] could not update a tab's title", error);
    return false;
  } finally {
    delete tab._zenChangeLabelFlag;
  }
};

/**
 * Calls back whenever a tab's page changes its title. `pagetitlechanged` is the event
 * `tabbrowser.js` 8980 answers by calling `setTabTitle` itself, so a listener added here
 * runs immediately after the refusal it exists to undo — same target (`addEventListener`
 * forwards to `tabpanels`, 548), registered later, therefore second.
 *
 * Returns the disposer: Sine re-imports this module on every mod toggle, and a listener
 * left behind would relabel twice for one title change (D006).
 */
export const observeTitleChanges = (onChanged: (tab: BrowserTab) => void) => {
  const handler = (event: { target?: object }) => {
    const browser = event.target;
    if (!browser) {
      return;
    }
    const tab = window.gBrowser.getTabForBrowser(browser);
    if (tab) {
      onChanged(tab);
    }
  };
  window.gBrowser.addEventListener(TITLE_EVENT, handler);
  return () => window.gBrowser.removeEventListener(TITLE_EVENT, handler);
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
