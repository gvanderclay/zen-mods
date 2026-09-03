// Generated from src/ by build.mjs — do not edit.

// src/core/path.ts
var PALETTE_PATH_PREFERENCE = "zen.palette-bridge.path";
var DEFAULT_PALETTE_RELATIVE_PATH = ["chrome", "palette-bridge.json"];
var resolvePalettePath = (profileDirectory, overridePath, joinPath) => overridePath === "" ? joinPath(profileDirectory, ...DEFAULT_PALETTE_RELATIVE_PATH) : overridePath;

// src/platform/file.ts
var createPaletteFilePort = ({
  joinPath,
  overridePath,
  profileDirectory,
  readJson
}) => ({
  currentPath: () => resolvePalettePath(profileDirectory, overridePath(), joinPath),
  read: readJson
});
var createFirefoxPaletteFilePort = () => {
  const profileDirectory = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
  return createPaletteFilePort({
    joinPath: (...segments) => PathUtils.join(...segments),
    overridePath: () => Services.prefs.getStringPref(PALETTE_PATH_PREFERENCE, ""),
    profileDirectory,
    readJson: (path) => IOUtils.readJSON(path)
  });
};

// src/platform/preferences.ts
var observePalettePath = (store, changed) => {
  let live = true;
  const observer = {
    observe: () => {
      if (live) changed();
    }
  };
  store.addObserver(PALETTE_PATH_PREFERENCE, observer);
  return () => {
    if (!live) return;
    live = false;
    store.removeObserver(PALETTE_PATH_PREFERENCE, observer);
  };
};

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

// src/platform/sine.ts
var startPaletteBridgeGeneration = ({
  controller: controller2,
  generationToken: generationToken2,
  onSineUnloadUnavailable,
  target
}) => {
  target.zenPaletteBridge?.controller.stop("replacement");
  const facade = Object.freeze({ controller: controller2, generationToken: generationToken2 });
  target.zenPaletteBridge = facade;
  controller2.defer(() => {
    if (target.zenPaletteBridge === facade) {
      delete target.zenPaletteBridge;
    }
  });
  try {
    const binding = bindSineWindowLifecycle(target, controller2);
    if (binding.sineUnload === "unavailable") {
      onSineUnloadUnavailable?.();
    }
  } catch (error) {
    controller2.stop("startup-failure");
    throw error;
  }
  return facade;
};

// src/core/property-ledger.ts
var equal = (left, right) => left.value === right.value && left.priority === right.priority;
var planPropertyApply = (previous, current, next) => ({
  ownership: {
    baseline: previous && equal(current, previous.applied) ? previous.baseline : current,
    applied: next
  },
  write: !equal(current, next)
});
var planPropertyRestore = (ownership, current) => equal(current, ownership.applied) ? { kind: "restore", value: ownership.baseline } : { kind: "leave" };

// src/platform/styles.ts
var PALETTE_GENERATION_ATTRIBUTE = "zen-palette-bridge-generation";
var snapshot = (style, name) => ({
  value: style.getPropertyValue(name),
  priority: style.getPropertyPriority(name)
});
var OwnedStyleProperties = class {
  #properties = /* @__PURE__ */ new Map();
  apply(target, name, value) {
    let properties = this.#properties.get(target);
    if (!properties) {
      properties = /* @__PURE__ */ new Map();
      this.#properties.set(target, properties);
    }
    const current = snapshot(target.style, name);
    const next = { value, priority: "important" };
    const plan = planPropertyApply(properties.get(name), current, next);
    properties.set(name, plan.ownership);
    if (plan.write) {
      target.style.setProperty(name, next.value, next.priority);
    }
  }
  restore() {
    const errors = [];
    for (const [target, properties] of this.#properties) {
      for (const [name, ownership] of properties) {
        try {
          const plan = planPropertyRestore(ownership, snapshot(target.style, name));
          if (plan.kind === "leave") {
            continue;
          }
          if (plan.value.value === "") {
            target.style.removeProperty(name);
          } else {
            target.style.setProperty(name, plan.value.value, plan.value.priority);
          }
        } catch (error) {
          errors.push(error);
        }
      }
    }
    this.#properties.clear();
    if (errors.length > 0) {
      throw new AggregateError(errors, "could not restore Palette Bridge styles");
    }
  }
};
var rootProperties = (palette) => [
  ["--zen-palette-bridge-color-scheme", palette.mode],
  ["--zen-primary-color", palette.accent],
  ["--zen-branding-bg", palette.mainBackground],
  ["--zen-branding-bg-reverse", palette.strongForeground],
  ["--zen-colors-primary", palette.secondarySurface],
  ["--zen-colors-secondary", palette.secondarySurface],
  ["--zen-colors-tertiary", palette.mainBackground],
  ["--zen-colors-hover-bg", palette.selectionSurface],
  ["--zen-colors-primary-foreground", palette.strongForeground],
  ["--zen-colors-border", palette.border],
  ["--zen-colors-border-contrast", palette.border],
  ["--zen-colors-input-bg", palette.secondarySurface],
  ["--zen-dialog-background", palette.secondarySurface],
  ["--zen-urlbar-background", palette.secondarySurface],
  ["--zen-urlbar-background-base", palette.secondarySurface],
  ["--zen-urlbar-background-transparent", palette.secondarySurface],
  ["--zen-toolbar-element-bg", palette.secondarySurface],
  ["--zen-toolbar-element-bg-hover", palette.selectionSurface],
  ["--zen-themed-toolbar-bg-transparent", palette.mainBackground],
  ["--toolbox-textcolor", palette.normalForeground],
  ["--toolbox-textcolor-inactive", palette.mutedForeground],
  ["--toolbar-color-scheme", palette.mode],
  ["--toolbar-field-color", palette.normalForeground],
  ["--toolbar-field-background-color", palette.secondarySurface],
  ["--toolbarbutton-icon-fill", palette.normalForeground],
  ["--arrowpanel-background", palette.secondarySurface],
  ["--arrowpanel-color", palette.normalForeground],
  ["--panel-separator-color", palette.border]
];
var createPaletteStyleView = ({
  browserBackground,
  generationToken: generationToken2,
  root,
  toolbarBackground,
  workspaces
}) => {
  const owned = new OwnedStyleProperties();
  let live = true;
  return {
    apply: (palette) => {
      if (!live) {
        return false;
      }
      for (const [name, value] of rootProperties(palette)) {
        owned.apply(root, name, value);
      }
      owned.apply(
        browserBackground,
        "--zen-main-browser-background",
        palette.mainBackground
      );
      owned.apply(
        toolbarBackground,
        "--zen-main-browser-background-toolbar",
        palette.mainBackground
      );
      for (const workspace of workspaces()) {
        owned.apply(workspace, "color-scheme", palette.mode);
        owned.apply(workspace, "--toolbox-textcolor", palette.normalForeground);
        owned.apply(workspace, "--zen-primary-color", palette.accent);
        owned.apply(
          workspace,
          "--tab-background-color-selected",
          palette.selectionSurface
        );
        owned.apply(workspace, "--tab-selected-textcolor", palette.normalForeground);
      }
      root.setAttribute(PALETTE_GENERATION_ATTRIBUTE, generationToken2);
      return true;
    },
    dispose: () => {
      if (!live) {
        return false;
      }
      live = false;
      const errors = [];
      try {
        if (root.getAttribute(PALETTE_GENERATION_ATTRIBUTE) === generationToken2) {
          root.removeAttribute(PALETTE_GENERATION_ATTRIBUTE);
        }
      } catch (error) {
        errors.push(error);
      }
      try {
        owned.restore();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, "could not dispose Palette Bridge styles");
      }
      return true;
    }
  };
};
var createZenPaletteStyleView = (document, generationToken2) => {
  const browserBackground = document.getElementById("zen-browser-background");
  const toolbarBackground = document.getElementById("zen-toolbar-background");
  if (!browserBackground || !toolbarBackground) {
    throw new Error("Zen browser background elements are unavailable");
  }
  return createPaletteStyleView({
    browserBackground,
    generationToken: generationToken2,
    root: document.documentElement,
    toolbarBackground,
    workspaces: () => Array.from(document.querySelectorAll("zen-workspace"))
  });
};

// src/platform/window.ts
var isPaletteWindowEligible = (root) => !root.hasAttribute("zen-private-window") && !root.hasAttribute("zen-unsynced-window");

// src/platform/zen-topics.ts
var ZEN_PALETTE_UPDATE_TOPICS = [
  "zen-space-gradient-update",
  "zen-theme-change"
];
var zenPaletteUpdateTopics = new Set(ZEN_PALETTE_UPDATE_TOPICS);
var removeTopics = (store, observer, topics) => {
  const errors = [];
  for (const topic of topics) {
    try {
      store.removeObserver(observer, topic);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "could not remove Zen palette observers");
  }
};
var observeZenPaletteUpdates = (store, changed) => {
  let live = true;
  const observer = {
    observe: (_subject, topic) => {
      if (live && zenPaletteUpdateTopics.has(topic)) changed();
    }
  };
  const registered = [];
  try {
    for (const topic of ZEN_PALETTE_UPDATE_TOPICS) {
      store.addObserver(observer, topic);
      registered.push(topic);
    }
  } catch (registrationError) {
    live = false;
    try {
      removeTopics(store, observer, registered);
    } catch (cleanupError) {
      throw new AggregateError(
        [registrationError, cleanupError],
        "could not register Zen palette observers"
      );
    }
    throw registrationError;
  }
  return () => {
    if (!live) return;
    live = false;
    removeTopics(store, observer, registered);
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

// src/core/palette.ts
var PALETTE_COLOR_FIELDS = [
  "accent",
  "mainBackground",
  "secondarySurface",
  "selectionSurface",
  "border",
  "normalForeground",
  "mutedForeground",
  "strongForeground"
];
var COLOR_PATTERN = /^#[0-9a-f]{6}$/;
var PALETTE_FIELDS = /* @__PURE__ */ new Set([
  "schemaVersion",
  "displayName",
  "mode",
  ...PALETTE_COLOR_FIELDS
]);
var paletteIdentity = (palette) => JSON.stringify([
  palette.schemaVersion,
  palette.displayName ?? null,
  palette.mode,
  ...PALETTE_COLOR_FIELDS.map((field) => palette[field])
]);
var parsePalette = (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "palette must be an object" };
  }
  const palette = value;
  if (palette.schemaVersion !== 1) {
    return { ok: false, error: "schemaVersion must be 1" };
  }
  if (palette.mode !== "dark" && palette.mode !== "light") {
    return { ok: false, error: "mode must be dark or light" };
  }
  if (palette.displayName !== void 0 && typeof palette.displayName !== "string") {
    return { ok: false, error: "displayName must be a string" };
  }
  const unexpectedField = Object.keys(palette).filter((field) => !PALETTE_FIELDS.has(field)).sort()[0];
  if (unexpectedField !== void 0) {
    return { ok: false, error: `unexpected field: ${unexpectedField}` };
  }
  for (const field of PALETTE_COLOR_FIELDS) {
    if (typeof palette[field] !== "string" || !COLOR_PATTERN.test(palette[field])) {
      return { ok: false, error: `${field} must be a lowercase #rrggbb color` };
    }
  }
  const validated = palette;
  return {
    ok: true,
    palette: {
      schemaVersion: 1,
      ...validated.displayName === void 0 ? {} : { displayName: validated.displayName },
      mode: validated.mode,
      accent: validated.accent,
      mainBackground: validated.mainBackground,
      secondarySurface: validated.secondarySurface,
      selectionSurface: validated.selectionSurface,
      border: validated.border,
      normalForeground: validated.normalForeground,
      mutedForeground: validated.mutedForeground,
      strongForeground: validated.strongForeground
    }
  };
};

// src/runtime.ts
var PALETTE_POLL_INTERVAL_MS = 1e3;
var failureIdentity = (error) => error instanceof Error ? `${error.name}:${error.message}` : String(error);
var PaletteBridgeController = class {
  #enqueueMicrotask;
  #eligible;
  #file;
  #onError;
  #onPaletteApplied;
  #scope;
  #view;
  #activePalette = null;
  #activePaletteIdentity = null;
  #lastUpdateFailure = null;
  #pathRevision = 0;
  #pollCancel = null;
  #readInFlight = false;
  #readRequested = false;
  #reapplyQueued = false;
  #reapplyRevision = 0;
  #started = false;
  #stopReason = null;
  constructor({
    eligible: eligible2,
    enqueueMicrotask,
    file,
    onError,
    onPaletteApplied,
    timers,
    view
  }) {
    if (eligible2 && (!file || !view)) {
      throw new Error("eligible Palette Bridge windows require file and style ports");
    }
    this.#enqueueMicrotask = enqueueMicrotask ?? ((callback) => globalThis.queueMicrotask(callback));
    this.#eligible = eligible2;
    this.#file = file ?? null;
    this.#onError = (error) => {
      try {
        onError?.(error);
      } catch {
      }
    };
    this.#onPaletteApplied = (palette) => {
      try {
        onPaletteApplied?.(palette);
      } catch {
      }
    };
    this.#scope = new GenerationScope({
      onDisposeError: this.#onError,
      timers
    });
    this.#view = view ?? null;
    if (eligible2) {
      this.#scope.defer(() => this.#view?.dispose());
    }
  }
  defer(disposer) {
    this.#scope.defer(disposer);
  }
  isLive() {
    return this.#scope.isLive();
  }
  snapshot() {
    return {
      activePaletteIdentity: this.#activePaletteIdentity,
      eligible: this.#eligible,
      live: this.isLive(),
      pendingTimers: this.#scope.pendingTimers,
      pendingWaits: this.#scope.pendingWaits,
      readInFlight: this.#readInFlight,
      readRequested: this.#readRequested,
      reapplyQueued: this.#reapplyQueued,
      started: this.#started,
      stopReason: this.#stopReason
    };
  }
  start() {
    if (this.#started || !this.isLive()) {
      return false;
    }
    this.#started = true;
    if (this.#eligible) {
      this.#beginRead();
    }
    return true;
  }
  pathChanged() {
    if (!this.#eligible || !this.#started || !this.isLive()) {
      return false;
    }
    this.#pathRevision += 1;
    this.#readRequested = true;
    this.#pollCancel?.();
    this.#pollCancel = null;
    if (!this.#readInFlight) {
      this.#beginRead();
    }
    return true;
  }
  requestReapply() {
    if (!this.#eligible || !this.isLive() || !this.#activePalette || this.#reapplyQueued) {
      return false;
    }
    this.#reapplyQueued = true;
    const revision = ++this.#reapplyRevision;
    try {
      this.#enqueueMicrotask(() => {
        if (!this.isLive() || revision !== this.#reapplyRevision) {
          return;
        }
        this.#reapplyQueued = false;
        const palette = this.#activePalette;
        const view = this.#view;
        if (!palette || !view) {
          return;
        }
        try {
          if (!view.apply(palette)) {
            throw new Error("palette style view is stopped");
          }
        } catch (error) {
          this.#onError(error);
          this.stop("platform-failure");
        }
      });
    } catch (error) {
      this.#reapplyQueued = false;
      this.#onError(error);
      this.stop("platform-failure");
      return false;
    }
    return true;
  }
  stop(reason = "manual") {
    if (!this.isLive()) {
      return false;
    }
    this.#stopReason = reason;
    this.#pollCancel = null;
    this.#readInFlight = false;
    this.#readRequested = false;
    this.#activePalette = null;
    this.#reapplyQueued = false;
    this.#reapplyRevision += 1;
    return this.#scope.stop();
  }
  #beginRead() {
    if (this.#readInFlight || !this.isLive()) {
      return;
    }
    this.#readInFlight = true;
    this.#readRequested = false;
    void this.#readAndSchedule(this.#pathRevision);
  }
  async #readAndSchedule(pathRevision) {
    await this.#loadOnce(pathRevision);
    this.#readInFlight = false;
    if (!this.isLive()) {
      return;
    }
    if (this.#readRequested) {
      this.#beginRead();
      return;
    }
    this.#pollCancel = this.#scope.schedule(PALETTE_POLL_INTERVAL_MS, () => {
      this.#pollCancel = null;
      this.#beginRead();
    });
  }
  async #loadOnce(pathRevision) {
    const file = this.#file;
    const view = this.#view;
    if (!file || !view) {
      return;
    }
    let value;
    try {
      const path = file.currentPath();
      const result = await this.#scope.wait(file.read(path));
      if (result.kind === "stopped") {
        return;
      }
      value = result.value;
    } catch (error) {
      if (this.isLive() && pathRevision === this.#pathRevision) {
        this.#reportUpdateFailure(`read:${failureIdentity(error)}`, error);
      }
      return;
    }
    if (!this.isLive() || pathRevision !== this.#pathRevision) {
      return;
    }
    const parsed = parsePalette(value);
    if (!parsed.ok) {
      this.#reportUpdateFailure(`validation:${parsed.error}`, new Error(parsed.error));
      return;
    }
    this.#lastUpdateFailure = null;
    const nextIdentity = paletteIdentity(parsed.palette);
    if (this.#activePaletteIdentity === nextIdentity) {
      return;
    }
    try {
      if (!view.apply(parsed.palette)) {
        throw new Error("palette style view is stopped");
      }
      this.#activePaletteIdentity = nextIdentity;
      this.#activePalette = parsed.palette;
      this.#onPaletteApplied(parsed.palette);
    } catch (error) {
      this.#onError(error);
      this.stop("platform-failure");
    }
  }
  #reportUpdateFailure(key, error) {
    if (this.#lastUpdateFailure === key) {
      return;
    }
    this.#lastUpdateFailure = key;
    this.#onError(error);
  }
};

// src/main.ts
window.zenPaletteBridge?.controller.stop("replacement");
var generationToken = window.crypto.randomUUID();
var eligible = isPaletteWindowEligible(window.document.documentElement);
var controller = new PaletteBridgeController({
  eligible,
  enqueueMicrotask: (callback) => window.queueMicrotask(callback),
  ...eligible ? {
    file: createFirefoxPaletteFilePort(),
    view: createZenPaletteStyleView(window.document, generationToken)
  } : {},
  onError: (error) => console.error("[palette-bridge] update skipped", error),
  onPaletteApplied: (palette) => console.info(
    `[palette-bridge] applied${palette.displayName ? `: ${palette.displayName}` : ""}`
  ),
  timers: {
    clearTimeout: (handle) => window.clearTimeout(handle),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs)
  }
});
startPaletteBridgeGeneration({
  controller,
  generationToken,
  onSineUnloadUnavailable: () => console.error("[palette-bridge] Sine unload hook is unavailable"),
  target: window
});
try {
  if (eligible) {
    controller.defer(observePalettePath(Services.prefs, () => controller.pathChanged()));
    controller.defer(
      observeZenPaletteUpdates(Services.obs, () => controller.requestReapply())
    );
  }
  if (!controller.start()) {
    throw new Error("Palette Bridge generation did not start");
  }
  console.info(`[palette-bridge] ready (${eligible ? "active" : "native"})`);
} catch (error) {
  controller.stop("startup-failure");
  throw error;
}
