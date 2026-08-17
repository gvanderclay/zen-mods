// Generated from src/ by build.mjs — do not edit.

// src/platform/browser.ts
var popOutSelectedTab = () => {
  const selectedTab = gBrowser.selectedTab;
  if (!selectedTab) {
    return;
  }
  gBrowser.replaceTabWithWindow(selectedTab, {}, true);
};

// src/platform/shortcut.ts
var POP_OUT_SHORTCUT_ID = "pop-out-tab-key";
var POP_OUT_COMMAND_ID = "Pop Out Current Tab";
var BINDING_PREFERENCE = "zen.pop-out-tab.saved-binding";
var defaultBinding = () => ({
  key: "n",
  keycode: "",
  modifiers: {
    control: true,
    alt: false,
    shift: false,
    meta: true,
    accel: false
  }
});
var validModifiers = (value) => {
  if (!value || typeof value !== "object") return false;
  const candidate = value;
  return [
    candidate.control,
    candidate.alt,
    candidate.shift,
    candidate.meta,
    candidate.accel
  ].every((modifier) => typeof modifier === "boolean");
};
var parseBinding = (raw) => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (typeof value.key !== "string" || typeof value.keycode !== "string" || !validModifiers(value.modifiers)) {
      return null;
    }
    return {
      key: value.key,
      keycode: value.keycode,
      modifiers: value.modifiers
    };
  } catch {
    return null;
  }
};
var preferenceBindingStore = {
  read: () => parseBinding(Services.prefs.getStringPref(BINDING_PREFERENCE, "")),
  write: (binding) => {
    Services.prefs.setStringPref(BINDING_PREFERENCE, JSON.stringify(binding));
  }
};
var shortcutFor = (binding) => ({
  id: POP_OUT_SHORTCUT_ID,
  key: binding.key,
  keycode: binding.keycode,
  group: "zen-other",
  l10nId: null,
  modifiers: binding.modifiers,
  action: POP_OUT_COMMAND_ID,
  disabled: false,
  reserved: true,
  internal: false
});
var registerPopOutTabShortcut = async (manager = gZenKeyboardShortcutsManager, bindingStore = preferenceBindingStore) => {
  const saved = await manager.loader.loadObject();
  if (!saved || !Array.isArray(saved.shortcuts)) {
    throw new Error("Zen shortcut data is unavailable");
  }
  const existing = saved.shortcuts.find((shortcut) => shortcut.id === POP_OUT_SHORTCUT_ID);
  if (existing) {
    if (existing.action !== POP_OUT_COMMAND_ID) {
      throw new Error(`shortcut ID is already owned by ${String(existing.action)}`);
    }
    return false;
  }
  await manager.loader.save({
    ...saved,
    shortcuts: [...saved.shortcuts, shortcutFor(bindingStore.read() ?? defaultBinding())]
  });
  await manager.init();
  return true;
};
var unregisterPopOutTabShortcut = async (manager = gZenKeyboardShortcutsManager, bindingStore = preferenceBindingStore) => {
  const saved = await manager.loader.loadObject();
  if (!saved || !Array.isArray(saved.shortcuts)) {
    throw new Error("Zen shortcut data is unavailable");
  }
  const existing = saved.shortcuts.find((shortcut) => shortcut.id === POP_OUT_SHORTCUT_ID);
  if (!existing) return false;
  if (existing.action !== POP_OUT_COMMAND_ID) {
    throw new Error(`shortcut ID is already owned by ${String(existing.action)}`);
  }
  bindingStore.write({
    key: existing.key,
    keycode: existing.keycode,
    modifiers: existing.modifiers
  });
  await manager.loader.save({
    ...saved,
    shortcuts: saved.shortcuts.filter((shortcut) => shortcut.id !== POP_OUT_SHORTCUT_ID)
  });
  await manager.init();
  return true;
};

// src/platform/command.ts
var COMMAND_SET_ID = "mainCommandSet";
var installPopOutTabCommand = ({
  popOutSelectedTab: popOutSelectedTab2,
  report
}) => {
  const document = window.document;
  const commandSet = document.getElementById(COMMAND_SET_ID);
  if (!commandSet || typeof document.createXULElement !== "function") {
    throw new Error("Zen browser command set is unavailable");
  }
  document.getElementById(POP_OUT_COMMAND_ID)?.remove();
  const command = document.createXULElement("command");
  command.id = POP_OUT_COMMAND_ID;
  let destroyed = false;
  const onCommand = () => {
    if (destroyed) return;
    try {
      popOutSelectedTab2();
    } catch (error) {
      report(error);
    }
  };
  command.addEventListener("command", onCommand);
  commandSet.append(command);
  return () => {
    if (destroyed) return;
    destroyed = true;
    command.removeEventListener("command", onCommand);
    command.remove();
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
var startGeneration = () => {
  window.zenPopOutTab?.stop("replacement");
  const scope = new DisposableScope({
    onDisposeError: (error) => {
      console.error("[pop-out-tab] disposer failed", error);
    }
  });
  let stopReason = null;
  const generation2 = {
    get stopReason() {
      return stopReason;
    },
    defer: (disposer) => scope.defer(disposer),
    isLive: () => scope.isLive(),
    stop(reason = "manual") {
      if (!scope.isLive()) {
        return false;
      }
      stopReason = reason;
      return scope.stop();
    }
  };
  window.zenPopOutTab = generation2;
  generation2.defer(() => {
    if (window.zenPopOutTab === generation2) {
      delete window.zenPopOutTab;
    }
  });
  try {
    const binding = bindSineWindowLifecycle(window, generation2);
    if (binding.sineUnload === "unavailable") {
      console.error("[pop-out-tab] Sine unload hook is unavailable");
    }
  } catch (error) {
    generation2.stop("startup-failure");
    throw error;
  }
  return generation2;
};
var installSineUnloadCleanup = (generation2, cleanup) => {
  if (typeof window.addUnloadListener !== "function") return false;
  window.addUnloadListener(async () => {
    try {
      await cleanup();
    } finally {
      generation2.stop("sine-unload");
    }
  });
  return true;
};

// src/main.ts
var generation = startGeneration();
generation.defer(() => {
  console.info("[pop-out-tab] unloaded");
});
try {
  generation.defer(
    installPopOutTabCommand({
      popOutSelectedTab,
      report: (error) => console.error("[pop-out-tab] action failed", error)
    })
  );
  await registerPopOutTabShortcut();
  if (!generation.isLive()) {
    await unregisterPopOutTabShortcut();
  } else {
    installSineUnloadCleanup(generation, unregisterPopOutTabShortcut);
  }
} catch (error) {
  generation.stop("startup-failure");
  throw error;
}
if (generation.isLive()) {
  console.info("[pop-out-tab] ready");
}
