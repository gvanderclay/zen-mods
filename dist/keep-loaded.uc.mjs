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

// src/core/defaults.ts
var DEFAULT_MATCH = "mail.google.com,calendar.google.com,slack.com";
var DEFAULT_DEBUG = true;
var DEFAULT_LAZY_PINNED = true;
var DEFAULT_CRASH_ATTEMPTS = "3";
var DEFAULT_CRASH_WINDOW = "60";

// src/core/recovery.ts
var DEFAULT_MAX_ATTEMPTS = Number(DEFAULT_CRASH_ATTEMPTS);
var DEFAULT_WINDOW_MINUTES = Number(DEFAULT_CRASH_WINDOW);
var MINUTE_MS = 6e4;
function parseWindowMs(raw) {
  const minutes = Number(raw.trim());
  if (!Number.isFinite(minutes) || minutes <= 0 || raw.trim() === "") {
    return DEFAULT_WINDOW_MINUTES * MINUTE_MS;
  }
  return minutes * MINUTE_MS;
}
function parseAttempts(raw) {
  const count = Number(raw.trim());
  if (!Number.isFinite(count) || count < 0 || raw.trim() === "") {
    return DEFAULT_MAX_ATTEMPTS;
  }
  return Math.floor(count);
}
function recentAttempts(attempts2, now, windowMs) {
  return attempts2.filter((at) => at > now - windowMs && at <= now);
}
function recoveryPlan(facts, budget) {
  const { attempts: attempts2, now, windowMs, maxAttempts } = budget;
  if (maxAttempts <= 0) {
    return { action: "skip", reason: "crash recovery is turned off in the settings" };
  }
  if (facts.kind === "restart-required") {
    return { action: "skip", reason: "not recoverable until Zen restarts" };
  }
  if (facts.crashedPage) {
    return { action: "skip", reason: "already showing its crash page" };
  }
  if (!facts.pending) {
    return { action: "skip", reason: "not revived, so it has no state to restore" };
  }
  if (recentAttempts(attempts2, now, windowMs).length >= maxAttempts) {
    return {
      action: "skip",
      // Both numbers come from the settings, so both are named: a line saying only
      // "already recovered" cannot be checked against what was configured.
      reason: `already recovered ${maxAttempts} time(s) in the last ${windowMs / MINUTE_MS} minute(s)`
    };
  }
  if (!facts.connected) {
    return { action: "wake", reason: "browser already detached, so inserting it" };
  }
  return {
    action: "reset-then-wake",
    reason: "browser attached and non-remote, so flipping remoteness and discarding"
  };
}

// src/core/resume.ts
var WAKE_TOPICS = [
  "wake_notification",
  "network:link-status-changed",
  "network:offline-status-changed"
];
function wakeReason(topic, data) {
  switch (topic) {
    case "wake_notification":
      return "woke from sleep";
    // Four possible values — `up`, `down`, `change`, `unknown`. services-sync acts
    // on `up` alone (policies.sys.mjs 318), and for the same reason: the others say
    // something happened, not that there is a network.
    case "network:link-status-changed":
      return data === "up" ? "network link came back" : null;
    case "network:offline-status-changed":
      return data === "online" ? "back online" : null;
    default:
      return null;
  }
}
function networkReady(facts) {
  if (facts.offline) {
    return { ready: false, reason: "the browser is in offline mode" };
  }
  if (facts.portalLocked) {
    return { ready: false, reason: "a captive portal is holding the connection" };
  }
  if (facts.linkUp === false) {
    return { ready: false, reason: "the network link is down" };
  }
  return { ready: true, reason: "the network looks usable" };
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
function shortUrl(url, max = 44) {
  const bare = url.replace(/^https?:\/\//, "").replace(/^www\./, "");
  return bare.length > max ? `${bare.slice(0, max - 1)}…` : bare;
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

// src/core/rows.ts
var QUIET_MS = 15 * 60 * 1e3;
var RANK = ["crashed", "asleep", "unseen", "quiet", "alive"];
var SIGN_WORDS = {
  awake: "had a live browser",
  label: "changed its title",
  discarded: "was unloaded",
  crashed: "crashed",
  "restart-required": "crashed, and needs a browser restart"
};
var stateOf = (facts, now) => {
  const kind = facts.last?.kind;
  if (kind === "crashed" || kind === "restart-required") {
    return "crashed";
  }
  if (facts.pending) {
    return "asleep";
  }
  if (!facts.last) {
    return "unseen";
  }
  return now - facts.last.at > QUIET_MS ? "quiet" : "alive";
};
var detailOf = (facts, now) => {
  const parts = [];
  parts.push(
    facts.last ? `${SIGN_WORDS[facts.last.kind]} ${formatAge(now - facts.last.at)}` : "nothing seen yet"
  );
  const frames = facts.frames;
  if (!frames) {
    if (!facts.pending) {
      parts.push("not watching its websockets");
    }
  } else if (frames.in + frames.out === 0) {
    parts.push("no frames yet");
  } else {
    const age = frames.lastAt === null ? "" : `, last ${formatAge(now - frames.lastAt)}`;
    parts.push(`${frames.in} in, ${frames.out} out${age}`);
  }
  return parts.join(" · ");
};
var rowOf = (facts, now) => ({
  // A url the mod could not resolve still has to occupy a row, or the tab silently
  // vanishes from a panel whose whole job is saying what is kept.
  title: shortUrl(facts.url) || "(url unknown)",
  url: facts.url,
  state: stateOf(facts, now),
  detail: detailOf(facts, now)
});
var byConcern2 = (a, b) => RANK.indexOf(a.state) - RANK.indexOf(b.state);
function panelReport(facts, now) {
  if (!facts.length) {
    return { heading: "nothing kept", groups: [] };
  }
  const groups = /* @__PURE__ */ new Map();
  const counts = /* @__PURE__ */ new Map();
  for (const item of facts) {
    const row = rowOf(item, now);
    const rows = groups.get(item.space);
    if (rows) {
      rows.push(row);
    } else {
      groups.set(item.space, [row]);
    }
    counts.set(row.state, (counts.get(row.state) ?? 0) + 1);
  }
  const tally = RANK.filter((state2) => counts.get(state2)).map(
    (state2) => `${counts.get(state2)} ${state2}`
  );
  return {
    heading: `${facts.length} kept — ${tally.join(", ")}`,
    groups: [...groups].map(([space, rows]) => ({
      space,
      rows: [...rows].sort(byConcern2)
    }))
  };
}

// src/core/sockets.ts
var byQuiet = (a, b) => {
  if (a.lastFrameAt === null || b.lastFrameAt === null) {
    return (a.lastFrameAt === null ? 0 : 1) - (b.lastFrameAt === null ? 0 : 1);
  }
  return a.lastFrameAt - b.lastFrameAt;
};
var rowOf2 = (record, now) => {
  const { space, url, open, framesIn, framesOut, lastFrameAt } = record;
  if (!record.watching) {
    return `${space} ${url} not watched`;
  }
  const counts = `${open} opened, ${framesIn} in, ${framesOut} out`;
  return lastFrameAt === null ? `${space} ${url} ${counts}, no frames yet` : `${space} ${url} ${counts}, last ${formatAge(now - lastFrameAt)}`;
};
function socketSummary(records, now) {
  if (!records.length) {
    return { message: "sockets: nothing kept", lines: [] };
  }
  const sorted = [...records].sort(byQuiet);
  const lines = sorted.map((record) => rowOf2(record, now));
  const watching = sorted.filter((record) => record.watching);
  const frames = watching.reduce((sum, r) => sum + r.framesIn + r.framesOut, 0);
  if (!frames) {
    return {
      message: `sockets: ${watching.length} watched, no frames seen at all — a parent-process listener may not receive them`,
      lines
    };
  }
  const receiving = watching.filter((record) => record.framesIn + record.framesOut > 0);
  const freshest = Math.max(...watching.map((record) => record.lastFrameAt ?? 0));
  return {
    message: `sockets: ${watching.length} watched, ${receiving.length} receiving, ${frames} frame(s), freshest ${formatAge(now - freshest)}`,
    lines
  };
}

// src/core/unload.ts
function unloadPlan(facts) {
  const { url, kept, busy } = facts;
  if (!kept) {
    return { action: "ignore", reason: "not a tab the mod keeps" };
  }
  if (busy) {
    return { action: "ignore", reason: "a sweep is already running" };
  }
  return { action: "wake", message: `${url} was unloaded — waking it again` };
}

// src/platform/prefs.ts
var PREF_MATCH = "zen.keep-loaded.match";
var PREF_DEBUG = "zen.keep-loaded.debug";
var PREF_LAZY_PINNED = "zen.keep-loaded.lazy-pinned";
var PREF_CRASH_ATTEMPTS = "zen.keep-loaded.crash-attempts";
var PREF_CRASH_WINDOW = "zen.keep-loaded.crash-window-minutes";
var PREF_ONDEMAND = "browser.sessionstore.restore_pinned_tabs_on_demand";
var rawMatchList = () => Services.prefs.getStringPref(PREF_MATCH, DEFAULT_MATCH);
var rawCrashAttempts = () => Services.prefs.getStringPref(PREF_CRASH_ATTEMPTS, DEFAULT_CRASH_ATTEMPTS);
var rawCrashWindow = () => Services.prefs.getStringPref(PREF_CRASH_WINDOW, DEFAULT_CRASH_WINDOW);
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
var spaceNameFor = (tab) => {
  const id = tab.getAttribute("zen-workspace-id");
  const space = id ? window.gZenWorkspaces?.getWorkspaceFromId?.(id) : null;
  const name = space?.name?.trim();
  if (!name) {
    return spaceOf(tab);
  }
  const icon = space?.icon;
  return icon && !icon.endsWith(".svg") ? `${icon} ${name}` : name;
};
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
var resetToLazy = (tab, url) => {
  window.gBrowser.updateBrowserRemotenessByURL(tab.linkedBrowser, url);
  return window.gBrowser.discardBrowser(tab, true);
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
      name: "gBrowser.updateBrowserRemotenessByURL",
      present: typeof window.gBrowser.updateBrowserRemotenessByURL === "function",
      required: false
    },
    {
      name: "gBrowser.discardBrowser",
      present: typeof window.gBrowser.discardBrowser === "function",
      required: false
    },
    {
      name: "gZenWorkspaces.allStoredTabs",
      present: !!zen && "allStoredTabs" in zen,
      required: false
    },
    {
      name: "gZenWorkspaces.getWorkspaceFromId",
      present: typeof zen?.getWorkspaceFromId === "function",
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
var observeSigns = (onCrash2, onDiscard2) => {
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
    if (kind === "discarded") {
      onDiscard2?.(tab);
    }
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

// src/platform/panel.ts
var BUTTON_ID = "keep-loaded-button";
var VIEW_ID = "keep-loaded-panelview";
var BODY_ID = "keep-loaded-panel-body";
var CACHE_ID = "appMenu-viewCache";
var AREA = "zen-sidebar-foot-buttons";
var VIEW_XUL = `
  <panelview id="${VIEW_ID}" class="PanelUI-subView keep-loaded-panelview">
    <vbox id="${BODY_ID}" class="panel-subview-body"/>
  </panelview>
`;
var labelNode = (document, className, value) => {
  const label = document.createXULElement("label");
  label.className = className;
  label.setAttribute("value", value);
  return label;
};
var renderPanelLines = (body, lines) => {
  body.textContent = "";
  for (const line of lines) {
    body.appendChild(labelNode(body.ownerDocument, "keep-loaded-panel-line", line));
  }
};
var renderPanelReport = (body, report) => {
  const document = body.ownerDocument;
  body.textContent = "";
  body.appendChild(labelNode(document, "keep-loaded-panel-heading", report.heading));
  for (const group of report.groups) {
    body.appendChild(labelNode(document, "keep-loaded-space", group.space));
    for (const row of group.rows) {
      const box = document.createXULElement("vbox");
      box.className = "keep-loaded-row";
      box.setAttribute("data-state", row.state);
      if (row.url) {
        box.setAttribute("tooltiptext", row.url);
      }
      const head = document.createXULElement("hbox");
      head.className = "keep-loaded-row-head";
      head.appendChild(labelNode(document, "keep-loaded-row-title", row.title));
      const spacer = document.createXULElement("spacer");
      spacer.setAttribute("flex", "1");
      head.appendChild(spacer);
      head.appendChild(labelNode(document, "keep-loaded-row-state", row.state));
      box.appendChild(head);
      box.appendChild(labelNode(document, "keep-loaded-row-detail", row.detail));
      body.appendChild(box);
    }
  }
};
var viewCache = (document) => document.getElementById(CACHE_ID);
var removeView = (document) => {
  document.getElementById(VIEW_ID)?.remove();
  viewCache(document)?.content.querySelector(`#${VIEW_ID}`)?.remove();
};
var installStatusPanel = () => {
  const document = window.document;
  const ui = window.CustomizableUI;
  if (!ui || !window.MozXULElement) {
    log("no CustomizableUI or MozXULElement — skipping the status panel");
    return () => {
    };
  }
  const cache = viewCache(document);
  if (!cache) {
    log(`no #${CACHE_ID} — skipping the status panel`);
    return () => {
    };
  }
  removeView(document);
  cache.content.appendChild(window.MozXULElement.parseXULToFragment(VIEW_XUL));
  const existing = ui.getWidget(BUTTON_ID);
  if (existing?.provider !== ui.PROVIDER_API) {
    ui.createWidget({
      id: BUTTON_ID,
      type: "view",
      viewId: VIEW_ID,
      localized: false,
      label: "Keep Loaded",
      tooltiptext: "Tabs being kept loaded, and when each was last alive",
      defaultArea: AREA,
      // Routed through the window rather than a closure: this callback outlives the
      // module instance that created it, and in a second window it belongs to a
      // different one entirely (D022).
      onViewShowing: (event) => {
        const view = event.target;
        const body = view.querySelector(`#${BODY_ID}`);
        if (!body) {
          return;
        }
        const fill = view.ownerDocument.defaultView?.zenKeepLoaded?.fillPanel;
        if (fill) {
          fill(body);
        } else {
          renderPanelLines(body, ["Keep Loaded is not running in this window"]);
        }
      }
    });
  }
  return () => {
    try {
      ui.destroyWidget(BUTTON_ID);
    } catch (error) {
      console.error("[keep-loaded] could not remove the status button", error);
    }
    removeView(document);
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

// src/platform/sockets.ts
var SERVICE = "@mozilla.org/websocketevent/service;1";
var service = () => {
  try {
    return Cc[SERVICE]?.getService(Ci.nsIWebSocketEventService);
  } catch {
    return void 0;
  }
};
var isListening = (id) => {
  try {
    return Boolean(service()?.hasListenerFor(id));
  } catch {
    return false;
  }
};
var counters = /* @__PURE__ */ new WeakMap();
var watched = /* @__PURE__ */ new Map();
var counterFor = (tab) => {
  const existing = counters.get(tab);
  if (existing) {
    return existing;
  }
  const fresh = { open: 0, framesIn: 0, framesOut: 0, lastFrameAt: null };
  counters.set(tab, fresh);
  return fresh;
};
var listenerFor = (tab) => {
  const bump = (direction) => {
    const counter = counterFor(tab);
    counter[direction] += 1;
    counter.lastFrameAt = Date.now();
  };
  return {
    webSocketCreated: () => {
    },
    // Only fires for a socket that opens *after* attaching, which a long-lived one
    // never will — the count is a bonus, not the signal (D020).
    webSocketOpened: () => {
      counterFor(tab).open += 1;
    },
    webSocketMessageAvailable: () => {
    },
    webSocketClosed: () => {
      const counter = counterFor(tab);
      counter.open = Math.max(0, counter.open - 1);
    },
    frameReceived: () => bump("framesIn"),
    frameSent: () => bump("framesOut")
  };
};
var stopWatching = (tab) => {
  const entry = watched.get(tab);
  if (!entry) {
    return;
  }
  watched.delete(tab);
  try {
    if (isListening(entry.id)) {
      service()?.removeListener(entry.id, entry.listener);
    }
  } catch (error) {
    console.error("[keep-loaded] could not stop watching sockets", error);
  }
};
var watchSockets = (tabs) => {
  const svc = service();
  if (!svc) {
    return;
  }
  const wanted = new Set(tabs);
  for (const [tab, entry] of [...watched]) {
    if (!wanted.has(tab) || !isListening(entry.id)) {
      stopWatching(tab);
    }
  }
  for (const tab of tabs) {
    const id = tab.linkedPanel ? tab.linkedBrowser?.innerWindowID ?? null : null;
    if (id === null) {
      continue;
    }
    if (watched.get(tab)?.id === id) {
      continue;
    }
    stopWatching(tab);
    const listener = listenerFor(tab);
    try {
      svc.addListener(id, listener);
      watched.set(tab, { id, listener });
    } catch (error) {
      console.error("[keep-loaded] could not watch sockets", error);
    }
  }
};
var stopWatchingSockets = () => {
  for (const tab of [...watched.keys()]) {
    stopWatching(tab);
  }
};
var socketRecordFor = (tab, space, url) => {
  const counter = counters.get(tab);
  const entry = watched.get(tab);
  return {
    space,
    url,
    watching: entry ? isListening(entry.id) : false,
    open: counter?.open ?? 0,
    framesIn: counter?.framesIn ?? 0,
    framesOut: counter?.framesOut ?? 0,
    lastFrameAt: counter?.lastFrameAt ?? null
  };
};
var socketProbes = () => [
  { name: SERVICE, present: Boolean(service()), required: false }
];

// src/platform/system.ts
var observeTopic = (topic, onNotify) => {
  const observer = { observe: (_subject, _topic, data) => onNotify(data) };
  Services.obs.addObserver(observer, topic);
  return () => Services.obs.removeObserver(observer, topic);
};
var getService = (contract, iface) => {
  try {
    return Cc[contract]?.getService(iface) ?? null;
  } catch {
    return null;
  }
};
var LINK = "@mozilla.org/network/network-link-service;1";
var PORTAL = "@mozilla.org/network/captive-portal-service;1";
var networkFacts = () => {
  const facts = { offline: false, linkUp: null, portalLocked: false };
  try {
    facts.offline = Services.io.offline;
    const link = getService(LINK, Ci.nsINetworkLinkService);
    facts.linkUp = link?.linkStatusKnown ? link.isLinkUp : null;
    const portal = getService(PORTAL, Ci.nsICaptivePortalService);
    facts.portalLocked = portal ? portal.state === portal.LOCKED_PORTAL : false;
  } catch (error) {
    console.error("[keep-loaded] could not read the network state", error);
  }
  return facts;
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
var attempts = /* @__PURE__ */ new WeakMap();
var whenSweepIdle = async () => {
  const deadline = Date.now() + WAKE_TIMEOUT_MS;
  while (state.running && !state.disposed && Date.now() < deadline) {
    await sleep(POLL_MS);
  }
  return !state.running && !state.disposed;
};
var recover = async (tab, facts) => {
  const now = Date.now();
  const windowMs = parseWindowMs(rawCrashWindow());
  const maxAttempts = parseAttempts(rawCrashAttempts());
  const spent = recentAttempts(attempts.get(tab) ?? [], now, windowMs);
  const plan = recoveryPlan(facts, { attempts: spent, now, windowMs, maxAttempts });
  log(`${facts.url}: ${plan.reason}`);
  if (plan.action === "skip") {
    return;
  }
  if (!await whenSweepIdle()) {
    log(`${facts.url}: gave up waiting for a sweep to finish`);
    return;
  }
  attempts.set(tab, [...spent, now]);
  state.running = true;
  try {
    if (plan.action === "reset-then-wake" && !resetToLazy(tab, facts.url)) {
      log(`${facts.url}: the browser refused to discard, so it stays crashed`);
      return;
    }
    await wakeAll([tab]);
    if (isPending(tab)) {
      log(`${facts.url}: still pending after recovery`);
      return;
    }
    recordSign(tab, "awake");
  } finally {
    state.running = false;
  }
};
var sweep = async () => {
  await whenSessionRestored();
  await whenSpacesReady();
  const capabilities = reportCapabilities([
    ...prefProbes(),
    ...browserProbes(),
    ...socketProbes()
  ]);
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
  const keptSet = new Set(kept.map(({ tab }) => tab));
  for (const { tab } of pinned) {
    setMarker(tab, keptSet.has(tab));
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
  watchSockets(kept.map(({ tab }) => tab));
  const sockets = socketSummary(socketRecords(), Date.now());
  log(sockets.message, sockets.lines);
};
var keptTabs = () => {
  const matchers = parseMatchList(rawMatchList());
  return pinnedTabs().map((tab) => ({ tab, facts: factsFor(tab) })).filter(({ facts }) => shouldKeep(facts, matchers));
};
var socketRecords = () => keptTabs().map(({ tab, facts }) => socketRecordFor(tab, facts.space, facts.url));
var recordOf = ({ tab, facts }) => {
  if (!signFor(tab) && !isPending(tab)) {
    recordSign(tab, "awake");
  }
  return { space: facts.space, url: facts.url, last: signFor(tab) };
};
var runSweep = async () => {
  if (state.running) {
    log("another wake is already running — skipping this sweep");
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
  delete state.sockets;
  delete state.fillPanel;
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
    const facts = crashFactsFor(tab, kind);
    const diagnosis = crashDiagnosis(facts);
    log(diagnosis.message, diagnosis.lines);
    void recover(tab, facts).catch((error) => {
      console.error("[keep-loaded] crash recovery failed", error);
    });
  } catch (error) {
    console.error("[keep-loaded] crash diagnosis failed", error);
  }
};
var onDiscard = (tab) => {
  try {
    const facts = factsFor(tab);
    const kept = shouldKeep(facts, parseMatchList(rawMatchList()));
    const plan = unloadPlan({
      url: facts.url,
      kept,
      // Unset until the first sweep takes the lock, which is not running.
      busy: state.running === true
    });
    if (plan.action === "wake") {
      log(plan.message);
      void runSweep();
      return;
    }
    if (kept) {
      log(`${facts.url} was unloaded — ${plan.reason}`);
    }
  } catch (error) {
    console.error("[keep-loaded] unload handling failed", error);
  }
};
state.disposers.push(observeSigns(onCrash, onDiscard));
var onSystemWake = (topic, data) => {
  try {
    const reason = wakeReason(topic, data);
    if (!reason) {
      return;
    }
    const verdict = networkReady(networkFacts());
    if (!verdict.ready) {
      log(`${reason}, but ${verdict.reason} — waiting for the network`);
      return;
    }
    log(`${reason} — re-sweeping`);
    void runSweep();
  } catch (error) {
    console.error("[keep-loaded] resume handling failed", error);
  }
};
for (const topic of WAKE_TOPICS) {
  state.disposers.push(observeTopic(topic, (data) => onSystemWake(topic, data)));
}
state.liveness = () => keptTabs().map(recordOf);
var panelFacts = () => keptTabs().map(({ tab, facts }) => {
  const socket = socketRecordFor(tab, facts.space, facts.url);
  return {
    // Zen's own space name, unlike the log lines: a panel is read by a person.
    space: spaceNameFor(tab),
    url: facts.url,
    pending: facts.pending,
    // `recordOf`, not `signFor`: a tab with a live browser and no sign yet is alive
    // enough to record, and seeding it here keeps the panel and the console command
    // saying the same thing about the same tab.
    last: recordOf({ tab, facts }).last,
    frames: socket.watching ? { in: socket.framesIn, out: socket.framesOut, lastAt: socket.lastFrameAt } : null
  };
});
state.fillPanel = (body) => {
  try {
    renderPanelReport(body, panelReport(panelFacts(), Date.now()));
  } catch (error) {
    console.error("[keep-loaded] could not fill the status panel", error);
    renderPanelLines(body, ["something went wrong — see the Browser Console"]);
  }
};
state.disposers.push(installStatusPanel());
state.disposers.push(stopWatchingSockets);
state.sockets = () => {
  const records = socketRecords();
  return { summary: socketSummary(records, Date.now()).message, tabs: records };
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
