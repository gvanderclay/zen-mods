// Generated from src/ by build.mjs — do not edit.

// src/platform/browser.ts
var popOutSelectedTab = () => {
  const selectedTab = gBrowser.selectedTab;
  if (!selectedTab) {
    return;
  }
  gBrowser.replaceTabWithWindow(selectedTab, {}, true);
};

// src/platform/command.ts
var COMMAND_SET_ID = "mainCommandSet";
var installCommands = (commands, { report }) => {
  if (new Set(commands.map((command) => command.id)).size !== commands.length) {
    throw new Error("command IDs must be unique");
  }
  const document = window.document;
  const commandSet = document.getElementById(COMMAND_SET_ID);
  if (!commandSet || typeof document.createXULElement !== "function") {
    throw new Error("Zen browser command set is unavailable");
  }
  let destroyed = false;
  const installed = commands.map((definition) => {
    document.getElementById(definition.id)?.remove();
    const element = document.createXULElement("command");
    element.id = definition.id;
    const onCommand = () => {
      if (destroyed) return;
      try {
        definition.run();
      } catch (error) {
        report(error);
      }
    };
    element.addEventListener("command", onCommand);
    commandSet.append(element);
    return { element, onCommand };
  });
  return () => {
    if (destroyed) return;
    destroyed = true;
    for (const { element, onCommand } of installed) {
      element.removeEventListener("command", onCommand);
      element.remove();
    }
  };
};

// src/platform/shortcut.ts
var POP_OUT_SHORTCUT_ID = "pop-out-tab-key";
var POP_OUT_COMMAND_ID = "Pop Out Current Tab";
var LEGACY_POP_OUT_BINDING_PREFERENCE = "zen.pop-out-tab.saved-binding";
var BINDING_PREFERENCE_PREFIX = "zen.extended-tab-shortcuts.saved-binding.";
var POP_OUT_SHORTCUT = {
  id: POP_OUT_SHORTCUT_ID,
  action: POP_OUT_COMMAND_ID,
  defaultBinding: {
    key: "n",
    keycode: "",
    modifiers: {
      control: true,
      alt: false,
      shift: false,
      meta: true,
      accel: false
    }
  }
};
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
  read: (id) => {
    const current = parseBinding(
      Services.prefs.getStringPref(`${BINDING_PREFERENCE_PREFIX}${id}`, "")
    );
    if (current || id !== POP_OUT_SHORTCUT_ID) return current;
    return parseBinding(
      Services.prefs.getStringPref(LEGACY_POP_OUT_BINDING_PREFERENCE, "")
    );
  },
  write: (id, binding) => {
    Services.prefs.setStringPref(
      `${BINDING_PREFERENCE_PREFIX}${id}`,
      JSON.stringify(binding)
    );
  }
};
var shortcutFor = (definition, binding) => ({
  id: definition.id,
  key: binding.key,
  keycode: binding.keycode,
  group: "zen-other",
  l10nId: null,
  modifiers: binding.modifiers,
  action: definition.action,
  disabled: false,
  reserved: true,
  internal: false
});
var validateDefinitions = (definitions) => {
  if (new Set(definitions.map((definition) => definition.id)).size !== definitions.length) {
    throw new Error("shortcut IDs must be unique");
  }
};
var registerShortcuts = async (definitions, manager = gZenKeyboardShortcutsManager, bindingStore = preferenceBindingStore) => {
  validateDefinitions(definitions);
  const saved = await manager.loader.loadObject();
  if (!saved || !Array.isArray(saved.shortcuts)) {
    throw new Error("Zen shortcut data is unavailable");
  }
  for (const definition of definitions) {
    const existing = saved.shortcuts.find((shortcut) => shortcut.id === definition.id);
    if (existing && existing.action !== definition.action) {
      throw new Error(`shortcut ID is already owned by ${String(existing.action)}`);
    }
  }
  const additions = definitions.filter(
    (definition) => !saved.shortcuts.some((shortcut) => shortcut.id === definition.id)
  ).map(
    (definition) => shortcutFor(
      definition,
      bindingStore.read(definition.id) ?? definition.defaultBinding
    )
  );
  if (additions.length === 0) return 0;
  await manager.loader.save({
    ...saved,
    shortcuts: [...saved.shortcuts, ...additions]
  });
  await manager.init();
  return additions.length;
};
var unregisterShortcuts = async (definitions, manager = gZenKeyboardShortcutsManager, bindingStore = preferenceBindingStore) => {
  validateDefinitions(definitions);
  const saved = await manager.loader.loadObject();
  if (!saved || !Array.isArray(saved.shortcuts)) {
    throw new Error("Zen shortcut data is unavailable");
  }
  const existing = definitions.flatMap((definition) => {
    const shortcut = saved.shortcuts.find((candidate) => candidate.id === definition.id);
    if (!shortcut) return [];
    if (shortcut.action !== definition.action) {
      throw new Error(`shortcut ID is already owned by ${String(shortcut.action)}`);
    }
    return [shortcut];
  });
  if (existing.length === 0) return 0;
  for (const shortcut of existing) {
    bindingStore.write(shortcut.id, {
      key: shortcut.key,
      keycode: shortcut.keycode,
      modifiers: shortcut.modifiers
    });
  }
  const ownedIds = new Set(definitions.map((definition) => definition.id));
  await manager.loader.save({
    ...saved,
    shortcuts: saved.shortcuts.filter((shortcut) => !ownedIds.has(shortcut.id))
  });
  await manager.init();
  return existing.length;
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
  window.zenExtendedTabShortcuts?.stop("replacement");
  const scope = new DisposableScope({
    onDisposeError: (error) => {
      console.error("[extended-tab-shortcuts] disposer failed", error);
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
  window.zenExtendedTabShortcuts = generation2;
  generation2.defer(() => {
    if (window.zenExtendedTabShortcuts === generation2) {
      delete window.zenExtendedTabShortcuts;
    }
  });
  try {
    const binding = bindSineWindowLifecycle(window, generation2);
    if (binding.sineUnload === "unavailable") {
      console.error("[extended-tab-shortcuts] Sine unload hook is unavailable");
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
var shortcuts = [POP_OUT_SHORTCUT];
var generation = startGeneration();
generation.defer(() => {
  console.info("[extended-tab-shortcuts] unloaded");
});
try {
  generation.defer(
    installCommands([{ id: POP_OUT_COMMAND_ID, run: popOutSelectedTab }], {
      report: (error) => console.error("[extended-tab-shortcuts] action failed", error)
    })
  );
  await registerShortcuts(shortcuts);
  if (!generation.isLive()) {
    await unregisterShortcuts(shortcuts);
  } else {
    installSineUnloadCleanup(generation, () => unregisterShortcuts(shortcuts));
  }
} catch (error) {
  generation.stop("startup-failure");
  throw error;
}
if (generation.isLive()) {
  console.info("[extended-tab-shortcuts] ready");
}
