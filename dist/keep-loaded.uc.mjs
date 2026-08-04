// Generated from src/ by build.mjs — do not edit.

// src/core/match.ts
function parseMatchList(raw) {
  return raw.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}
function matchesAllowlist(url, matchers2) {
  if (!url) {
    return false;
  }
  const haystack = url.toLowerCase();
  return matchers2.some((matcher) => haystack.includes(matcher));
}

// src/main.ts
var { SessionStore } = ChromeUtils.importESModule("resource:///modules/sessionstore/SessionStore.sys.mjs");
var PREF_MATCH = "zen.keep-loaded.match";
var PREF_DEBUG = "zen.keep-loaded.debug";
var PREF_ONDEMAND = "browser.sessionstore.restore_pinned_tabs_on_demand";
var DEFAULT_MATCH = "mail.google.com,calendar.google.com,slack.com";
var TAB_FLAG = "zenKeepLoaded";
var WAKE_TIMEOUT_MS = 2e4;
var POLL_MS = 100;
window.zenKeepLoaded ??= { disposers: [] };
var state = window.zenKeepLoaded;
var log = (...args) => {
  if (Services.prefs.getBoolPref(PREF_DEBUG, true)) {
    console.log("[keep-loaded]", ...args);
  }
};
var matchers = () => parseMatchList(Services.prefs.getStringPref(PREF_MATCH, DEFAULT_MATCH));
var allTabs = () => {
  const zen = window.gZenWorkspaces;
  if (!zen?._hasInitializedTabsStrip) {
    log("space containers not built yet — falling back to the active space");
    return [...window.gBrowser.tabs];
  }
  zen._allStoredTabs = null;
  return [...zen.allStoredTabs];
};
var urlFor = (tab) => (tab.linkedPanel ? tab.linkedBrowser?.currentURI?.spec : SessionStore.getLazyTabValue(tab, "url")) || "";
var spaceOf = (tab) => tab.getAttribute("zen-workspace-id")?.replace(/[{}]/g, "").slice(0, 8) || "-";
var isKept = (tab) => {
  if (SessionStore.getCustomTabValue(tab, TAB_FLAG) === "true") {
    return true;
  }
  return matchesAllowlist(urlFor(tab), matchers());
};
var sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
var wakeAll = async (tabs) => {
  Services.prefs.setBoolPref(PREF_ONDEMAND, false);
  state.prefHeld = true;
  try {
    for (const tab of tabs) {
      window.gBrowser._insertBrowser(tab);
    }
    const deadline = Date.now() + WAKE_TIMEOUT_MS;
    while (!state.disposed && tabs.some((t) => t.hasAttribute("pending")) && Date.now() < deadline) {
      await sleep(POLL_MS);
    }
  } finally {
    Services.prefs.setBoolPref(PREF_ONDEMAND, true);
    state.prefHeld = false;
  }
};
var sweep = async () => {
  await SessionStore.promiseAllWindowsRestored;
  await window.gZenWorkspaces?.promiseInitialized;
  if (!Services.prefs.getBoolPref(PREF_ONDEMAND, false)) {
    log("restore_pinned_tabs_on_demand is false — pinned tabs load eagerly");
  }
  const pinned = allTabs().filter((tab) => tab.pinned);
  const kept = pinned.filter(isKept);
  log(
    `${pinned.length} pinned tab(s) across ${new Set(pinned.map(spaceOf)).size} space(s), ${kept.length} matched`,
    kept.map((tab) => `${spaceOf(tab)} ${urlFor(tab)}`)
  );
  for (const tab of kept) {
    tab.undiscardable = true;
  }
  const asleep = kept.filter((tab) => tab.hasAttribute("pending"));
  if (!asleep.length) {
    return;
  }
  await wakeAll(asleep);
  const stuck = asleep.filter((tab) => tab.hasAttribute("pending"));
  log(
    stuck.length ? `${asleep.length - stuck.length}/${asleep.length} woke, still pending: ${stuck.map(urlFor)}` : `woke ${asleep.length} tab(s)`
  );
};
var teardown = () => {
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
