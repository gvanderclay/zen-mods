/**
 * Every privileged browser touch lives here. Each claim below was verified against
 * the extracted `omni.ja` sources; see DECISIONS.md for the reasoning.
 */

import type { Probe } from "../core/capabilities.ts";
import type { TabFacts } from "../core/policy.ts";
import { log } from "./log.ts";

const { SessionStore } = ChromeUtils.importESModule<{
  SessionStore: SessionStoreModule;
}>("resource:///modules/sessionstore/SessionStore.sys.mjs");

const TAB_FLAG = "zenKeepLoaded";

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

/** Touching `tab.linkedBrowser` instantiates a lazy browser, so route around it. */
const urlFor = (tab: BrowserTab) =>
  (tab.linkedPanel
    ? tab.linkedBrowser?.currentURI?.spec
    : SessionStore.getLazyTabValue(tab, "url")) || "";

const spaceOf = (tab: BrowserTab) =>
  tab.getAttribute("zen-workspace-id")?.replace(/[{}]/g, "").slice(0, 8) || "-";

export const isPending = (tab: BrowserTab) => tab.hasAttribute("pending");

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

export const sleep = (ms: number) =>
  new Promise(resolve => window.setTimeout(resolve, ms));

/**
 * Presence checks for every private API above. `allStoredTabs` is optional
 * because losing it only narrows the sweep to the active space (D003); the rest
 * are load-bearing. Probed with `in` rather than by reading, so the getter never
 * runs — it walks every space's containers.
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
      name: "gBrowser._insertBrowser",
      present: typeof window.gBrowser._insertBrowser === "function",
      required: true,
    },
    {
      name: "gZenWorkspaces.allStoredTabs",
      present: !!zen && "allStoredTabs" in zen,
      required: false,
    },
  ];
};
