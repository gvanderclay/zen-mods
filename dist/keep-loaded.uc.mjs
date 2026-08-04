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

// src/core/crash.ts
var MISMATCH = "content process aborted on a build-id mismatch — Zen was updated in place, so restart Zen to bring this tab back";
function crashDiagnosis(facts) {
  const restartRequired = facts.kind === "restart-required";
  const subject = facts.url || "a kept tab";
  const state2 = [
    facts.pending ? "pending" : "not pending",
    facts.remote ? "remote" : "non-remote",
    facts.connected ? "browser connected" : "browser detached"
  ].join(", ");
  return {
    message: `${subject}: ${restartRequired ? MISMATCH : "content process crashed"}`,
    recoverable: !restartRequired,
    lines: [
      `state: ${state2}`,
      facts.crashedPage ? "crash page: shown, so this was not handled as a background crash" : "crash page: not shown",
      `recovery: ${recoveryNote(restartRequired, facts.remote)}`
    ]
  };
}
var recoveryNote = (restartRequired, remote) => {
  if (restartRequired) {
    return "not possible until Zen restarts";
  }
  return remote ? "discard is available" : "discard is blocked by _mayDiscardBrowser while non-remote, so it needs a remoteness flip first";
};

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

// src/core/liveness.ts
var SECOND = 1e3;
var MINUTE = 60 * SECOND;
var HOUR = 60 * MINUTE;
function isLifeSign(kind, state2) {
  return kind !== "label" || !(state2.pending || state2.crashedPage);
}
function formatAge(ms) {
  if (ms < SECOND) {
    return "just now";
  }
  if (ms < MINUTE) {
    return `${Math.floor(ms / SECOND)}s ago`;
  }
  if (ms < HOUR) {
    return `${Math.floor(ms / MINUTE)}m ago`;
  }
  return `${Math.floor(ms / HOUR)}h ago`;
}
var byConcern = (a, b) => {
  if (!a.last || !b.last) {
    return (a.last ? 1 : 0) - (b.last ? 1 : 0);
  }
  return a.last.at - b.last.at;
};
function livenessSummary(records, now) {
  if (!records.length) {
    return { message: "liveness: nothing kept", lines: [] };
  }
  const sorted = [...records].sort(byConcern);
  const seen = sorted.filter((item) => item.last);
  const unseen = sorted.length - seen.length;
  const parts = [`${sorted.length} kept`];
  if (seen[0]?.last) {
    parts.push(`oldest sign ${formatAge(now - seen[0].last.at)}`);
  }
  if (unseen) {
    parts.push(`${unseen} with no sign yet`);
  }
  return {
    message: `liveness: ${parts.join(", ")}`,
    lines: sorted.map(
      (item) => item.last ? `${item.space} ${item.url} ${item.last.kind} ${formatAge(now - item.last.at)}` : `${item.space} ${item.url} no sign yet`
    )
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

// src/core/url.ts
var PLACEHOLDERS = /* @__PURE__ */ new Set(["", "about:blank"]);
function isPlaceholderUrl(url) {
  return PLACEHOLDERS.has(url);
}
function resolveUrl(live, stored) {
  if (!isPlaceholderUrl(live)) {
    return live;
  }
  let fallback = "";
  try {
    fallback = stored();
  } catch {
    return live;
  }
  return isPlaceholderUrl(fallback) ? live : fallback;
}
function urlFromTabState(json) {
  let state2 = null;
  try {
    state2 = JSON.parse(json);
  } catch {
    return "";
  }
  const entries = state2?.entries;
  if (!Array.isArray(entries) || !entries.length) {
    return "";
  }
  const requested = typeof state2?.index === "number" ? state2.index : entries.length;
  const index = Math.min(Math.max(requested - 1, 0), entries.length - 1);
  const url = entries[index]?.url;
  return typeof url === "string" ? url : "";
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
var tabStateUrl = (tab) => urlFromTabState(SessionStore.getTabState(tab));
var urlFor = (tab) => {
  const live = (tab.linkedPanel ? tab.linkedBrowser?.currentURI?.spec : SessionStore.getLazyTabValue(tab, "url")) || "";
  return resolveUrl(live, () => tabStateUrl(tab));
};
var spaceOf = (tab) => tab.getAttribute("zen-workspace-id")?.replace(/[{}]/g, "").slice(0, 8) || "-";
var isPending = (tab) => tab.hasAttribute("pending");
var isCrashedPage = (tab) => tab.hasAttribute("crashed");
var loadStateOf = (tab) => ({
  pending: isPending(tab),
  crashedPage: isCrashedPage(tab)
});
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
var crashFactsFor = (tab, kind) => {
  const browser = tab.linkedBrowser;
  return {
    url: urlFor(tab),
    kind,
    pending: isPending(tab),
    remote: browser?.isRemoteBrowser === true,
    connected: browser?.isConnected === true,
    crashedPage: isCrashedPage(tab)
  };
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
      name: "SessionStore.getTabState",
      present: typeof SessionStore.getTabState === "function",
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

// src/platform/liveness.ts
var signs = /* @__PURE__ */ new WeakMap();
var signFor = (tab) => signs.get(tab) ?? null;
var recordSign = (tab, kind) => {
  const previous = signs.get(tab);
  signs.set(tab, { kind, at: Date.now() });
  if (previous && previous.kind !== kind) {
    const facts = factsFor(tab);
    if (shouldKeep(facts, parseMatchList(rawMatchList()))) {
      log(`${facts.url}: ${previous.kind} -> ${kind}`);
    }
  }
};
var TAB_EVENTS = {
  // Dispatched with detail.changed naming the attributes (tabbrowser.js 2246). Only
  // a label change is a sign of life: the page rewrote its own title, so its JS ran.
  TabAttrModified: "label",
  TabBrowserDiscarded: "discarded"
};
var BROWSER_EVENTS = {
  "oop-browser-crashed": "crashed",
  "oop-browser-buildid-mismatch": "restart-required"
};
var observeSigns = (onCrash2) => {
  const document = window.document;
  const onTabEvent = (event) => {
    const kind = TAB_EVENTS[event.type];
    const tab = event.target;
    if (!kind || !tab?.pinned) {
      return;
    }
    if (kind === "label" && !labelChanged(event)) {
      return;
    }
    if (!isLifeSign(kind, loadStateOf(tab))) {
      return;
    }
    recordSign(tab, kind);
  };
  const onBrowserEvent = (event) => {
    const kind = BROWSER_EVENTS[event.type];
    const browser = event.target;
    if (!kind || !browser) {
      return;
    }
    const tab = window.gBrowser.getTabForBrowser(browser);
    if (!tab?.pinned) {
      return;
    }
    recordSign(tab, kind);
    onCrash2?.(tab, kind);
  };
  for (const type of Object.keys(TAB_EVENTS)) {
    document.addEventListener(type, onTabEvent);
  }
  for (const type of Object.keys(BROWSER_EVENTS)) {
    document.addEventListener(type, onBrowserEvent);
  }
  return () => {
    for (const type of Object.keys(TAB_EVENTS)) {
      document.removeEventListener(type, onTabEvent);
    }
    for (const type of Object.keys(BROWSER_EVENTS)) {
      document.removeEventListener(type, onBrowserEvent);
    }
  };
};
var labelChanged = (event) => {
  const { detail } = event;
  return !!detail?.changed?.includes("label");
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
  if (asleep.length) {
    await wakeAll(asleep.map(({ tab }) => tab));
    const stuck = asleep.filter(({ tab }) => isPending(tab));
    log(
      wakeSummary(
        asleep.length,
        stuck.map(({ facts }) => facts.url)
      )
    );
  }
  const liveness = livenessSummary(kept.map(recordOf), Date.now());
  log(liveness.message, liveness.lines);
};
var recordOf = ({ tab, facts }) => {
  if (!signFor(tab) && !isPending(tab)) {
    recordSign(tab, "awake");
  }
  return { space: facts.space, url: facts.url, last: signFor(tab) };
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
  delete state.liveness;
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
var onCrash = (tab, kind) => {
  try {
    if (!shouldKeep(factsFor(tab), parseMatchList(rawMatchList()))) {
      return;
    }
    const diagnosis = crashDiagnosis(crashFactsFor(tab, kind));
    log(diagnosis.message, diagnosis.lines);
  } catch (error) {
    console.error("[keep-loaded] crash diagnosis failed", error);
  }
};
state.disposers.push(observeSigns(onCrash));
state.liveness = () => {
  const matchers = parseMatchList(rawMatchList());
  return pinnedTabs().map((tab) => ({ tab, facts: factsFor(tab) })).filter(({ facts }) => shouldKeep(facts, matchers)).map(recordOf);
};
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
