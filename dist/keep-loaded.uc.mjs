// Generated from src/ by build.mjs — do not edit.

// src/core/capabilities.ts
function reportCapabilities(probes) {
  const missing = (required) => probes.filter((p) => p.required === required && !p.present).map((p) => p.name);
  const missingRequired = missing(true);
  const missingOptional = missing(false);
  let message = "";
  if (missingRequired.length) {
    message = `Zen no longer provides ${missingRequired.join(", ")} — not sweeping. This mod depends on private APIs; see DECISIONS.md.`;
  } else if (missingOptional.length) {
    message = `running degraded, ${missingOptional.join(", ")} is missing`;
  }
  return {
    ok: !missingRequired.length,
    missingRequired,
    missingOptional,
    message
  };
}

// src/core/lazy.ts
function planLazyPinned(intent, current) {
  if (intent === current) {
    return { set: null, message: "" };
  }
  return {
    set: intent,
    message: intent ? "pinned tabs will load lazily from the next start" : "setting is off — pinned tabs will load eagerly from the next start"
  };
}

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
function keepMenuState(facts, matchers) {
  if (matchesAllowlist(facts.url, matchers)) {
    return { checked: true, disabled: true, label: "Keep loaded (allowlist)" };
  }
  return { checked: facts.flagged, disabled: false, label: "Keep loaded" };
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

// src/core/defaults.ts
var DEFAULT_MATCH = "mail.google.com,calendar.google.com,slack.com";
var DEFAULT_DEBUG = true;
var DEFAULT_LAZY_PINNED = true;

// src/platform/prefs.ts
var PREF_MATCH = "zen.keep-loaded.match";
var PREF_DEBUG = "zen.keep-loaded.debug";
var PREF_LAZY_PINNED = "zen.keep-loaded.lazy-pinned";
var PREF_ONDEMAND = "browser.sessionstore.restore_pinned_tabs_on_demand";
var rawMatchList = () => Services.prefs.getStringPref(PREF_MATCH, DEFAULT_MATCH);
var isDebug = () => Services.prefs.getBoolPref(PREF_DEBUG, DEFAULT_DEBUG);
var isLazyPinnedWanted = () => Services.prefs.getBoolPref(PREF_LAZY_PINNED, DEFAULT_LAZY_PINNED);
var isOnDemand = () => Services.prefs.getBoolPref(PREF_ONDEMAND, false);
var setOnDemand = (value) => Services.prefs.setBoolPref(PREF_ONDEMAND, value);
var observePref = (name, onChange) => {
  const observer = { observe: () => onChange() };
  Services.prefs.addObserver(name, observer);
  return () => Services.prefs.removeObserver(name, observer);
};
var prefProbes = () => [
  {
    name: PREF_ONDEMAND,
    present: Services.prefs.getPrefType(PREF_ONDEMAND) === Services.prefs.PREF_BOOL,
    required: true
  }
];

// src/platform/log.ts
var log = (...args) => {
  if (isDebug()) {
    console.log("[keep-loaded]", ...args);
  }
};

// src/platform/browser.ts
var { SessionStore } = ChromeUtils.importESModule("resource:///modules/sessionstore/SessionStore.sys.mjs");
var TAB_FLAG = "zenKeepLoaded";
var MARKER_ATTR = "zen-keep-loaded";
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
var setFlag = (tab, keep) => {
  SessionStore.setCustomTabValue(tab, TAB_FLAG, keep ? "true" : "false");
};
var setMarker = (tab, kept) => {
  if (kept) {
    tab.setAttribute(MARKER_ATTR, "true");
  } else {
    tab.removeAttribute(MARKER_ATTR);
  }
};
var markUndiscardable = (tab) => {
  tab.undiscardable = true;
};
var insertBrowser = (tab) => {
  window.gBrowser._insertBrowser(tab);
};
var sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
var browserProbes = () => {
  const zen = window.gZenWorkspaces;
  return [
    {
      name: "SessionStore.promiseAllWindowsRestored",
      present: "promiseAllWindowsRestored" in SessionStore,
      required: true
    },
    {
      name: "SessionStore.getLazyTabValue",
      present: typeof SessionStore.getLazyTabValue === "function",
      required: true
    },
    {
      name: "SessionStore.getCustomTabValue",
      present: typeof SessionStore.getCustomTabValue === "function",
      required: true
    },
    {
      name: "SessionStore.setCustomTabValue",
      present: typeof SessionStore.setCustomTabValue === "function",
      required: true
    },
    {
      name: "gBrowser._insertBrowser",
      present: typeof window.gBrowser._insertBrowser === "function",
      required: true
    },
    {
      name: "gZenWorkspaces.allStoredTabs",
      present: !!zen && "allStoredTabs" in zen,
      required: false
    }
  ];
};

// src/platform/menu.ts
var ITEM_ID = "keep-loaded-context-item";
var MENU_ID = "tabContextMenu";
var ANCHOR_ID = "context_pinTab";
var installKeepMenuItem = (state2, toggle) => {
  const document = window.document;
  const menu = document.getElementById(MENU_ID);
  if (!menu || !window.MozXULElement) {
    log(`no #${MENU_ID} or MozXULElement — skipping the context-menu item`);
    return () => {
    };
  }
  document.getElementById(ITEM_ID)?.remove();
  const fragment = window.MozXULElement.parseXULToFragment(
    `<menuitem id="${ITEM_ID}" type="checkbox"/>`
  );
  const anchor = document.getElementById(ANCHOR_ID);
  if (anchor) {
    anchor.before(fragment);
  } else {
    menu.appendChild(fragment);
  }
  const item = document.getElementById(ITEM_ID);
  if (!item) {
    log("context-menu item did not appear after insertion");
    return () => {
    };
  }
  const onShowing = (event) => {
    if (event.target !== menu) {
      return;
    }
    const tab = TabContextMenu.contextTab;
    item.hidden = !tab?.pinned;
    if (!tab) {
      return;
    }
    const next = state2(tab);
    item.setAttribute("label", next.label);
    for (const [name, on] of [
      ["checked", next.checked],
      ["disabled", next.disabled]
    ]) {
      if (on) {
        item.setAttribute(name, "true");
      } else {
        item.removeAttribute(name);
      }
    }
  };
  const onCommand = () => {
    const tab = TabContextMenu.contextTab;
    if (tab) {
      toggle(tab);
    }
  };
  menu.addEventListener("popupshowing", onShowing);
  item.addEventListener("command", onCommand);
  return () => {
    menu.removeEventListener("popupshowing", onShowing);
    item.removeEventListener("command", onCommand);
    item.remove();
  };
};

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
  const restore = isOnDemand();
  state.onDemandRestore = restore;
  setOnDemand(false);
  try {
    for (const tab of tabs) {
      insertBrowser(tab);
    }
    const deadline = Date.now() + WAKE_TIMEOUT_MS;
    while (!state.disposed && tabs.some(isPending) && Date.now() < deadline) {
      await sleep(POLL_MS);
    }
  } finally {
    setOnDemand(restore);
    state.onDemandRestore = null;
  }
};
var sweep = async () => {
  await whenSessionRestored();
  await whenSpacesReady();
  const capabilities = reportCapabilities([...prefProbes(), ...browserProbes()]);
  if (!capabilities.ok) {
    console.error(`[keep-loaded] ${capabilities.message}`);
    return;
  }
  if (capabilities.message) {
    log(capabilities.message);
  }
  const laziness = planLazyPinned(isLazyPinnedWanted(), isOnDemand());
  if (laziness.set !== null) {
    setOnDemand(laziness.set);
    log(laziness.message);
  }
  const matchers = parseMatchList(rawMatchList());
  const pinned = pinnedTabs().map((tab) => ({ tab, facts: factsFor(tab) }));
  const kept = pinned.filter(({ facts }) => shouldKeep(facts, matchers));
  const summary = sweepSummary(
    pinned.map(({ facts }) => facts),
    kept.map(({ facts }) => facts)
  );
  log(summary.message, summary.kept);
  const keptTabs = new Set(kept.map(({ tab }) => tab));
  for (const { tab } of pinned) {
    setMarker(tab, keptTabs.has(tab));
  }
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
var runSweep = async () => {
  if (state.running) {
    log("a sweep is already running — skipping this one");
    return;
  }
  state.running = true;
  try {
    await sweep();
  } finally {
    state.running = false;
  }
};
var teardown = () => {
  state.disposed = true;
  runDisposers();
  for (const tab of pinnedTabs()) {
    setMarker(tab, false);
  }
  if (typeof state.onDemandRestore === "boolean") {
    setOnDemand(state.onDemandRestore);
    state.onDemandRestore = null;
  }
  log("unloaded");
};
onUnload(teardown);
state.disposed = false;
for (const [pref, what] of [
  [PREF_MATCH, "allowlist"],
  [PREF_LAZY_PINNED, "lazy pinned tabs setting"]
]) {
  state.disposers.push(
    observePref(pref, () => {
      log(`${what} changed — re-sweeping`);
      void runSweep();
    })
  );
}
state.disposers.push(
  installKeepMenuItem(
    (tab) => keepMenuState(factsFor(tab), parseMatchList(rawMatchList())),
    (tab) => {
      const facts = factsFor(tab);
      setFlag(tab, !facts.flagged);
      log(`${facts.flagged ? "released" : "kept"} ${facts.url}`);
      void runSweep();
    }
  )
);
await runSweep();
