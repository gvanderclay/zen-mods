// Generated from src/ by build.mjs — do not edit.

// src/core/match.ts
function parseMatchList(raw) {
  return raw.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
}
function matchesAllowlist(url, matchers) {
  if (!url) {
    return false;
  }
  const haystack = url.toLowerCase();
  return matchers.some((matcher) => haystack.includes(matcher));
}

// src/core/policy.ts
function shouldKeep(facts, matchers) {
  return facts.flagged || matchesAllowlist(facts.url, matchers);
}
function sweepSummary(pinned, kept) {
  const spaces = new Set(pinned.map((facts) => facts.space)).size;
  return {
    message: `${pinned.length} pinned tab(s) across ${spaces} space(s), ${kept.length} matched`,
    kept: kept.map((facts) => `${facts.space} ${facts.url}`)
  };
}
function wakeSummary(total, stuckUrls) {
  if (!stuckUrls.length) {
    return `woke ${total} tab(s)`;
  }
  return `${total - stuckUrls.length}/${total} woke, still pending: ${stuckUrls.join(",")}`;
}

// src/platform/prefs.ts
var PREF_MATCH = "zen.keep-loaded.match";
var PREF_DEBUG = "zen.keep-loaded.debug";
var PREF_ONDEMAND = "browser.sessionstore.restore_pinned_tabs_on_demand";
var DEFAULT_MATCH = "mail.google.com,calendar.google.com,slack.com";
var rawMatchList = () => Services.prefs.getStringPref(PREF_MATCH, DEFAULT_MATCH);
var isDebug = () => Services.prefs.getBoolPref(PREF_DEBUG, true);
var isOnDemand = () => Services.prefs.getBoolPref(PREF_ONDEMAND, false);
var setOnDemand = (value) => Services.prefs.setBoolPref(PREF_ONDEMAND, value);

// src/platform/log.ts
var log = (...args) => {
  if (isDebug()) {
    console.log("[keep-loaded]", ...args);
  }
};

// src/platform/browser.ts
var { SessionStore } = ChromeUtils.importESModule("resource:///modules/sessionstore/SessionStore.sys.mjs");
var TAB_FLAG = "zenKeepLoaded";
var whenSessionRestored = () => SessionStore.promiseAllWindowsRestored;
var whenSpacesReady = () => window.gZenWorkspaces?.promiseInitialized;
var pinnedTabs = () => {
  const zen = window.gZenWorkspaces;
  if (!zen?._hasInitializedTabsStrip) {
    log("space containers not built yet — falling back to the active space");
    return [...window.gBrowser.tabs].filter((tab) => tab.pinned);
  }
  zen._allStoredTabs = null;
  return [...zen.allStoredTabs].filter((tab) => tab.pinned);
};
var urlFor = (tab) => (tab.linkedPanel ? tab.linkedBrowser?.currentURI?.spec : SessionStore.getLazyTabValue(tab, "url")) || "";
var spaceOf = (tab) => tab.getAttribute("zen-workspace-id")?.replace(/[{}]/g, "").slice(0, 8) || "-";
var isPending = (tab) => tab.hasAttribute("pending");
var factsFor = (tab) => ({
  space: spaceOf(tab),
  url: urlFor(tab),
  pending: isPending(tab),
  flagged: SessionStore.getCustomTabValue(tab, TAB_FLAG) === "true"
});
var markUndiscardable = (tab) => {
  tab.undiscardable = true;
};
var insertBrowser = (tab) => {
  window.gBrowser._insertBrowser(tab);
};
var sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

// src/platform/sine.ts
window.zenKeepLoaded ??= { disposers: [] };
var state = window.zenKeepLoaded;
var onUnload = (teardown2) => {
  if (typeof window.addUnloadListener === "function") {
    window.addUnloadListener(teardown2);
  } else {
    log("Sine did not expose addUnloadListener — reloads will not clean up");
  }
};
var runDisposers = () => {
  for (const dispose of state.disposers) {
    try {
      dispose();
    } catch (err) {
      log("disposer failed", err);
    }
  }
  state.disposers = [];
};

// src/main.ts
var WAKE_TIMEOUT_MS = 2e4;
var POLL_MS = 100;
var wakeAll = async (tabs) => {
  setOnDemand(false);
  state.prefHeld = true;
  try {
    for (const tab of tabs) {
      insertBrowser(tab);
    }
    const deadline = Date.now() + WAKE_TIMEOUT_MS;
    while (!state.disposed && tabs.some(isPending) && Date.now() < deadline) {
      await sleep(POLL_MS);
    }
  } finally {
    setOnDemand(true);
    state.prefHeld = false;
  }
};
var sweep = async () => {
  await whenSessionRestored();
  await whenSpacesReady();
  if (!isOnDemand()) {
    log(`${PREF_ONDEMAND} is false — pinned tabs load eagerly`);
  }
  const matchers = parseMatchList(rawMatchList());
  const pinned = pinnedTabs().map((tab) => ({ tab, facts: factsFor(tab) }));
  const kept = pinned.filter(({ facts }) => shouldKeep(facts, matchers));
  const summary = sweepSummary(
    pinned.map(({ facts }) => facts),
    kept.map(({ facts }) => facts)
  );
  log(summary.message, summary.kept);
  for (const { tab } of kept) {
    markUndiscardable(tab);
  }
  const asleep = kept.filter(({ facts }) => facts.pending);
  if (!asleep.length) {
    return;
  }
  await wakeAll(asleep.map(({ tab }) => tab));
  const stuck = asleep.filter(({ tab }) => isPending(tab));
  log(
    wakeSummary(
      asleep.length,
      stuck.map(({ facts }) => facts.url)
    )
  );
};
var teardown = () => {
  state.disposed = true;
  runDisposers();
  if (state.prefHeld) {
    setOnDemand(true);
    state.prefHeld = false;
  }
  log("unloaded");
};
onUnload(teardown);
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
