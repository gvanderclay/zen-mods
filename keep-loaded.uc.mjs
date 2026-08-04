// Wakes allowlisted pinned tabs after Zen's lazy session restore, and marks them
// non-discardable so the memory-pressure unloader leaves them alone.
// Needs browser.sessionstore.restore_pinned_tabs_on_demand = true (set in user.js).

const { SessionStore } = ChromeUtils.importESModule(
  "resource:///modules/sessionstore/SessionStore.sys.mjs"
);

const PREF_MATCH = "zen.keep-loaded.match";
const PREF_DEBUG = "zen.keep-loaded.debug";
const PREF_ONDEMAND = "browser.sessionstore.restore_pinned_tabs_on_demand";
const DEFAULT_MATCH = "mail.google.com,calendar.google.com,slack.com";
const TAB_FLAG = "zenKeepLoaded";
const WAKE_TIMEOUT_MS = 20000;
const POLL_MS = 100;

// Sine re-imports this module on every mod reload, so state that must survive a
// reload lives on the window rather than in module scope.
const state = (window.zenKeepLoaded ??= { disposers: [] });

const log = (...args) => {
  if (Services.prefs.getBoolPref(PREF_DEBUG, true)) {
    console.log("[keep-loaded]", ...args);
  }
};

const matchers = () =>
  Services.prefs
    .getStringPref(PREF_MATCH, DEFAULT_MATCH)
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

// gBrowser.tabs is space-scoped in Zen — tabs.js builds allTabs from the active
// space's containers only. allStoredTabs walks every space's containers instead.
const allTabs = () => {
  const zen = window.gZenWorkspaces;
  if (!zen?._hasInitializedTabsStrip) {
    log("space containers not built yet — falling back to the active space");
    return [...window.gBrowser.tabs];
  }
  zen._allStoredTabs = null; // drop the memo, it predates our sweep
  return [...zen.allStoredTabs];
};

// Touching tab.linkedBrowser instantiates a lazy browser, so route around it.
const urlFor = tab =>
  (tab.linkedPanel
    ? tab.linkedBrowser?.currentURI?.spec
    : SessionStore.getLazyTabValue(tab, "url")) || "";

const spaceOf = tab =>
  tab.getAttribute("zen-workspace-id")?.replace(/[{}]/g, "").slice(0, 8) || "-";

const isKept = tab => {
  if (SessionStore.getCustomTabValue(tab, TAB_FLAG) === "true") {
    return true;
  }
  const url = urlFor(tab).toLowerCase();
  return url ? matchers().some(m => url.includes(m)) : false;
};

const sleep = ms => new Promise(resolve => window.setTimeout(resolve, ms));

// Inserting a lazy browser makes SessionStore call restoreTab, which queues the
// tab and calls restoreNextTab. That queue refuses to hand out pinned tabs while
// restore_pinned_tabs_on_demand is true, so drop the pref for the duration —
// nothing else is in the queue, since tabs we never insert stay lazy. Restores
// in place: history and scroll survive, and no tab is selected, so no space switch.
const wakeAll = async tabs => {
  Services.prefs.setBoolPref(PREF_ONDEMAND, false);
  state.prefHeld = true;
  try {
    for (const tab of tabs) {
      window.gBrowser._insertBrowser(tab);
    }
    // Only 3 restore concurrently; the queue drains as each one starts, and
    // markTabAsRestoring drops "pending" at that point.
    const deadline = Date.now() + WAKE_TIMEOUT_MS;
    while (
      !state.disposed &&
      tabs.some(t => t.hasAttribute("pending")) &&
      Date.now() < deadline
    ) {
      await sleep(POLL_MS);
    }
  } finally {
    Services.prefs.setBoolPref(PREF_ONDEMAND, true);
    state.prefHeld = false;
  }
};

const sweep = async () => {
  await SessionStore.promiseAllWindowsRestored;
  await window.gZenWorkspaces?.promiseInitialized;

  if (!Services.prefs.getBoolPref(PREF_ONDEMAND, false)) {
    log("restore_pinned_tabs_on_demand is false — pinned tabs load eagerly");
  }

  const pinned = allTabs().filter(tab => tab.pinned);
  const kept = pinned.filter(isKept);
  log(
    `${pinned.length} pinned tab(s) across ${new Set(pinned.map(spaceOf)).size} space(s), ${kept.length} matched`,
    kept.map(tab => `${spaceOf(tab)} ${urlFor(tab)}`)
  );

  for (const tab of kept) {
    tab.undiscardable = true;
  }

  const asleep = kept.filter(tab => tab.hasAttribute("pending"));
  if (!asleep.length) {
    return;
  }

  await wakeAll(asleep);
  const stuck = asleep.filter(tab => tab.hasAttribute("pending"));
  log(
    stuck.length
      ? `${asleep.length - stuck.length}/${asleep.length} woke, still pending: ${stuck.map(urlFor)}`
      : `woke ${asleep.length} tab(s)`
  );
};

// Sine runs this before re-importing the module, so whatever later checkpoints
// register must be undone here or it doubles up on the next reload.
const teardown = () => {
  state.disposed = true;
  for (const dispose of state.disposers) {
    try {
      dispose();
    } catch (err) {
      log("disposer failed", err);
    }
  }
  state.disposers = [];
  if (state.prefHeld) {
    Services.prefs.setBoolPref(PREF_ONDEMAND, true);
    state.prefHeld = false;
  }
  log("unloaded");
};

if (typeof window.addUnloadListener === "function") {
  window.addUnloadListener(teardown);
} else {
  log("Sine did not expose addUnloadListener — reloads will not clean up");
}

state.disposed = false;

if (state.running) {
  log("a sweep is already running — skipping this load");
} else {
  state.running = true;
  try {
    await sweep();
  } finally {
    state.running = false;
  }
}
