// Generated from src/ by build.mjs — do not edit.

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

// src/core/settings.ts
var DEFAULT_SETTINGS = {
  placement: "top",
  thickness: 2,
  color: "firefox",
  revealDelayMs: 200
};

// src/platform/native-indicator.ts
var NATIVE_INDICATOR_OWNER_ATTRIBUTE = "data-zen-load-bar-owner";
var installNativeIndicatorHandoff = ({
  defer,
  document,
  token
}) => {
  if (token.length === 0) {
    throw new Error("Load Bar ownership token must not be empty");
  }
  const root = document.documentElement;
  if (root.getAttribute(NATIVE_INDICATOR_OWNER_ATTRIBUTE) !== null) {
    throw new Error("Zen loading indicator is already owned by another generation");
  }
  let owned = false;
  const release = () => {
    if (!owned) {
      return;
    }
    if (root.getAttribute(NATIVE_INDICATOR_OWNER_ATTRIBUTE) === token) {
      root.removeAttribute(NATIVE_INDICATOR_OWNER_ATTRIBUTE);
    }
    owned = false;
  };
  defer(release);
  owned = true;
  try {
    root.setAttribute(NATIVE_INDICATOR_OWNER_ATTRIBUTE, token);
  } catch (error) {
    try {
      release();
    } catch {
    }
    throw error;
  }
};

// src/platform/progress.ts
var createBrowserProgressSource = ({
  flags,
  isCanceledStatus,
  isLive,
  isSuccessStatus,
  tabs
}) => {
  const add = tabs.addTabsProgressListener;
  const getTab = tabs.getTabForBrowser;
  const remove = tabs.removeTabsProgressListener;
  if (typeof add !== "function" || typeof getTab !== "function" || typeof remove !== "function") {
    throw new Error("Zen tab progress API is unavailable");
  }
  return {
    currentLoadingBrowser: () => {
      const browser = tabs.selectedBrowser;
      if (!browser) {
        return null;
      }
      const tab = getTab.call(tabs, browser);
      return tab?.hasAttribute("busy") ? browser : null;
    },
    install: (listener) => {
      let active = true;
      const progressListener = {
        onStateChange: (browser, webProgress, _request, stateFlags, status) => {
          if (!active || !isLive() || !webProgress?.isTopLevel) {
            return;
          }
          const isNetwork = Boolean(stateFlags & flags.network);
          if (!isNetwork) {
            return;
          }
          if (stateFlags & flags.start) {
            const tab = getTab.call(tabs, browser);
            if (stateFlags & flags.restoring || !tab?.hasAttribute("busy")) {
              return;
            }
            listener({ kind: "begin", browser });
            return;
          }
          if (stateFlags & flags.stop) {
            const outcome = isSuccessStatus(status) ? "success" : isCanceledStatus(status) ? "canceled" : "network-error";
            listener({ kind: "finish", browser, outcome });
          }
        }
      };
      add.call(tabs, progressListener);
      return () => {
        if (!active) {
          return;
        }
        active = false;
        remove.call(tabs, progressListener);
      };
    }
  };
};

// src/platform/view.ts
var XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
var hasClass = (element, name) => (element.getAttribute("class") ?? "").split(/\s+/).includes(name);
var createPaneActivityView = ({
  browser,
  document,
  generationToken: generationToken2,
  getComputedStyle,
  settings = DEFAULT_SETTINGS,
  tabs
}) => {
  if (tabs.selectedBrowser !== browser) {
    return null;
  }
  const getTab = tabs.getTabForBrowser;
  if (typeof getTab !== "function") {
    throw new Error("Zen tab lookup API is unavailable");
  }
  const linkedPanel = getTab.call(tabs, browser)?.linkedPanel;
  const panel = linkedPanel ? document.getElementById(linkedPanel) : null;
  const browserContainer = panel ? [...panel.children].find((child) => hasClass(child, "browserContainer")) : null;
  if (!browserContainer) {
    throw new Error("Load Bar selected browser container is unavailable");
  }
  if (browserContainer.querySelector(":scope > .zen-load-bar")) {
    throw new Error("Load Bar selected browser container already has a Load Bar");
  }
  const root = document.createElementNS(XHTML_NAMESPACE, "div");
  const segment = document.createElementNS(XHTML_NAMESPACE, "div");
  root.setAttribute("class", "zen-load-bar");
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("data-zen-load-bar-generation", generationToken2);
  root.setAttribute("data-zen-load-bar-color", settings.color);
  root.setAttribute("data-zen-load-bar-placement", settings.placement);
  root.style.setProperty("--zen-load-bar-thickness", `${settings.thickness}px`);
  segment.setAttribute("class", "zen-load-bar__segment");
  root.append(segment);
  browserContainer.append(root);
  let active = true;
  let previous = null;
  return {
    dispose: () => {
      if (!active) {
        return;
      }
      active = false;
      root.remove();
    },
    render: (state) => {
      if (!active) {
        return;
      }
      const terminal = state.kind === "completing" || state.kind === "canceling";
      if (terminal && previous?.kind === "visible") {
        const transform = getComputedStyle(segment).transform;
        if (transform !== "none") {
          segment.style.setProperty("transform", transform);
        }
      } else if (state.kind === "waiting" || state.kind === "visible") {
        segment.style.removeProperty("transform");
      }
      root.setAttribute("data-zen-load-bar-state", state.kind);
      if (terminal) {
        root.setAttribute("data-zen-load-bar-outcome", state.outcome);
      } else {
        root.removeAttribute("data-zen-load-bar-outcome");
      }
      if (state.kind === "completing" && previous?.kind === "visible") {
        root.getBoundingClientRect();
        segment.style.removeProperty("transform");
      }
      previous = state;
    }
  };
};

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

// src/core/activity.ts
var IDLE_ACTIVITY = { kind: "idle" };
var reduceActivity = (state, event) => {
  if (event.kind === "begin") {
    return { kind: "waiting", token: event.token };
  }
  if (state.kind === "idle" || state.token !== event.token) {
    return state;
  }
  switch (event.kind) {
    case "reveal":
      return state.kind === "waiting" ? { kind: "visible", token: state.token } : state;
    case "finish":
      if (state.kind === "waiting") {
        return IDLE_ACTIVITY;
      }
      if (state.kind !== "visible") {
        return state;
      }
      return event.outcome === "success" ? { kind: "completing", token: state.token, outcome: event.outcome } : { kind: "canceling", token: state.token, outcome: event.outcome };
    case "settle":
      return state.kind === "completing" || state.kind === "canceling" ? IDLE_ACTIVITY : state;
  }
};

// src/runtime.ts
var LoadBarController = class {
  #createView;
  #onError;
  #progress;
  #records = /* @__PURE__ */ new Map();
  #revealDelayMs;
  #scope;
  #terminalDelayMs;
  #nextToken = 1;
  #started = false;
  #stopReason = null;
  constructor({
    createView,
    onError,
    progress: progress2,
    revealDelayMs,
    terminalDelayMs,
    timers
  }) {
    this.#createView = createView;
    this.#onError = (error) => {
      try {
        onError?.(error);
      } catch {
      }
    };
    this.#progress = progress2;
    this.#revealDelayMs = revealDelayMs;
    this.#terminalDelayMs = terminalDelayMs;
    this.#scope = new GenerationScope({
      onDisposeError: this.#onError,
      timers
    });
    this.#scope.defer(() => this.#disposeAllRecords());
  }
  get stopReason() {
    return this.#stopReason;
  }
  defer(disposer) {
    this.#scope.defer(disposer);
  }
  isLive() {
    return this.#scope.isLive();
  }
  snapshot() {
    return {
      activeRecords: this.#records.size,
      live: this.isLive(),
      pendingTimers: this.#scope.pendingTimers,
      pendingWaits: this.#scope.pendingWaits,
      started: this.#started,
      stopReason: this.#stopReason,
      visibleRecords: [...this.#records.values()].filter(
        (record) => record.state.kind !== "waiting"
      ).length
    };
  }
  start() {
    if (this.#started || !this.isLive()) {
      return false;
    }
    this.#started = true;
    const disposeProgress = this.#progress.install((event) => this.#receive(event));
    this.#scope.defer(disposeProgress);
    const current = this.#progress.currentLoadingBrowser();
    if (current) {
      this.#receive({ kind: "begin", browser: current });
      if (!this.isLive()) {
        throw new Error("Load Bar platform startup failed");
      }
    }
    return true;
  }
  stop(reason = "manual") {
    if (!this.isLive()) {
      return false;
    }
    this.#stopReason = reason;
    return this.#scope.stop();
  }
  #begin(browser) {
    let record = this.#records.get(browser);
    if (record?.state.kind === "waiting" || record?.state.kind === "visible") {
      return;
    }
    if (!record) {
      const view = this.#createView(browser);
      if (!view) {
        return;
      }
      record = {
        cancelReveal: null,
        cancelTerminal: null,
        state: IDLE_ACTIVITY,
        view
      };
      this.#records.set(browser, record);
    }
    this.#cancelTimers(record);
    const token = this.#nextToken++;
    record.state = reduceActivity(record.state, { kind: "begin", token });
    record.view.render(record.state);
    record.cancelReveal = this.#scope.schedule(this.#revealDelayMs, () => {
      record.cancelReveal = null;
      const next = reduceActivity(record.state, { kind: "reveal", token });
      if (next !== record.state) {
        record.state = next;
        record.view.render(next);
      }
    });
  }
  #cancelTimers(record) {
    for (const key of ["cancelReveal", "cancelTerminal"]) {
      const cancel = record[key];
      record[key] = null;
      if (!cancel) {
        continue;
      }
      try {
        cancel();
      } catch (error) {
        this.#onError(error);
      }
    }
  }
  #disposeAllRecords() {
    for (const browser of [...this.#records.keys()]) {
      this.#disposeRecord(browser);
    }
  }
  #disposeRecord(browser) {
    const record = this.#records.get(browser);
    if (!record) {
      return;
    }
    this.#records.delete(browser);
    this.#cancelTimers(record);
    try {
      record.view.dispose();
    } catch (error) {
      this.#onError(error);
    }
  }
  #finish(browser, outcome) {
    const record = this.#records.get(browser);
    if (!record) {
      return;
    }
    if (record.cancelReveal) {
      const cancel = record.cancelReveal;
      record.cancelReveal = null;
      cancel();
    }
    if (record.state.kind === "idle") {
      this.#disposeRecord(browser);
      return;
    }
    const token = record.state.token;
    const next = reduceActivity(record.state, { kind: "finish", token, outcome });
    if (next === record.state) {
      return;
    }
    record.state = next;
    if (next.kind === "idle") {
      this.#disposeRecord(browser);
      return;
    }
    record.view.render(next);
    record.cancelTerminal = this.#scope.schedule(this.#terminalDelayMs[outcome], () => {
      record.cancelTerminal = null;
      const settled = reduceActivity(record.state, { kind: "settle", token });
      if (settled.kind === "idle") {
        this.#disposeRecord(browser);
      }
    });
  }
  #receive(event) {
    if (!this.isLive()) {
      return;
    }
    try {
      if (event.kind === "begin") {
        this.#begin(event.browser);
      } else {
        this.#finish(event.browser, event.outcome);
      }
    } catch (error) {
      this.#onError(error);
      this.stop("platform-failure");
    }
  }
};

// src/main.ts
window.zenLoadBar?.controller.stop("replacement");
var generationToken = window.crypto.randomUUID();
var controller;
var progress = createBrowserProgressSource({
  flags: {
    network: Ci.nsIWebProgressListener.STATE_IS_NETWORK,
    restoring: Ci.nsIWebProgressListener.STATE_RESTORING,
    start: Ci.nsIWebProgressListener.STATE_START,
    stop: Ci.nsIWebProgressListener.STATE_STOP
  },
  isCanceledStatus: (status) => status === Cr.NS_BINDING_ABORTED,
  isLive: () => controller.isLive(),
  isSuccessStatus: (status) => Components.isSuccessCode(status),
  tabs: gBrowser
});
controller = new LoadBarController({
  createView: (browser) => createPaneActivityView({
    browser,
    document: window.document,
    generationToken,
    getComputedStyle: (element) => window.getComputedStyle(element),
    settings: DEFAULT_SETTINGS,
    tabs: gBrowser
  }),
  onError: (error) => console.error("[load-bar] generation failed", error),
  progress,
  revealDelayMs: DEFAULT_SETTINGS.revealDelayMs,
  terminalDelayMs: {
    success: 220,
    canceled: 160,
    "network-error": 160
  },
  timers: {
    clearTimeout: (handle) => window.clearTimeout(handle),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs)
  }
});
var facade = Object.freeze({ controller, generationToken });
window.zenLoadBar = facade;
controller.defer(() => {
  if (window.zenLoadBar === facade) {
    delete window.zenLoadBar;
  }
});
try {
  const binding = bindSineWindowLifecycle(window, controller);
  if (binding.sineUnload === "unavailable") {
    console.error("[load-bar] Sine unload hook is unavailable");
  }
  controller.start();
  installNativeIndicatorHandoff({
    defer: (disposer) => controller.defer(disposer),
    document: window.document,
    token: generationToken
  });
  console.info("[load-bar] ready");
} catch (error) {
  controller.stop("startup-failure");
  throw error;
}
