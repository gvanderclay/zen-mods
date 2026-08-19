// Generated from src/ by build.mjs — do not edit.

// ../../packages/sine-lifecycle/dist/errors.js
var isThenable = (value) => (typeof value === "object" || typeof value === "function") && value !== null && "then" in value && typeof value.then === "function";
var safeReporter = (report = () => {
}) => (error) => {
  try {
    const result = report(error);
    if (isThenable(result)) {
      void Promise.resolve(result).catch(() => {
      });
    }
  } catch {
  }
};
var synchronousDisposer = (disposer, report) => () => {
  const result = disposer();
  if (!isThenable(result)) {
    return;
  }
  void Promise.resolve(result).catch(report);
  throw new TypeError("lifecycle disposers must finish synchronously");
};

// ../../packages/sine-lifecycle/dist/disposable-scope.js
var DisposableScope = class {
  #disposers;
  #report;
  #live = true;
  constructor({ onDisposeError } = {}) {
    if (typeof DisposableStack !== "function") {
      throw new Error("@zen-mods/sine-lifecycle requires DisposableStack");
    }
    this.#disposers = new DisposableStack();
    this.#report = safeReporter(onDisposeError);
  }
  isLive() {
    return this.#live;
  }
  defer(disposer) {
    const synchronous = synchronousDisposer(disposer, this.#report);
    if (this.#live) {
      this.#disposers.defer(synchronous);
      return;
    }
    try {
      synchronous();
    } catch (error) {
      this.#report(error);
    }
  }
  stop() {
    if (!this.#live) {
      return false;
    }
    this.#live = false;
    try {
      this.#disposers.dispose();
    } catch (error) {
      this.#report(error);
    }
    return true;
  }
};

// ../../packages/sine-lifecycle/dist/generation-scope.js
var GenerationScope = class {
  #abort = new AbortController();
  #cleanup;
  #report;
  #stopSubscribers = /* @__PURE__ */ new Set();
  #timers;
  #timerCancels = /* @__PURE__ */ new Set();
  #live = true;
  constructor({ timers, onDisposeError }) {
    this.#timers = timers;
    this.#report = safeReporter(onDisposeError);
    this.#cleanup = new DisposableScope({ onDisposeError: this.#report });
  }
  get signal() {
    return this.#abort.signal;
  }
  isLive() {
    return this.#live;
  }
  get pendingTimers() {
    return this.#timerCancels.size;
  }
  get pendingWaits() {
    return this.#stopSubscribers.size;
  }
  defer(disposer) {
    this.#cleanup.defer(disposer);
  }
  wait(work) {
    if (!this.#live) {
      void Promise.resolve(work).catch(this.#report);
      return Promise.resolve({ kind: "stopped" });
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        this.#stopSubscribers.delete(onStop);
        resolve(result);
      };
      const onStop = () => finish({ kind: "stopped" });
      this.#stopSubscribers.add(onStop);
      void Promise.resolve(work).then((value) => finish(this.#live ? { kind: "ready", value } : { kind: "stopped" }), (error) => {
        if (settled) {
          return;
        }
        settled = true;
        this.#stopSubscribers.delete(onStop);
        reject(error);
      });
    });
  }
  sleep(delayMs) {
    if (!this.#live) {
      return Promise.resolve("stopped");
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let cancel = () => {
      };
      const finish = (result) => {
        if (settled) {
          return;
        }
        settled = true;
        this.#stopSubscribers.delete(onStop);
        try {
          cancel();
        } catch (error) {
          this.#report(error);
        } finally {
          resolve(result);
        }
      };
      const onStop = () => finish("stopped");
      this.#stopSubscribers.add(onStop);
      try {
        cancel = this.schedule(delayMs, () => finish("elapsed"));
      } catch (error) {
        settled = true;
        this.#stopSubscribers.delete(onStop);
        reject(error);
      }
    });
  }
  schedule(delayMs, callback) {
    if (!this.#live) {
      return () => {
      };
    }
    let active = true;
    let handle = 0;
    const cancel = () => {
      if (!active) {
        return;
      }
      active = false;
      this.#timerCancels.delete(cancel);
      this.#timers.clearTimeout(handle);
    };
    handle = this.#timers.setTimeout(() => {
      if (!active) {
        return;
      }
      active = false;
      this.#timerCancels.delete(cancel);
      if (this.#live) {
        callback();
      }
    }, delayMs);
    this.#timerCancels.add(cancel);
    return cancel;
  }
  stop() {
    if (!this.#live) {
      return false;
    }
    this.#live = false;
    for (const settle of [...this.#stopSubscribers]) {
      try {
        settle();
      } catch (error) {
        this.#report(error);
      }
    }
    this.#stopSubscribers.clear();
    for (const cancel of [...this.#timerCancels]) {
      try {
        cancel();
      } catch (error) {
        this.#report(error);
      }
    }
    try {
      this.#abort.abort();
    } catch (error) {
      this.#report(error);
    }
    this.#cleanup.stop();
    return true;
  }
};

// src/controller.ts
var isThenable2 = (value) => (typeof value === "object" || typeof value === "function") && value !== null && "then" in value && typeof value.then === "function";
var KeepLoadedController = class {
  #now;
  #onDisposeError;
  #scope;
  #nextOperation = 1;
  #state = { kind: "live", operation: { kind: "idle" } };
  constructor({ timers, now = Date.now, onDisposeError }) {
    this.#now = now;
    this.#onDisposeError = (error) => {
      try {
        const result = onDisposeError?.(error);
        if (isThenable2(result)) {
          void Promise.resolve(result).catch(() => {
          });
        }
      } catch {
      }
    };
    this.#scope = new GenerationScope({
      timers,
      onDisposeError: this.#onDisposeError
    });
  }
  get signal() {
    return this.#scope.signal;
  }
  get state() {
    return this.#state;
  }
  get stopReason() {
    return this.#state.kind === "stopped" ? this.#state.reason : null;
  }
  get pendingTimers() {
    return this.#scope.pendingTimers;
  }
  get pendingWaits() {
    return this.#scope.pendingWaits;
  }
  isLive() {
    return this.#state.kind === "live" && this.#scope.isLive();
  }
  isBusy() {
    return this.#state.kind === "live" && this.#state.operation.kind !== "idle";
  }
  /** One generation clock for elapsed-time decisions and application pulse records. */
  now() {
    return this.#now();
  }
  isCurrentOperation(token) {
    return this.#state.kind === "live" && this.#state.operation.kind !== "idle" && this.#state.operation.token === token;
  }
  defer(disposer) {
    this.#scope.defer(disposer);
  }
  wait(work) {
    return this.#scope.wait(work);
  }
  sleep(delayMs) {
    return this.#scope.sleep(delayMs);
  }
  schedule(delayMs, callback) {
    return this.#scope.schedule(delayMs, callback);
  }
  async runSweep(work) {
    const token = this.#beginOperation("sweep");
    if (token === "stopped" || token === "busy") {
      return token;
    }
    try {
      await work(token);
      return this.isCurrentOperation(token) ? "completed" : "stopped";
    } finally {
      this.#finishOperation(token);
    }
  }
  async runRecovery(tab, { pollMs, timeoutMs }, work) {
    const deadline = this.#now() + timeoutMs;
    while (this.isBusy() && this.#now() < deadline) {
      if (await this.sleep(pollMs) === "stopped") {
        return "stopped";
      }
    }
    if (!this.isLive()) {
      return "stopped";
    }
    if (this.isBusy()) {
      return "timed-out";
    }
    const token = this.#beginOperation("recovery", tab);
    if (token === "stopped" || token === "busy") {
      return token === "busy" ? "timed-out" : token;
    }
    try {
      await work(token);
      return this.isCurrentOperation(token) ? "completed" : "stopped";
    } finally {
      this.#finishOperation(token);
    }
  }
  /** Owns the continuation that platform panel code deliberately does not keep. */
  async settlePanel(work, onReady, onError) {
    try {
      await work;
      if (this.isLive()) {
        onReady();
      }
    } catch (error) {
      if (this.isLive()) {
        onError(error);
      }
    }
  }
  /** First signal wins; every later lifecycle signal reaches the same terminal no-op. */
  stop = (reason = "manual") => {
    if (this.#state.kind === "stopped") {
      return false;
    }
    this.#state = { kind: "stopped", reason };
    this.#scope.stop();
    return true;
  };
  #beginOperation(kind, tab) {
    if (this.#state.kind === "stopped") {
      return "stopped";
    }
    if (this.#state.operation.kind !== "idle") {
      return "busy";
    }
    const token = Object.freeze({ ordinal: this.#nextOperation++ });
    this.#state = {
      kind: "live",
      operation: kind === "sweep" ? { kind, token } : { kind, token, tab }
    };
    return token;
  }
  #finishOperation(token) {
    if (!this.isCurrentOperation(token)) {
      return;
    }
    this.#state = { kind: "live", operation: { kind: "idle" } };
  }
};

// src/core/pulse-claims.ts
var PulseClaims = class {
  #records = /* @__PURE__ */ new WeakMap();
  #active = /* @__PURE__ */ new Map();
  get(tab) {
    return this.#records.get(tab) ?? { heldSince: null, lastPulseAt: null };
  }
  /** Read timing and held state without walking every claim for an ownership check. */
  owned(tab, owner) {
    const record = this.get(tab);
    return this.#active.get(tab)?.owner === owner ? record : Object.freeze({ heldSince: null, lastPulseAt: record.lastPulseAt });
  }
  /** Update timing metadata and, when heldSince is non-null, acquire the claim. */
  set(tab, owner, record) {
    const active = this.#active.get(tab);
    if (active && active.owner !== owner) {
      return false;
    }
    const next = Object.freeze({
      heldSince: record.heldSince,
      lastPulseAt: record.lastPulseAt
    });
    this.#records.set(tab, next);
    if (next.heldSince === null) {
      this.#active.delete(tab);
    } else {
      this.#active.set(tab, { owner, heldSince: next.heldSince });
    }
    return true;
  }
  /** Drop this generation's active claim while retaining its timing metadata. */
  forget(tab, owner) {
    const active = this.#active.get(tab);
    if (active && active.owner !== owner) {
      return false;
    }
    const record = this.get(tab);
    this.#records.set(
      tab,
      Object.freeze({ heldSince: null, lastPulseAt: record.lastPulseAt })
    );
    this.#active.delete(tab);
    return true;
  }
  /** Remove all metadata and any active claim for a closed/unowned tab. */
  remove(tab, owner) {
    const active = this.#active.get(tab);
    if (active && active.owner !== owner) {
      return false;
    }
    this.#active.delete(tab);
    this.#records.delete(tab);
    return true;
  }
  /** Snapshot active claims for one generation; never exposes the internal Map. */
  active(owner) {
    return [...this.#active.entries()].filter(([, claim]) => claim.owner === owner).map(([tab, claim]) => [
      tab,
      Object.freeze({
        heldSince: claim.heldSince,
        lastPulseAt: this.get(tab).lastPulseAt
      })
    ]);
  }
  /** Includes the exact owner so a replacement can retry unresolved native cleanup. */
  allActive() {
    return [...this.#active.entries()].map(([tab, claim]) => [
      tab,
      claim.owner,
      Object.freeze({
        heldSince: claim.heldSince,
        lastPulseAt: this.get(tab).lastPulseAt
      })
    ]);
  }
  activeCount(owner) {
    let count = 0;
    for (const claim of this.#active.values()) {
      if (claim.owner === owner) {
        count += 1;
      }
    }
    return count;
  }
};

// src/core/pulse-scheduler.ts
var OFF = Object.freeze({ everyMs: 0, holdMs: 0 });

// src/core/defaults.ts
var DEFAULT_MATCH = "mail.google.com,calendar.google.com,slack.com";
var DEFAULT_DEBUG = true;
var DEFAULT_LAZY_PINNED = true;
var DEFAULT_SHOW_STATUS_BUTTON = true;
var DEFAULT_CRASH_ATTEMPTS = "3";
var DEFAULT_CRASH_WINDOW = "60";
var DEFAULT_FRESHEN_SECONDS = "0";
var DEFAULT_FRESHEN_HOLD_SECONDS = "5";

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
function recentAttempts(attempts, now, windowMs) {
  return attempts.filter((at) => at > now - windowMs && at <= now);
}
function recoveryPlan(facts, budget) {
  const { attempts, now, windowMs, maxAttempts } = budget;
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
  if (recentAttempts(attempts, now, windowMs).length >= maxAttempts) {
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

// src/application-coordinator.ts
var APPLICATION_COORDINATOR_PROTOCOL = 9;

// src/platform/application.ts
var APPLICATION_OWNER_URI = "chrome://sine/content/keep-loaded/dist/keep-loaded.sys.mjs";
var imported = ChromeUtils.importESModule(APPLICATION_OWNER_URI);
if (imported.protocol !== APPLICATION_COORDINATOR_PROTOCOL) {
  throw new Error(
    `Keep Loaded application owner protocol ${imported.protocol} is cached; protocol ${APPLICATION_COORDINATOR_PROTOCOL} requires restarting Zen`
  );
}
var applicationOwner = imported;
var applicationId = imported.applicationId;

// src/core/freshness.ts
var SECOND_MS = 1e3;
var DEFAULT_PULSE_SECONDS = Number(DEFAULT_FRESHEN_SECONDS);
var DEFAULT_HOLD_SECONDS = Number(DEFAULT_FRESHEN_HOLD_SECONDS);
var secondsMs = (raw, fallbackSeconds, allowZero) => {
  const value = Number(raw.trim());
  const usable = raw.trim() !== "" && Number.isFinite(value) && value >= 0 && (allowZero || value > 0);
  return (usable ? value : fallbackSeconds) * SECOND_MS;
};
function parsePulseSettings(rawEvery, rawHold) {
  const everyMs = secondsMs(rawEvery, DEFAULT_PULSE_SECONDS, true);
  const holdMs = secondsMs(rawHold, DEFAULT_HOLD_SECONDS, false);
  return { everyMs, holdMs: everyMs > 0 ? Math.min(holdMs, everyMs) : holdMs };
}
var isPulsing = (settings2) => settings2.everyMs > 0;
var asSeconds = (ms) => `${Math.round(ms / SECOND_MS)}s`;
function pulseStep(facts, settings2, now) {
  const { kept, pending, selected, active, heldSince, lastPulseAt } = facts;
  const { everyMs, holdMs } = settings2;
  if (heldSince !== null) {
    if (selected) {
      return { action: "forget", reason: "selected, so its docshell is the browser's" };
    }
    if (!active) {
      return {
        action: "forget",
        reason: "something else deactivated it — nothing left to release"
      };
    }
    if (!isPulsing(settings2)) {
      return { action: "release", reason: "freshening is turned off" };
    }
    if (!kept) {
      return { action: "release", reason: "no longer kept" };
    }
    const heldFor = now - heldSince;
    if (heldFor < 0 || heldFor >= holdMs) {
      return { action: "release", reason: `its ${asSeconds(holdMs)} pulse is up` };
    }
    return { action: "skip", reason: "still inside its pulse" };
  }
  if (!isPulsing(settings2)) {
    return { action: "skip", reason: "freshening is turned off" };
  }
  if (!kept) {
    return { action: "skip", reason: "not a tab the mod keeps" };
  }
  if (pending) {
    return { action: "skip", reason: "asleep, so it has no page to keep running" };
  }
  if (selected) {
    return { action: "skip", reason: "selected, so its page is already running" };
  }
  if (active) {
    return { action: "skip", reason: "its docshell is already active, and not by us" };
  }
  const since = lastPulseAt === null ? everyMs : now - lastPulseAt;
  if (since >= 0 && since < everyMs) {
    return {
      action: "skip",
      reason: `not due for another ${asSeconds(everyMs - since)}`
    };
  }
  return { action: "activate", reason: `running its page for ${asSeconds(holdMs)}` };
}
var COUNTED = [
  ["activate", "activated"],
  ["release", "released"],
  ["forget", "let go of"]
];
function pulseSummary(outcomes) {
  const acted = outcomes.filter((item) => item.step.action !== "skip");
  if (!acted.length) {
    return null;
  }
  const parts = COUNTED.flatMap(([action, word]) => {
    const count = acted.filter((item) => item.step.action === action).length;
    return count ? [`${word} ${count}`] : [];
  });
  return {
    message: `freshness: ${parts.join(", ")}`,
    lines: acted.map((item) => `${item.url}: ${item.step.reason}`)
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

// src/platform/prefs.ts
var PREF_MATCH = "zen.keep-loaded.match";
var PREF_DEBUG = "zen.keep-loaded.debug";
var PREF_LAZY_PINNED = "zen.keep-loaded.lazy-pinned";
var PREF_CRASH_ATTEMPTS = "zen.keep-loaded.crash-attempts";
var PREF_CRASH_WINDOW = "zen.keep-loaded.crash-window-minutes";
var PREF_FRESHEN = "zen.keep-loaded.freshen-seconds";
var PREF_FRESHEN_HOLD = "zen.keep-loaded.freshen-hold-seconds";
var PREF_ONDEMAND = "browser.sessionstore.restore_pinned_tabs_on_demand";
var PREF_SHOW_STATUS_BUTTON = "zen.keep-loaded.show-status-button";
var rawMatchList = () => Services.prefs.getStringPref(PREF_MATCH, DEFAULT_MATCH);
var rawCrashAttempts = () => Services.prefs.getStringPref(PREF_CRASH_ATTEMPTS, DEFAULT_CRASH_ATTEMPTS);
var rawCrashWindow = () => Services.prefs.getStringPref(PREF_CRASH_WINDOW, DEFAULT_CRASH_WINDOW);
var rawFreshenSeconds = () => Services.prefs.getStringPref(PREF_FRESHEN, DEFAULT_FRESHEN_SECONDS);
var rawFreshenHoldSeconds = () => Services.prefs.getStringPref(PREF_FRESHEN_HOLD, DEFAULT_FRESHEN_HOLD_SECONDS);
var isDebug = () => Services.prefs.getBoolPref(PREF_DEBUG, DEFAULT_DEBUG);
var isLazyPinnedWanted = () => Services.prefs.getBoolPref(PREF_LAZY_PINNED, DEFAULT_LAZY_PINNED);
var isStatusButtonWanted = () => Services.prefs.getBoolPref(PREF_SHOW_STATUS_BUTTON, DEFAULT_SHOW_STATUS_BUTTON);
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
var snapshotFor = (raw) => Object.freeze({
  match: Object.freeze(parseMatchList(raw.match)),
  crashAttempts: parseAttempts(raw.crashAttempts),
  crashWindowMs: parseWindowMs(raw.crashWindow),
  freshen: Object.freeze(parsePulseSettings(raw.freshen, raw.freshenHold)),
  debug: raw.debug,
  lazyPinnedWanted: raw.lazyPinnedWanted,
  showStatusButton: raw.showStatusButton
});
var createCachedPreferences = (source) => {
  let raw = null;
  let current = null;
  let cachedProbes = null;
  const ensure = () => {
    if (!raw || !current) {
      raw = {
        match: source.readMatch(),
        crashAttempts: source.readCrashAttempts(),
        crashWindow: source.readCrashWindow(),
        freshen: source.readFreshenSeconds(),
        freshenHold: source.readFreshenHoldSeconds(),
        debug: source.readDebug(),
        lazyPinnedWanted: source.readLazyPinnedWanted(),
        showStatusButton: source.readShowStatusButton()
      };
      current = snapshotFor(raw);
    }
    return { raw, snapshot: current };
  };
  const refresh = (which) => {
    if (!raw || !current) {
      ensure();
      return;
    }
    switch (which) {
      case "match": {
        const value = source.readMatch();
        raw = { ...raw, match: value };
        current = Object.freeze({
          ...current,
          match: Object.freeze(parseMatchList(value))
        });
        break;
      }
      case "crash-attempts": {
        const value = source.readCrashAttempts();
        raw = { ...raw, crashAttempts: value };
        current = Object.freeze({ ...current, crashAttempts: parseAttempts(value) });
        break;
      }
      case "crash-window": {
        const value = source.readCrashWindow();
        raw = { ...raw, crashWindow: value };
        current = Object.freeze({ ...current, crashWindowMs: parseWindowMs(value) });
        break;
      }
      case "freshen": {
        const value = source.readFreshenSeconds();
        raw = { ...raw, freshen: value };
        current = Object.freeze({
          ...current,
          freshen: Object.freeze(parsePulseSettings(value, raw.freshenHold))
        });
        break;
      }
      case "freshen-hold": {
        const value = source.readFreshenHoldSeconds();
        raw = { ...raw, freshenHold: value };
        current = Object.freeze({
          ...current,
          freshen: Object.freeze(parsePulseSettings(raw.freshen, value))
        });
        break;
      }
      case "debug": {
        const value = source.readDebug();
        raw = { ...raw, debug: value };
        current = Object.freeze({ ...current, debug: value });
        break;
      }
      case "lazy-pinned": {
        const value = source.readLazyPinnedWanted();
        raw = { ...raw, lazyPinnedWanted: value };
        current = Object.freeze({ ...current, lazyPinnedWanted: value });
        break;
      }
      case "status-button": {
        const value = source.readShowStatusButton();
        raw = { ...raw, showStatusButton: value };
        current = Object.freeze({ ...current, showStatusButton: value });
        break;
      }
    }
  };
  return {
    snapshot: () => ensure().snapshot,
    observe: (which, onChange) => source.observe(which, () => {
      refresh(which);
      onChange();
    }),
    probes: () => {
      if (!cachedProbes) {
        cachedProbes = Object.freeze(
          source.probes().map((probe) => Object.freeze({ ...probe }))
        );
      }
      return cachedProbes;
    }
  };
};
var observedNames = {
  match: PREF_MATCH,
  "lazy-pinned": PREF_LAZY_PINNED,
  freshen: PREF_FRESHEN,
  "freshen-hold": PREF_FRESHEN_HOLD,
  "crash-attempts": PREF_CRASH_ATTEMPTS,
  "crash-window": PREF_CRASH_WINDOW,
  debug: PREF_DEBUG,
  "status-button": PREF_SHOW_STATUS_BUTTON
};
var preferences = createCachedPreferences({
  readMatch: rawMatchList,
  readCrashAttempts: rawCrashAttempts,
  readCrashWindow: rawCrashWindow,
  readFreshenSeconds: rawFreshenSeconds,
  readFreshenHoldSeconds: rawFreshenHoldSeconds,
  readDebug: isDebug,
  readLazyPinnedWanted: isLazyPinnedWanted,
  readShowStatusButton: isStatusButtonWanted,
  observe: (which, onChange) => observePref(observedNames[which], onChange),
  probes: prefProbes
});

// ../../packages/sine-lifecycle/dist/sine-window.js
var bindSineWindowLifecycle = (target, owner) => {
  const stopForSine = () => owner.stop("sine-unload");
  const stopForWindow = () => owner.stop("window-unload");
  owner.defer(() => {
    target.removeEventListener("unload", stopForWindow, { capture: false });
  });
  target.addEventListener("unload", stopForWindow, { capture: false, once: true });
  const sineUnload = typeof target.addUnloadListener === "function" ? "registered" : "unavailable";
  if (sineUnload === "registered") {
    target.addUnloadListener?.(stopForSine);
  }
  return { sineUnload };
};

// src/platform/log.ts
var log = (...args) => {
  if (preferences.snapshot().debug) {
    console.log("[keep-loaded]", ...args);
  }
};
var logLazy = (detail) => {
  if (!preferences.snapshot().debug) {
    return;
  }
  const args = detail();
  if (args) {
    console.log("[keep-loaded]", ...args);
  }
};

// src/platform/sine.ts
var bindLifecycle = (owner) => {
  const binding = bindSineWindowLifecycle(window, owner);
  if (binding.sineUnload === "unavailable") {
    log("Sine did not expose addUnloadListener — native close cleanup remains active");
  }
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
var listeningState = (id) => {
  try {
    const current = service();
    return current ? Boolean(current.hasListenerFor(id)) : null;
  } catch {
    return null;
  }
};
var counters = /* @__PURE__ */ new WeakMap();
var createSocketWatchRegistry = () => ({
  watched: /* @__PURE__ */ new Map()
});
var isSocketWatchRegistry = (value) => typeof value === "object" && value !== null && "watched" in value && value.watched instanceof Map;
var watched = createSocketWatchRegistry().watched;
var socketWatchOwner = Object.freeze({});
var useSocketWatchRegistry = (registry) => {
  watched = registry.watched;
};
var counterFor = (tab) => {
  const existing = counters.get(tab);
  if (existing) {
    return existing;
  }
  const fresh = { open: 0, framesIn: 0, framesOut: 0, lastFrameAt: null };
  counters.set(tab, fresh);
  return fresh;
};
var ignoreSocketEvent = () => {
};
var listenerFor = (tab, isLive) => {
  const received = () => {
    if (!isLive()) {
      return;
    }
    const counter = counterFor(tab);
    counter.framesIn += 1;
    counter.lastFrameAt = Date.now();
  };
  const sent = () => {
    if (!isLive()) {
      return;
    }
    const counter = counterFor(tab);
    counter.framesOut += 1;
    counter.lastFrameAt = Date.now();
  };
  return {
    webSocketCreated: ignoreSocketEvent,
    // Only fires for a socket that opens *after* attaching, which a long-lived one
    // never will — the count is a bonus, not the signal (D020).
    webSocketOpened: () => {
      if (isLive()) {
        counterFor(tab).open += 1;
      }
    },
    webSocketMessageAvailable: ignoreSocketEvent,
    webSocketClosed: () => {
      if (!isLive()) {
        return;
      }
      const counter = counterFor(tab);
      counter.open = Math.max(0, counter.open - 1);
    },
    frameReceived: received,
    frameSent: sent
  };
};
var removeEntry = (tab, entry) => {
  try {
    const before = listeningState(entry.id);
    if (before === null) {
      return false;
    }
    if (before) {
      const svc = service();
      if (!svc) {
        return false;
      }
      svc.removeListener(entry.id, entry.listener);
      if (listeningState(entry.id) !== false) {
        return false;
      }
    }
    if (watched.get(tab) === entry) {
      watched.delete(tab);
    }
    return true;
  } catch (error) {
    console.error("[keep-loaded] could not stop watching sockets", error);
    return false;
  }
};
var stopWatching = (tab) => {
  const entry = watched.get(tab);
  if (!entry || entry.owner !== socketWatchOwner) {
    return;
  }
  removeEntry(tab, entry);
};
var stopWatchingSocket = (tab) => {
  stopWatching(tab);
};
var watchSockets = (tabs, isLive) => {
  if (!isLive()) {
    return;
  }
  const svc = service();
  if (!svc) {
    return;
  }
  const wanted = new Set(tabs);
  for (const [tab, entry] of watched) {
    if (!isLive()) {
      return;
    }
    const listening = listeningState(entry.id);
    if (!wanted.has(tab) || listening === false || entry.owner !== socketWatchOwner) {
      if (!isLive()) {
        return;
      }
      removeEntry(tab, entry);
    }
  }
  for (const tab of tabs) {
    if (!isLive()) {
      return;
    }
    const id = tab.linkedPanel ? tab.linkedBrowser?.innerWindowID ?? null : null;
    if (id === null) {
      continue;
    }
    const existing = watched.get(tab);
    if (existing?.id === id && existing.owner === socketWatchOwner) {
      continue;
    }
    if (!isLive()) {
      return;
    }
    if (existing) {
      removeEntry(tab, existing);
    }
    if (watched.has(tab)) {
      continue;
    }
    const listener = listenerFor(tab, isLive);
    try {
      svc.addListener(id, listener);
      watched.set(tab, { id, listener, owner: socketWatchOwner });
      if (!isLive()) {
        stopWatching(tab);
      }
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
    watching: entry ? listeningState(entry.id) !== false : false,
    open: counter?.open ?? 0,
    framesIn: counter?.framesIn ?? 0,
    framesOut: counter?.framesOut ?? 0,
    lastFrameAt: counter?.lastFrameAt ?? null
  };
};
var socketProbes = () => [
  { name: SERVICE, present: Boolean(service()), required: false }
];

// src/core/capabilities.ts
function reportCapabilities(probes) {
  const missing = (required) => probes.filter((p) => p.required === required && !p.present).map((p) => p.name);
  const missingRequired = missing(true);
  const missingOptional = missing(false);
  let message = "";
  if (missingRequired.length) {
    message = `Zen no longer provides ${missingRequired.join(", ")} — not sweeping. This mod depends on private APIs.`;
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
  const state = [
    facts.pending ? "pending" : "not pending",
    facts.remote ? "remote" : "non-remote",
    facts.connected ? "browser connected" : "browser detached"
  ].join(", ");
  return {
    message: `${subject}: ${restartRequired ? MISMATCH : "content process crashed"}`,
    recoverable: !restartRequired,
    lines: [
      `state: ${state}`,
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

// src/core/labels.ts
function labelStep(facts) {
  if (!facts.kept) {
    return { action: "skip", reason: "not a tab the mod keeps" };
  }
  if (facts.pending) {
    return { action: "skip", reason: "asleep, so it has no page to take a title from" };
  }
  if (facts.renamed) {
    return { action: "skip", reason: "renamed by hand, so its label is not the page's" };
  }
  if (facts.managed) {
    return { action: "skip", reason: "Zen is keeping its label up to date already" };
  }
  const title = facts.title.trim();
  if (!title) {
    return { action: "skip", reason: "its page has no title yet" };
  }
  if (title === facts.label.trim()) {
    return { action: "skip", reason: "its label already matches its page" };
  }
  return { action: "write", reason: "its label is behind its page" };
}
function labelSummary(outcomes) {
  const written = outcomes.filter((outcome) => outcome.step.action === "write");
  if (!written.length) {
    return null;
  }
  return {
    message: `titles: ${written.length} relabelled`,
    lines: written.map((outcome) => `${outcome.url}: ${outcome.step.reason}`)
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

// src/core/liveness.ts
var SECOND = 1e3;
var MINUTE = 60 * SECOND;
var HOUR = 60 * MINUTE;
function isLifeSign(kind, state) {
  return kind !== "label" || !(state.pending || state.crashedPage);
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

// src/core/actions.ts
function wakeButtonState(facts) {
  if (facts.busy) {
    return { label: "Waking…", disabled: true };
  }
  if (!facts.kept) {
    return { label: "Nothing to wake", disabled: true };
  }
  if (!facts.sleeping) {
    return { label: "All kept tabs are awake", disabled: true };
  }
  const tabs = facts.sleeping === 1 ? "tab" : "tabs";
  return { label: `Wake ${facts.sleeping} sleeping ${tabs}`, disabled: false };
}

// src/core/panel-presentation.ts
var hasCrashedRow = (report) => report.groups.some((group) => group.rows.some((row) => row.state === "crashed"));
function panelPresentation(input) {
  switch (input.kind) {
    case "loading":
      return {
        action: { disabled: true, label: "Checking…", visible: true },
        content: { kind: "lines", lines: ["Checking kept tabs…"] },
        kind: "loading",
        feedback: null,
        reset: {
          disabled: true,
          label: "Reset crash recovery history",
          visible: false
        }
      };
    case "stopped":
      return { kind: "stopped" };
    case "unavailable":
      return {
        action: { disabled: true, label: "Unavailable", visible: true },
        content: {
          kind: "lines",
          lines: [
            "Status unavailable",
            "Keep Loaded couldn’t inspect tabs. Check the Browser Console for details."
          ]
        },
        kind: "unavailable",
        feedback: null,
        reset: {
          disabled: true,
          label: "Reset crash recovery history",
          visible: false
        }
      };
    case "snapshot": {
      const button = wakeButtonState({
        busy: input.busy,
        kept: input.kept,
        sleeping: input.sleeping
      });
      const content = { kind: "report", report: input.report };
      const crashed = hasCrashedRow(input.report);
      const visible = input.kept > 0 && (input.busy || input.sleeping > 0 || !crashed);
      const action = visible ? {
        ...button,
        label: input.busy ? input.busyActionLabel : button.label,
        visible: true
      } : { disabled: true, label: "", visible: false };
      const controls = {
        feedback: input.feedback ?? input.progress,
        reset: {
          disabled: !input.hasRecoveryAttempts,
          label: "Reset crash recovery history",
          visible: input.hasRecoveryAttempts
        }
      };
      if (!input.kept) {
        return { action, content, kind: "empty", ...controls };
      }
      if (input.busy) {
        return { action, content, kind: "busy", ...controls };
      }
      return {
        action,
        content,
        kind: crashed ? "recovery" : "ready",
        ...controls
      };
    }
  }
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
  let state = null;
  try {
    state = JSON.parse(json);
  } catch {
    return "";
  }
  const entries = state?.entries;
  if (!Array.isArray(entries) || !entries.length) {
    return "";
  }
  const requested = typeof state?.index === "number" ? state.index : entries.length;
  const index = Math.min(Math.max(requested - 1, 0), entries.length - 1);
  const url = entries[index]?.url;
  return typeof url === "string" ? url : "";
}

// src/core/rows.ts
var QUIET_MS = 15 * 60 * 1e3;
var RANK = ["crashed", "asleep", "unseen", "quiet", "alive"];
var STATE_LABEL = {
  alive: "Awake",
  asleep: "Sleeping",
  crashed: "Crashed",
  quiet: "Quiet",
  unseen: "No signal yet"
};
var SUMMARY = {
  alive: (count) => `${count} awake`,
  asleep: (count) => `${count} sleeping`,
  crashed: (count) => `${count} ${count === 1 ? "needs" : "need"} attention`,
  quiet: (count) => `${count} quiet`,
  unseen: (count) => `${count} awaiting signal`
};
var SIGN_WORDS = {
  awake: "Live browser",
  label: "Title changed",
  discarded: "Unloaded",
  crashed: "Crashed",
  "restart-required": "Restart required"
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
  if (facts.last?.kind === "restart-required") {
    return "Restart Zen to recover this tab";
  }
  if (facts.last?.kind === "crashed") {
    const { active, attempts, maxAttempts } = facts.recovery;
    if (maxAttempts === 0) {
      return "Automatic recovery is off";
    }
    if (attempts >= maxAttempts) {
      return `Recovery limit reached · ${attempts} of ${maxAttempts} attempts used`;
    }
    if (active) {
      return `Recovering · attempt ${Math.max(1, attempts)} of ${maxAttempts}`;
    }
  }
  const parts = [];
  parts.push(
    facts.last ? `${SIGN_WORDS[facts.last.kind]} ${formatAge(now - facts.last.at)}` : "No sign yet"
  );
  const frames = facts.frames;
  if (!frames) {
    if (!facts.pending) {
      parts.push("WebSocket status unavailable");
    }
  } else if (frames.in + frames.out > 0) {
    const age = frames.lastAt === null ? "recently" : formatAge(now - frames.lastAt);
    parts.push(`WebSocket activity ${age}`);
  }
  return parts.join(" · ");
};
var rowOf = (facts, now) => {
  const state = stateOf(facts, now);
  return {
    // A url the mod could not resolve still has to occupy a row, or the tab silently
    // vanishes from a panel whose whole job is saying what is kept.
    title: shortUrl(facts.url) || "(url unknown)",
    url: facts.url,
    state,
    stateLabel: STATE_LABEL[state],
    detail: detailOf(facts, now)
  };
};
var byConcern2 = (a, b) => RANK.indexOf(a.state) - RANK.indexOf(b.state);
function panelReport(facts, now) {
  if (!facts.length) {
    return {
      total: "Keep a pinned tab awake",
      summary: "Add sites in Sine settings, or use Keep loaded in a pinned tab’s menu.",
      groups: []
    };
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
  const tally = RANK.filter((state) => counts.get(state)).map(
    (state) => SUMMARY[state](counts.get(state) ?? 0)
  );
  return {
    total: `${facts.length} kept ${facts.length === 1 ? "tab" : "tabs"}`,
    summary: tally.join(" · "),
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
  return {
    action: "wake",
    message: busy ? `${url} was unloaded — queuing a reconciliation` : `${url} was unloaded — waking it again`
  };
}

// src/platform/browser.ts
var { SessionStore } = ChromeUtils.importESModule("resource:///modules/sessionstore/SessionStore.sys.mjs");
var TAB_FLAG = "zenKeepLoaded";
var MARKER_ATTR = "zen-keep-loaded";
var closedWakeCandidates = /* @__PURE__ */ new WeakSet();
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
var factsFor = (tab, pending = isPending(tab)) => ({
  space: spaceOf(tab),
  url: urlFor(tab),
  pending,
  flagged: SessionStore.getCustomTabValue(tab, TAB_FLAG) === "true"
});
var setFlag = (tab, keep, current) => {
  const target = keep ? "true" : "false";
  const present = current ?? SessionStore.getCustomTabValue(tab, TAB_FLAG) === "true";
  if (present !== keep) {
    SessionStore.setCustomTabValue(tab, TAB_FLAG, target);
  }
};
var setMarker = (tab, kept) => {
  if (kept) {
    if (tab.getAttribute(MARKER_ATTR) !== "true") {
      tab.setAttribute(MARKER_ATTR, "true");
    }
  } else if (tab.getAttribute(MARKER_ATTR) !== null) {
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
  if (tab.undiscardable !== true) {
    tab.undiscardable = true;
  }
};
var insertBrowser = (tab) => {
  window.gBrowser._insertBrowser(tab);
};
var wakeCandidateState = (tab) => {
  if (tab.isConnected === false || closedWakeCandidates.has(tab)) {
    return "gone";
  }
  if (!isPending(tab)) {
    return "started";
  }
  return tab.linkedPanel ? "inserted-pending" : "lazy";
};
var rollbackWakeCandidate = (tab) => {
  if (wakeCandidateState(tab) !== "inserted-pending") {
    return true;
  }
  if (window.closed) {
    SessionStore.resetBrowserToLazyState(tab);
    closedWakeCandidates.add(tab);
    return true;
  }
  window.gBrowser.discardBrowser(tab, true);
  return wakeCandidateState(tab) !== "inserted-pending";
};
var resetToLazy = (tab, url) => {
  window.gBrowser.updateBrowserRemotenessByURL(tab.linkedBrowser, url);
  return window.gBrowser.discardBrowser(tab, true);
};
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
      name: "SessionStore.resetBrowserToLazyState",
      present: typeof SessionStore.resetBrowserToLazyState === "function",
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
      required: true
    },
    {
      // Read off the selected browser because it is the one browser certain to exist.
      // Not required: losing it costs the freshness pulse and nothing else (D027).
      name: "browser.docShellIsActive",
      present: !!window.gBrowser.selectedBrowser && "docShellIsActive" in window.gBrowser.selectedBrowser,
      required: false
    },
    {
      // Not required: losing it costs the title repair and nothing else (D028).
      name: "gBrowser.setTabTitle",
      present: typeof window.gBrowser.setTabTitle === "function",
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

// src/platform/docshell.ts
var docShellState = (tab) => {
  try {
    if (!tab.isConnected || !tab.linkedPanel) {
      return "gone";
    }
    const browser = tab.linkedBrowser;
    if (!browser || !("docShellIsActive" in browser)) {
      return "unknown";
    }
    return browser.docShellIsActive === true ? "active" : "inactive";
  } catch {
    return "unknown";
  }
};
var setDocShellActive = (tab, active) => {
  const browser = tab.linkedPanel ? tab.linkedBrowser : null;
  if (!browser || !("docShellIsActive" in browser)) {
    return false;
  }
  try {
    const target = active ? "active" : "inactive";
    if (docShellState(tab) === target) {
      return true;
    }
    browser.docShellIsActive = active;
    return docShellState(tab) === target;
  } catch (error) {
    console.error("[keep-loaded] could not change a tab's docshell activity", error);
    return false;
  }
};

// src/platform/label.ts
var TITLE_EVENT = "pagetitlechanged";
var pageTitle = (tab) => {
  if (!tab.linkedPanel) {
    return "";
  }
  try {
    return tab.linkedBrowser?.contentTitle ?? "";
  } catch {
    return "";
  }
};
var tabLabel = (tab) => tab.getAttribute("label") ?? "";
var isRenamed = (tab) => typeof tab.zenStaticLabel === "string" && tab.zenStaticLabel !== "";
var isLabelManaged = (tab) => tab._zenContentsVisible === true;
var writeLabelFromPage = (tab) => {
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
var observeTitleChanges = (onChanged) => {
  const handler = (event) => {
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

// src/platform/liveness.ts
var signs = /* @__PURE__ */ new WeakMap();
var signFor = (tab) => signs.get(tab) ?? null;
var recordSign = (tab, kind) => {
  const previous2 = signs.get(tab);
  const recorded = Object.freeze({ kind, at: Date.now() });
  signs.set(tab, recorded);
  if (previous2 && previous2.kind !== kind) {
    const facts = factsFor(tab);
    if (shouldKeep(facts, preferences.snapshot().match)) {
      log(`${facts.url}: ${previous2.kind} -> ${kind}`);
    }
  }
  return recorded;
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
var observeSigns = (isLive, onCrash2, onDiscard2, onRecoveryInvalidated, onTabSelected) => {
  const document = window.document;
  const onTabEvent = (event) => {
    if (!isLive()) {
      return;
    }
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
    if (!isLive()) {
      return;
    }
    recordSign(tab, kind);
    if (kind === "discarded" && isLive()) {
      onDiscard2?.(tab);
    }
  };
  const onBrowserEvent = (event) => {
    if (!isLive()) {
      return;
    }
    const kind = BROWSER_EVENTS[event.type];
    const browser = event.target;
    if (!kind || !browser) {
      return;
    }
    const tab = window.gBrowser.getTabForBrowser(browser);
    if (!tab?.pinned) {
      return;
    }
    if (!isLive()) {
      return;
    }
    recordSign(tab, kind);
    if (isLive()) {
      onCrash2?.(tab, kind);
    }
  };
  const onRecoveryInvalidatedEvent = (event) => {
    if (!isLive()) {
      return;
    }
    const tab = event.target;
    if (tab && isLive()) {
      onRecoveryInvalidated?.(tab);
    }
  };
  const onTabSelectedEvent = (event) => {
    if (!isLive()) {
      return;
    }
    const tab = event.target;
    if (!tab?.pinned || !isLive()) {
      return;
    }
    onTabSelected?.(tab);
  };
  for (const type of Object.keys(TAB_EVENTS)) {
    document.addEventListener(type, onTabEvent);
  }
  for (const type of Object.keys(BROWSER_EVENTS)) {
    document.addEventListener(type, onBrowserEvent);
  }
  for (const type of ["TabClose", "TabUnpinned"]) {
    document.addEventListener(type, onRecoveryInvalidatedEvent);
  }
  document.addEventListener("TabSelect", onTabSelectedEvent);
  return () => {
    for (const type of Object.keys(TAB_EVENTS)) {
      document.removeEventListener(type, onTabEvent);
    }
    for (const type of Object.keys(BROWSER_EVENTS)) {
      document.removeEventListener(type, onBrowserEvent);
    }
    for (const type of ["TabClose", "TabUnpinned"]) {
      document.removeEventListener(type, onRecoveryInvalidatedEvent);
    }
    document.removeEventListener("TabSelect", onTabSelectedEvent);
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
var installKeepMenuItem = (isLive, state, toggle) => {
  if (!isLive()) {
    return () => {
    };
  }
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
    if (!isLive()) {
      return;
    }
    if (event.target !== menu) {
      return;
    }
    const tab = TabContextMenu.contextTab;
    if (!tab) {
      item.hidden = true;
      return;
    }
    const next = state(tab);
    if (!isLive()) {
      return;
    }
    item.hidden = !tab.pinned;
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
    if (!isLive()) {
      return;
    }
    const tab = TabContextMenu.contextTab;
    if (tab && isLive()) {
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

// src/platform/panel-render.ts
var BODY_ID = "keep-loaded-panel-body";
var WAKE_ID = "keep-loaded-wake-button";
var RESET_ID = "keep-loaded-reset-button";
var FEEDBACK_ID = "keep-loaded-panel-feedback";
var labelNode = (document, className, value) => {
  const label = document.createXULElement("label");
  label.className = className;
  label.setAttribute("value", value);
  return label;
};
var bodyOf = (view) => view.querySelector(`#${BODY_ID}`);
var actionOf = (view) => view.querySelector(`#${WAKE_ID}`);
var resetOf = (view) => view.querySelector(`#${RESET_ID}`);
var feedbackOf = (view) => view.querySelector(`#${FEEDBACK_ID}`);
var messageNodes = (document, lines, kind) => {
  const summary = document.createXULElement("vbox");
  summary.className = kind === "unavailable" ? "keep-loaded-panel-summary keep-loaded-panel-message" : "keep-loaded-panel-summary";
  const [total, detail] = lines;
  if (total) {
    summary.appendChild(labelNode(document, "keep-loaded-panel-total", total));
  }
  if (detail) {
    summary.appendChild(labelNode(document, "keep-loaded-panel-summary-line", detail));
  }
  return [summary];
};
var reportNodes = (document, report) => {
  const summary = document.createXULElement("vbox");
  summary.className = "keep-loaded-panel-summary";
  summary.appendChild(labelNode(document, "keep-loaded-panel-total", report.total));
  summary.appendChild(
    labelNode(document, "keep-loaded-panel-summary-line", report.summary)
  );
  const nodes = [summary];
  const groups = document.createXULElement("vbox");
  groups.className = "keep-loaded-panel-groups";
  for (const group of report.groups) {
    const section = document.createXULElement("vbox");
    section.className = "keep-loaded-panel-group";
    section.appendChild(labelNode(document, "keep-loaded-space", group.space));
    for (const row of group.rows) {
      const box = document.createXULElement("vbox");
      box.className = "keep-loaded-row";
      box.setAttribute("data-state", row.state);
      if (row.state === "crashed") {
        box.setAttribute("data-severity", "critical");
      } else if (row.state === "asleep") {
        box.setAttribute("data-severity", "attention");
      }
      if (row.url) {
        box.setAttribute("tooltiptext", row.url);
      }
      const head = document.createXULElement("hbox");
      head.className = "keep-loaded-row-head";
      head.appendChild(labelNode(document, "keep-loaded-row-title", row.title));
      const spacer = document.createXULElement("spacer");
      spacer.setAttribute("flex", "1");
      head.appendChild(spacer);
      head.appendChild(labelNode(document, "keep-loaded-row-state", row.stateLabel));
      box.appendChild(head);
      if (row.detail) {
        box.appendChild(labelNode(document, "keep-loaded-row-detail", row.detail));
      }
      section.appendChild(box);
    }
    groups.appendChild(section);
  }
  if (report.groups.length > 0) {
    nodes.push(groups);
  }
  return nodes;
};
var renderPanelPresentation = (view, presentation) => {
  if (presentation.kind === "stopped") {
    return false;
  }
  const body = bodyOf(view);
  const action = actionOf(view);
  const reset = resetOf(view);
  const feedback = feedbackOf(view);
  if (!body || !action || !reset || !feedback) {
    return false;
  }
  const nodes = presentation.content.kind === "report" ? reportNodes(body.ownerDocument, presentation.content.report) : messageNodes(
    body.ownerDocument,
    presentation.content.lines,
    presentation.kind === "unavailable" ? "unavailable" : "loading"
  );
  action.setAttribute("disabled", "true");
  if (presentation.action.visible) {
    action.removeAttribute("hidden");
  } else {
    action.setAttribute("hidden", "true");
  }
  body.replaceChildren(...nodes);
  action.setAttribute("label", presentation.action.label);
  if (!presentation.action.disabled) {
    action.removeAttribute("disabled");
  }
  reset.setAttribute("label", presentation.reset.label);
  reset.setAttribute("disabled", "true");
  if (presentation.reset.visible) {
    reset.removeAttribute("hidden");
    if (!presentation.reset.disabled) {
      reset.removeAttribute("disabled");
    }
  } else {
    reset.setAttribute("hidden", "true");
  }
  feedback.setAttribute("value", presentation.feedback ?? "");
  if (presentation.feedback) {
    feedback.removeAttribute("hidden");
  } else {
    feedback.setAttribute("hidden", "true");
  }
  view.setAttribute("data-presentation", presentation.kind);
  return true;
};

// src/platform/panel.ts
var BUTTON_ID = "keep-loaded-button";
var VIEW_ID = "keep-loaded-panelview";
var CACHE_ID = "appMenu-viewCache";
var AREA = "zen-sidebar-foot-buttons";
var VIEW_XUL = `
  <panelview id="${VIEW_ID}"
             class="PanelUI-subView keep-loaded-panelview"
             mainview-with-header="true">
    <box class="panel-header">
      <html:h1><html:span>Keep Loaded</html:span></html:h1>
    </box>
    <toolbarseparator/>
    <vbox id="${BODY_ID}" class="panel-subview-body"/>
    <toolbarseparator/>
    <vbox class="keep-loaded-panel-footer">
      <toolbarbutton id="${WAKE_ID}"
                     class="subviewbutton panel-subview-footer-button keep-loaded-wake-button"
                     closemenu="none"/>
      <toolbarbutton id="${RESET_ID}"
                     class="subviewbutton panel-subview-footer-button keep-loaded-reset-button"
                     closemenu="none"
                     hidden="true"
                     disabled="true"/>
      <label id="${FEEDBACK_ID}"
             class="keep-loaded-panel-feedback"
             role="status"
             aria-live="polite"
             aria-atomic="true"
             hidden="true"/>
    </vbox>
  </panelview>
`;
var viewCache = (document) => document.getElementById(CACHE_ID);
var removeExistingView = (document) => {
  document.getElementById(VIEW_ID)?.remove();
  viewCache(document)?.content.querySelector(`#${VIEW_ID}`)?.remove();
};
var installStatusPanel = (actions) => {
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
  removeExistingView(document);
  cache.content.appendChild(window.MozXULElement.parseXULToFragment(VIEW_XUL));
  const view = cache.content.querySelector(`#${VIEW_ID}`);
  let active = true;
  const isLive = () => actions.isLive?.() ?? true;
  const isCurrentView = (event) => active && isLive() && event.target === view;
  const show = (event) => {
    if (!isCurrentView(event) || !view) {
      return false;
    }
    actions.onViewShowing?.(view);
    return true;
  };
  if (view) {
    renderPanelPresentation(view, panelPresentation({ kind: "loading" }));
    view.querySelector(`#${WAKE_ID}`)?.addEventListener("command", () => {
      if (!active || !isLive()) {
        return;
      }
      actions.onWake(view);
    });
    view.querySelector(`#${RESET_ID}`)?.addEventListener("command", () => {
      if (!active || !isLive()) {
        return;
      }
      actions.onReset?.(view);
    });
    actions.onViewReady?.(view);
  }
  const createWidget = (onViewShowing) => {
    if (!active || widgetDestroyed) {
      return;
    }
    const existing = ui.getWidget(BUTTON_ID);
    if (existing?.provider === ui.PROVIDER_API) {
      return;
    }
    ui.createWidget({
      id: BUTTON_ID,
      type: "view",
      viewId: VIEW_ID,
      localized: false,
      label: "Keep Loaded",
      tooltiptext: "Tabs being kept loaded, and when each was last alive",
      defaultArea: AREA,
      // The stable application owner owns this callback. It selects an exact current
      // panel host instead of retaining the cache-busted window generation that first
      // registered the widget (D040).
      onViewShowing
    });
  };
  let widgetDestroyed = false;
  const destroyOwnedWidget = () => {
    if (widgetDestroyed) {
      return;
    }
    widgetDestroyed = true;
    try {
      ui.destroyWidget(BUTTON_ID);
    } catch (error) {
      console.error("[keep-loaded] could not remove the status button", error);
    }
  };
  const destroyWidget = () => {
    if (!active) {
      return;
    }
    destroyOwnedWidget();
  };
  let lease;
  const dispose = (scope = "application") => {
    if (!active) {
      return;
    }
    try {
      if (lease) {
        lease.release();
      } else if (scope === "application") {
        destroyWidget();
      }
    } finally {
      active = false;
      view?.remove();
    }
  };
  try {
    const host = {
      create: createWidget,
      destroy: destroyOwnedWidget,
      fail: (error) => actions.onWidgetError?.(error),
      show
    };
    if (actions.widgetOwner) {
      lease = actions.widgetOwner.acquireStatusWidget(host);
    } else {
      createWidget((event) => {
        show(event);
      });
    }
  } catch (error) {
    try {
      if (lease) {
        lease.release();
      } else {
        destroyWidget();
      }
    } finally {
      active = false;
      view?.remove();
    }
    throw error;
  }
  if (!isLive()) {
    dispose();
  }
  return (scope) => {
    dispose(scope);
  };
};

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

// src/runtime.ts
var WAKE_TIMEOUT_MS = 2e4;
var POLL_MS = 100;
var controller;
var settings = preferences;
var pulses;
var application = null;
var applicationOwner2;
var panelView = null;
var panelFeedback = null;
var cachedCapabilities = null;
var expectedRecoveryUnload = null;
var withExpectedRecoveryUnload = (tab, token, action) => {
  const previous2 = expectedRecoveryUnload;
  const current = Object.freeze({ tab, token });
  expectedRecoveryUnload = current;
  try {
    return action();
  } finally {
    if (expectedRecoveryUnload === current) {
      expectedRecoveryUnload = previous2;
    }
  }
};
var isExpectedRecoveryUnload = (tab) => {
  const expected = expectedRecoveryUnload;
  return expected !== null && expected.tab === tab && controller.isCurrentOperation(expected.token);
};
var wakeAll = async (tabs, token, context) => {
  if (!controller.isCurrentOperation(token) || !context.isCurrent()) {
    return "canceled";
  }
  const candidates = tabs.map(
    (tab) => Object.freeze({
      key: tab,
      insert: () => insertBrowser(tab),
      rollback: () => withExpectedRecoveryUnload(tab, token, () => rollbackWakeCandidate(tab)),
      state: () => wakeCandidateState(tab)
    })
  );
  return context.wakeCandidates(candidates, {
    pollMs: POLL_MS,
    retryLimit: 1,
    timeoutMs: WAKE_TIMEOUT_MS
  });
};
var recover = async (tab, facts, context) => {
  if (!context.isCurrent() || !controller.isLive()) {
    return;
  }
  const currentTabs = pinnedTabs();
  if (!currentTabs.includes(tab) || !tab.pinned || !isPending(tab)) {
    return;
  }
  const currentPolicyFacts = factsFor(tab);
  const preferenceSnapshot = settings.snapshot();
  if (!shouldKeep(currentPolicyFacts, preferenceSnapshot.match)) {
    return;
  }
  const ownerRegistration = application;
  if (!ownerRegistration) {
    return;
  }
  const now = Date.now();
  const windowMs = preferenceSnapshot.crashWindowMs;
  const maxAttempts = preferenceSnapshot.crashAttempts;
  const spent = ownerRegistration.recentRecoveryAttempts(tab, now, windowMs);
  const plan = recoveryPlan(facts, { attempts: spent, now, windowMs, maxAttempts });
  log(`${facts.url}: ${plan.reason}`);
  if (plan.action === "skip") {
    return;
  }
  const outcome = await controller.runRecovery(
    tab,
    { pollMs: POLL_MS, timeoutMs: WAKE_TIMEOUT_MS },
    async (token) => {
      if (!controller.isCurrentOperation(token) || !context.isCurrent()) {
        return;
      }
      const attemptAt = Date.now();
      if (ownerRegistration.chargeRecoveryAttempt(tab, attemptAt, windowMs) === false) {
        return;
      }
      if (plan.action === "reset-then-wake" && !withExpectedRecoveryUnload(tab, token, () => resetToLazy(tab, facts.url))) {
        log(`${facts.url}: the browser refused to discard, so it stays crashed`);
        return;
      }
      const wake = await wakeAll([tab], token, context);
      if (!controller.isCurrentOperation(token) || !context.isCurrent()) {
        return;
      }
      if (wake === "failed") {
        throw new Error(`${facts.url}: wake transaction failed after rollback`);
      }
      if (wake === "canceled") {
        return;
      }
      if (isPending(tab)) {
        log(`${facts.url}: still pending after recovery`);
        return;
      }
      recordSign(tab, "awake");
    }
  );
  if (outcome === "timed-out") {
    log(`${facts.url}: gave up waiting for a sweep to finish`);
  }
};
var sweep = async (token, context) => {
  if ((await controller.wait(whenSessionRestored())).kind === "stopped") {
    return;
  }
  if ((await controller.wait(whenSpacesReady())).kind === "stopped") {
    return;
  }
  if (!controller.isCurrentOperation(token) || !context.isCurrent()) {
    return;
  }
  if (!cachedCapabilities) {
    cachedCapabilities = Object.freeze(
      [...settings.probes(), ...browserProbes(), ...socketProbes()].map(
        (probe) => Object.freeze({ ...probe })
      )
    );
  }
  const capabilities = reportCapabilities(cachedCapabilities);
  if (!capabilities.ok) {
    console.error(`[keep-loaded] ${capabilities.message}`);
    return;
  }
  if (capabilities.message) {
    log(capabilities.message);
  }
  const preferenceSnapshot = settings.snapshot();
  const laziness = planLazyPinned(
    preferenceSnapshot.lazyPinnedWanted,
    context.readOnDemand()
  );
  context.reconcileOnDemand(preferenceSnapshot.lazyPinnedWanted);
  if (laziness.set !== null) {
    log(laziness.message);
  }
  let inventory = takeInventory();
  logLazy(() => {
    const summary = sweepSummary(
      inventory.pinned.map(({ facts }) => facts),
      inventory.kept.map(({ facts }) => facts)
    );
    return [summary.message, summary.kept];
  });
  for (const { kept, tab } of inventory.pinned) {
    setMarker(tab, kept);
    if (kept) {
      markUndiscardable(tab);
    }
  }
  const asleep = inventory.kept.filter(({ facts }) => facts.pending);
  if (asleep.length) {
    const wake = await wakeAll(
      asleep.map(({ tab }) => tab),
      token,
      context
    );
    if (!controller.isCurrentOperation(token) || !context.isCurrent()) {
      return;
    }
    logLazy(() => {
      const stuck = asleep.filter(({ tab }) => isPending(tab));
      return [
        wakeSummary(
          asleep.length,
          stuck.map(({ facts }) => facts.url)
        )
      ];
    });
    if (wake === "failed") {
      throw new Error("one or more wake candidates failed after rollback");
    }
    if (wake === "canceled") {
      return;
    }
    inventory = takeInventory();
  }
  const liveness2 = inventory.kept.map(recordOf);
  logLazy(() => {
    const summary = livenessSummary(liveness2, Date.now());
    return [summary.message, summary.lines];
  });
  watchSockets(
    inventory.kept.map(({ tab }) => tab),
    () => controller.isLive()
  );
  logLazy(() => {
    const summary = socketSummary(socketRecords(inventory.kept), Date.now());
    return [summary.message, summary.lines];
  });
  relabelAll(inventory.pinned);
};
var pinnedWithVerdict = () => {
  const matchers = settings.snapshot().match;
  return pinnedTabs().map((tab) => {
    const facts = factsFor(tab);
    return { tab, facts, kept: shouldKeep(facts, matchers) };
  });
};
var takeInventory = () => {
  const pinned = pinnedWithVerdict();
  return { pinned, kept: pinned.filter((item) => item.kept) };
};
var keptTabs = () => takeInventory().kept;
var socketRecords = (candidates = keptTabs()) => candidates.map(({ tab, facts }) => socketRecordFor(tab, facts.space, facts.url));
var recordOf = ({ tab, facts }) => {
  let last = signFor(tab);
  if (!last && !facts.pending) {
    last = recordSign(tab, "awake");
  }
  return { space: facts.space, url: facts.url, last };
};
var runSweep = async () => {
  const registration = application;
  if (!controller.isLive() || !registration) {
    return;
  }
  const outcome = await registration.requestSweep().done;
  if (outcome === "failed" && controller.isLive()) {
    log("an application wake failed — see the Browser Console");
  }
};
var PULSE_OFF = { everyMs: 0, holdMs: 0 };
var ownedPulseRecord = (tab) => {
  if (pulses.owned) {
    return pulses.owned(tab, controller);
  }
  const record = pulses.get(tab);
  return pulses.active(controller).some(([candidate]) => candidate === tab) ? record : { heldSince: null, lastPulseAt: record.lastPulseAt };
};
var dropPulseClaim = (tab, owner = controller) => {
  if (!tab.isConnected || !tab.pinned) {
    return pulses.remove(tab, owner);
  }
  return pulses.forget(tab, owner);
};
var pulseSettings = () => settings.snapshot().freshen;
var applyPulse = (tab, step, now) => {
  switch (step.action) {
    case "activate":
      if (!pulses.set(tab, controller, { heldSince: now, lastPulseAt: now })) {
        return { action: "skip", reason: "another generation owns its docshell claim" };
      }
      if (!setDocShellActive(tab, true)) {
        const state = docShellState(tab);
        if (state === "gone" || state === "inactive") {
          stopWatchingSocket(tab);
          dropPulseClaim(tab);
        }
        return { action: "skip", reason: "its docshell refused to activate" };
      }
      return step;
    case "release":
      return releasePulseClaim(tab) ? step : { action: "skip", reason: "its docshell refused to release" };
    // Nothing is written: the docshell stopped being ours, so the claim is all there
    // is to drop. `lastPulseAt` stays, so the tab waits out its interval as usual.
    case "forget":
      stopWatchingSocket(tab);
      dropPulseClaim(tab);
      return step;
    default:
      return step;
  }
};
function releaseOwnedPulseClaim(tab, owner) {
  if (!pulses.active(owner).some(([candidate]) => candidate === tab)) {
    return true;
  }
  let state;
  try {
    state = docShellState(tab);
    if (tab.selected) {
      stopWatchingSocket(tab);
      dropPulseClaim(tab, owner);
      return true;
    }
  } catch (error) {
    console.error("[keep-loaded] could not inspect a pulse claim for cleanup", error);
    return false;
  }
  if (state === "gone" || state === "inactive") {
    stopWatchingSocket(tab);
    dropPulseClaim(tab, owner);
    return true;
  }
  if (state === "unknown" || !setDocShellActive(tab, false)) {
    return false;
  }
  const after = docShellState(tab);
  if (after !== "inactive" && after !== "gone") {
    return false;
  }
  dropPulseClaim(tab, owner);
  return true;
}
function releasePulseClaim(tab) {
  return releaseOwnedPulseClaim(tab, controller);
}
var releaseOrphanedPulseClaims = () => {
  for (const [tab, owner] of pulses.allActive()) {
    if (owner === controller) {
      continue;
    }
    try {
      releaseOwnedPulseClaim(tab, owner);
    } catch (error) {
      console.error(
        "[keep-loaded] unresolved old pulse claim could not be retried",
        error
      );
    }
  }
};
var pulseOnce = (_settings) => {
  for (const [tab] of pulses.active(controller)) {
    try {
      releasePulseClaim(tab);
    } catch (error) {
      console.error("[keep-loaded] pulse cleanup failed", error);
    }
  }
};
var waitPulseHold = (delayMs, context) => {
  if (delayMs <= 0) {
    return Promise.resolve("elapsed");
  }
  return new Promise((resolve) => {
    let settled = false;
    let cancel = () => {
    };
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      context.signal.removeEventListener("abort", onAbort);
      cancel();
      resolve(result);
    };
    const onAbort = () => finish("canceled");
    context.signal.addEventListener("abort", onAbort, { once: true });
    try {
      cancel = controller.schedule(
        delayMs,
        () => finish(controller.isLive() ? "elapsed" : "stopped")
      );
    } catch (error) {
      console.error("[keep-loaded] freshness hold could not be scheduled", error);
      finish("stopped");
    }
    if (context.signal.aborted) {
      finish("canceled");
    }
  });
};
var pulseCycle = async (schedule, context) => {
  const outcomes = [];
  const visited = /* @__PURE__ */ new Set();
  const candidates = pinnedWithVerdict();
  for (const { tab } of candidates) {
    if (!context.isCurrent() || !controller.isLive()) {
      return;
    }
    if (!isPulsing(pulseSettings())) {
      return;
    }
    visited.add(tab);
    let facts;
    let kept;
    try {
      facts = factsFor(tab);
      kept = tab.pinned && shouldKeep(facts, settings.snapshot().match);
    } catch {
      releaseTabResources(tab);
      application?.invalidateTab(tab);
      continue;
    }
    if (!kept) {
      releaseTabResources(tab);
      application?.invalidateTab(tab);
      continue;
    }
    const record = ownedPulseRecord(tab);
    const shellState = docShellState(tab);
    const step = pulseStep(
      {
        url: facts.url,
        kept,
        pending: facts.pending,
        selected: tab.selected,
        // Unknown is not permission to activate an unowned docshell or forget an
        // owned one. Only a proven inactive/gone state is safe to treat as inactive.
        active: shellState === "active" || shellState === "unknown",
        heldSince: record.heldSince,
        lastPulseAt: record.lastPulseAt
      },
      schedule,
      controller.now()
    );
    const actual = applyPulse(tab, step, controller.now());
    outcomes.push({ url: facts.url, step: actual });
    if (actual.action !== "activate") {
      continue;
    }
    let hold = "stopped";
    let released = true;
    try {
      hold = await waitPulseHold(schedule.holdMs, context);
    } finally {
      released = releasePulseClaim(tab);
    }
    if (released) {
      outcomes.push({
        url: facts.url,
        step: {
          action: "release",
          reason: `its ${schedule.holdMs / 1e3}s pulse is up`
        }
      });
    }
    if (hold !== "elapsed" || !released || !context.isCurrent() || !controller.isLive() || !isPulsing(pulseSettings())) {
      return;
    }
  }
  for (const [tab] of pulses.active(controller)) {
    if (!visited.has(tab)) {
      releasePulseClaim(tab);
    }
  }
  logLazy(() => {
    const report = pulseSummary(outcomes);
    return report ? [report.message, report.lines] : null;
  });
};
var releaseTabResources = (tab) => {
  stopWatchingSocket(tab);
  releasePulseClaim(tab);
};
var releaseIneligibleResources = () => {
  const matchers = settings.snapshot().match;
  for (const tab of pinnedTabs()) {
    try {
      if (!tab.pinned || !shouldKeep(factsFor(tab), matchers)) {
        releaseTabResources(tab);
        application?.invalidateTab(tab);
      }
    } catch {
      releaseTabResources(tab);
      application?.invalidateTab(tab);
    }
  }
  for (const [tab] of pulses.active(controller)) {
    if (!tab.pinned) {
      releaseTabResources(tab);
      application?.invalidateTab(tab);
    }
  }
};
var syncPulse = () => {
  if (!controller.isLive()) {
    return;
  }
  const settings2 = pulseSettings();
  application?.setPulseSchedule(settings2);
  if (!isPulsing(settings2)) {
    log("freshness: off");
    pulseOnce(PULSE_OFF);
    return;
  }
  log(
    `freshness: running each kept tab's page for ${settings2.holdMs / 1e3}s every ${settings2.everyMs / 1e3}s`
  );
  void application?.requestPulse().done;
};
var relabel = (tab, facts, kept, state = {
  managed: isLabelManaged(tab),
  pending: facts.pending,
  renamed: isRenamed(tab)
}) => {
  const step = labelStep({
    url: facts.url,
    kept,
    pending: state.pending,
    title: pageTitle(tab),
    label: tabLabel(tab),
    renamed: state.renamed,
    managed: state.managed
  });
  if (step.action !== "write") {
    return step;
  }
  return writeLabelFromPage(tab) ? step : { action: "skip", reason: "its label refused to change" };
};
var relabelAll = (candidates = pinnedWithVerdict()) => {
  const outcomes = candidates.map(({ tab, facts, kept }) => ({
    url: facts.url,
    step: relabel(tab, facts, kept)
  }));
  logLazy(() => {
    const report = labelSummary(outcomes);
    return report ? [report.message, report.lines] : null;
  });
};
var relabelOne = (tab) => {
  if (!tab.pinned) {
    return;
  }
  try {
    const state = {
      managed: isLabelManaged(tab),
      pending: isPending(tab),
      renamed: isRenamed(tab)
    };
    if (state.pending || state.renamed || state.managed) {
      return;
    }
    const facts = factsFor(tab, state.pending);
    relabel(tab, facts, shouldKeep(facts, settings.snapshot().match), state);
  } catch (error) {
    console.error("[keep-loaded] could not bring a tab's title up to date", error);
  }
};
var onCrash = (tab, kind) => {
  if (!controller.isLive()) {
    return;
  }
  try {
    if (!shouldKeep(factsFor(tab), settings.snapshot().match)) {
      return;
    }
    const facts = crashFactsFor(tab, kind);
    logLazy(() => {
      const diagnosis = crashDiagnosis(facts);
      return [diagnosis.message, diagnosis.lines];
    });
    void application?.requestRecovery(tab, facts).done;
  } catch (error) {
    console.error("[keep-loaded] crash diagnosis failed", error);
  }
};
var onDiscard = (tab) => {
  if (!controller.isLive()) {
    return;
  }
  releaseTabResources(tab);
  if (isExpectedRecoveryUnload(tab)) {
    return;
  }
  try {
    const facts = factsFor(tab);
    const kept = shouldKeep(facts, settings.snapshot().match);
    const plan = unloadPlan({
      url: facts.url,
      kept,
      // Unset until the first sweep takes the lock, which is not running.
      busy: controller.isBusy()
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
var onSystemWake = (topic, data) => {
  if (!controller.isLive()) {
    return;
  }
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
var liveness = () => controller.isLive() ? keptTabs().map(recordOf) : [];
var panelFacts = (now) => {
  const rows = [];
  let sleeping = 0;
  const snapshot = settings.snapshot();
  const operation = controller.state.kind === "live" ? controller.state.operation : null;
  for (const { tab, facts } of keptTabs()) {
    if (facts.pending) {
      sleeping += 1;
    }
    const socket = socketRecordFor(tab, facts.space, facts.url);
    rows.push({
      // Zen's own space name, unlike the log lines: a panel is read by a person.
      space: spaceNameFor(tab),
      url: facts.url,
      pending: facts.pending,
      // `recordOf`, not `signFor`: a tab with a live browser and no sign yet is alive
      // enough to record, and seeding it here keeps the panel and the console command
      // saying the same thing about the same tab.
      last: recordOf({ tab, facts }).last,
      frames: socket.watching ? { in: socket.framesIn, out: socket.framesOut, lastAt: socket.lastFrameAt } : null,
      recovery: {
        active: operation?.kind === "recovery" && operation.tab === tab,
        attempts: application?.recentRecoveryAttempts(tab, now, snapshot.crashWindowMs).length ?? 0,
        maxAttempts: snapshot.crashAttempts
      }
    });
  }
  return { rows, sleeping };
};
var fillPanel = (view) => {
  if (!controller.isLive() || view !== panelView) {
    return;
  }
  try {
    const now = Date.now();
    const facts = panelFacts(now);
    const owner = applicationOwner2.snapshot();
    const localOperation = controller.state.kind === "live" ? controller.state.operation : null;
    const progress = owner.activeKind ? owner.activeKind === "recovery" ? localOperation?.kind === "recovery" ? `Recovering ${shortUrl(factsFor(localOperation.tab).url) || "kept tab"}…` : "Recovering a kept tab…" : owner.activeKind === "pulse" ? "Refreshing kept tabs…" : facts.sleeping > 0 ? `Waking ${facts.sleeping} sleeping ${facts.sleeping === 1 ? "tab" : "tabs"}…` : "Checking kept tabs…" : null;
    renderPanelPresentation(
      view,
      panelPresentation({
        kind: "snapshot",
        kept: facts.rows.length,
        progress,
        report: panelReport(facts.rows, now),
        sleeping: facts.sleeping,
        busy: application?.isApplicationBusy() ?? controller.isBusy(),
        busyActionLabel: owner.activeKind === "recovery" ? "Recovering…" : owner.activeKind === "pulse" ? "Refreshing…" : "Waking…",
        feedback: panelFeedback,
        hasRecoveryAttempts: application?.hasRecoveryAttempts() ?? false
      })
    );
  } catch (error) {
    console.error("[keep-loaded] could not fill the status panel", error);
    renderPanelPresentation(view, panelPresentation({ kind: "unavailable" }));
  }
};
var sockets = () => {
  if (!controller.isLive()) {
    return { summary: "Keep Loaded is not running in this window", tabs: [] };
  }
  const records = socketRecords();
  return { summary: socketSummary(records, Date.now()).message, tabs: records };
};
var initialized = false;
var createKeepLoadedRuntime = ({
  application: ownerApplication,
  owner,
  preferences: preferencePort = preferences,
  pulseClaims: pulseClaims2
}) => {
  if (initialized) {
    throw new Error("Keep Loaded runtime already has a controller generation");
  }
  initialized = true;
  controller = owner;
  applicationOwner2 = ownerApplication;
  settings = preferencePort;
  cachedCapabilities = null;
  pulses = pulseClaims2;
  panelView = null;
  panelFeedback = null;
  const start = async () => {
    if (!controller.isLive()) {
      return;
    }
    releaseOrphanedPulseClaims();
    controller.defer(() => log("unloaded"));
    controller.defer(() => {
      for (const tab of pinnedTabs()) {
        setMarker(tab, false);
      }
    });
    controller.defer(
      settings.observe("match", () => {
        if (!controller.isLive()) {
          return;
        }
        releaseIneligibleResources();
        log("allowlist changed — re-sweeping");
        void runSweep();
      })
    );
    controller.defer(
      settings.observe("lazy-pinned", () => {
        if (!controller.isLive()) {
          return;
        }
        application?.reconcileOnDemand(settings.snapshot().lazyPinnedWanted);
        log("lazy pinned tabs setting changed — re-sweeping");
        void runSweep();
      })
    );
    for (const preference of ["crash-attempts", "crash-window", "debug"]) {
      controller.defer(settings.observe(preference, () => {
      }));
    }
    controller.defer(() => pulseOnce(PULSE_OFF));
    controller.defer(
      observeTitleChanges((tab) => {
        if (controller.isLive()) {
          relabelOne(tab);
        }
      })
    );
    for (const preference of ["freshen", "freshen-hold"]) {
      controller.defer(
        settings.observe(preference, () => {
          if (controller.isLive()) {
            syncPulse();
          }
        })
      );
    }
    controller.defer(
      observeSigns(
        () => controller.isLive(),
        onCrash,
        onDiscard,
        (tab) => {
          releaseTabResources(tab);
          application?.invalidateTab(tab);
        },
        (tab) => {
          releaseTabResources(tab);
          application?.invalidateTab(tab);
        }
      )
    );
    for (const topic of WAKE_TOPICS) {
      controller.defer(observeTopic(topic, (data) => onSystemWake(topic, data)));
    }
    const registration = applicationOwner2.register({
      isLive: () => controller.isLive(),
      pulse: (context) => pulseCycle(pulseSettings(), context),
      sweep: async (context) => {
        const outcome = await controller.runSweep((token) => sweep(token, context));
        if (outcome === "busy") {
          throw new Error("application owner invoked a busy window sweep");
        }
      },
      recover: (context, tab, facts) => recover(tab, facts, context),
      refreshStatusPanel: () => {
        if (panelView) {
          fillPanel(panelView);
        }
      },
      reportError: (error) => {
        console.error("[keep-loaded] application work failed", error);
      }
    });
    application = registration;
    let panelResource = null;
    const disposePanelResource = () => {
      const current = panelResource;
      if (!current) {
        return false;
      }
      panelResource = null;
      if (panelView === current.view) {
        panelView = null;
      }
      current.dispose();
      return true;
    };
    const installPanelResource = () => {
      if (!controller.isLive() || panelResource) {
        return false;
      }
      let installedView = null;
      const dispose = installStatusPanel({
        widgetOwner: registration,
        isLive: () => controller.isLive(),
        onViewReady: (view) => {
          installedView = view;
          panelView = view;
        },
        onViewShowing: (view) => fillPanel(view),
        onWidgetError: (error) => {
          console.error("[keep-loaded] status widget creation failed", error);
          controller.stop("startup-failure");
        },
        onReset: (view) => {
          if (!controller.isLive() || view !== panelView) {
            return;
          }
          if (registration.resetRecoveryAttempts()) {
            panelFeedback = "Crash recovery history reset for this Zen session";
            fillPanel(view);
          }
        },
        onWake: (view) => {
          if (!controller.isLive()) {
            return;
          }
          const wake = runSweep();
          void controller.settlePanel(
            wake,
            () => fillPanel(view),
            (error) => {
              console.error("[keep-loaded] waking from the panel failed", error);
              fillPanel(view);
            }
          );
        }
      });
      if (!controller.isLive()) {
        dispose();
        return false;
      }
      panelResource = Object.freeze({ dispose, view: installedView });
      return true;
    };
    controller.defer(disposePanelResource);
    controller.defer(
      settings.observe("status-button", () => {
        if (!controller.isLive()) {
          return;
        }
        if (settings.snapshot().showStatusButton) {
          try {
            installPanelResource();
          } catch (error) {
            console.error("[keep-loaded] status widget creation failed", error);
            controller.stop("startup-failure");
          }
        } else {
          disposePanelResource();
        }
      })
    );
    if (settings.snapshot().showStatusButton) {
      try {
        installPanelResource();
      } catch (error) {
        disposePanelResource();
        registration.dispose("generation-ended");
        if (application === registration) {
          application = null;
        }
        throw error;
      }
    }
    controller.defer(stopWatchingSockets);
    controller.defer(
      installKeepMenuItem(
        () => controller.isLive(),
        (tab) => keepMenuState(factsFor(tab), settings.snapshot().match),
        (tab) => {
          if (!controller.isLive()) {
            return;
          }
          const facts = factsFor(tab);
          setFlag(tab, !facts.flagged, facts.flagged);
          if (facts.flagged) {
            releaseTabResources(tab);
            application?.invalidateTab(tab);
          }
          log(`${facts.flagged ? "released" : "kept"} ${facts.url}`);
          void runSweep();
        }
      )
    );
    controller.defer(() => {
      registration.dispose(
        controller.stopReason === "window-unload" ? "window-closed" : "generation-ended"
      );
      if (application === registration) {
        application = null;
      }
    });
    await runSweep();
    if (controller.isLive()) {
      syncPulse();
    }
  };
  return {
    application: () => ({
      registrationId: application?.id ?? null,
      snapshot: applicationOwner2.snapshot()
    }),
    start,
    runSweep,
    fillPanel,
    liveness,
    sockets
  };
};

// src/main.ts
if (typeof DisposableStack !== "function") {
  throw new Error("Keep Loaded requires the DisposableStack available in Firefox 153");
}
var previous = window.zenKeepLoaded;
var previousSocketWatchers = previous?.socketWatchers;
previous?.controller?.stop("replacement");
var previousPulses = previous?.pulses;
var pulseClaims = previousPulses && typeof previousPulses.active === "function" && typeof previousPulses.activeCount === "function" && typeof previousPulses.allActive === "function" && typeof previousPulses.forget === "function" && typeof previousPulses.remove === "function" && typeof previousPulses.set === "function" ? previousPulses : new PulseClaims();
var socketWatchers = isSocketWatchRegistry(previousSocketWatchers) ? previousSocketWatchers : createSocketWatchRegistry();
useSocketWatchRegistry(socketWatchers);
var controller2 = new KeepLoadedController({
  now: ChromeUtils.now,
  timers: {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (handle) => window.clearTimeout(handle)
  },
  onDisposeError: (error) => {
    console.error("[keep-loaded] generation cleanup failed", error);
  }
});
var runtime = createKeepLoadedRuntime({
  application: applicationOwner,
  owner: controller2,
  preferences,
  pulseClaims
});
var facade = Object.freeze({
  controller: controller2,
  application: () => ({ applicationId, ...runtime.application() }),
  pulses: pulseClaims,
  socketWatchers,
  fillPanel: (view) => runtime.fillPanel(view),
  liveness: () => runtime.liveness(),
  sockets: () => runtime.sockets()
});
window.zenKeepLoaded = facade;
controller2.defer(() => {
  if (window.zenKeepLoaded === facade) {
    window.zenKeepLoaded = Object.freeze({ pulses: pulseClaims, socketWatchers });
  }
});
bindLifecycle(controller2);
try {
  await runtime.start();
} catch (error) {
  controller2.stop("startup-failure");
  throw error;
}
