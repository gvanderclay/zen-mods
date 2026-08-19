// Generated from src/ by build.mjs — do not edit.

// src/platform/duplicate-command.ts
var DUPLICATE_COMMAND_ID = "cmd_zenDuplicateTab";
var observeDuplicateCommand = ({
  commandSet: commandSet2,
  report,
  schedule,
  showToast,
  tabContainer
}) => {
  let destroyed = false;
  const pending = /* @__PURE__ */ new Set();
  const onCommand = (event) => {
    const target = event.target;
    if (destroyed || target?.id !== DUPLICATE_COMMAND_ID) return;
    let tabCount = 0;
    let watching = true;
    const onTabOpen = () => {
      tabCount += 1;
    };
    const stopWatching = () => {
      if (!watching) return;
      watching = false;
      tabContainer.removeEventListener("TabOpen", onTabOpen);
      pending.delete(stopWatching);
    };
    pending.add(stopWatching);
    tabContainer.addEventListener("TabOpen", onTabOpen);
    try {
      schedule(() => {
        stopWatching();
        if (destroyed || tabCount === 0) return;
        try {
          void Promise.resolve(showToast(tabCount)).catch(report);
        } catch (error) {
          report(error);
        }
      });
    } catch (error) {
      stopWatching();
      report(error);
    }
  };
  commandSet2.addEventListener("command", onCommand, true);
  return () => {
    if (destroyed) return;
    destroyed = true;
    commandSet2.removeEventListener("command", onCommand, true);
    for (const stopWatching of [...pending]) stopWatching();
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
  window.zenDuplicateTabToast?.stop("replacement");
  const scope = new DisposableScope({
    onDisposeError: (error) => {
      console.error("[duplicate-tab-toast] disposer failed", error);
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
      if (!scope.isLive()) return false;
      stopReason = reason;
      return scope.stop();
    }
  };
  window.zenDuplicateTabToast = generation2;
  generation2.defer(() => {
    if (window.zenDuplicateTabToast === generation2) {
      delete window.zenDuplicateTabToast;
    }
  });
  try {
    const binding = bindSineWindowLifecycle(window, generation2);
    if (binding.sineUnload === "unavailable") {
      console.error("[duplicate-tab-toast] Sine unload hook is unavailable");
    }
  } catch (error) {
    generation2.stop("startup-failure");
    throw error;
  }
  return generation2;
};

// src/core/message.ts
var duplicateToastText = (tabCount) => tabCount === 1 ? "Tab duplicated!" : `${tabCount} tabs duplicated!`;

// src/platform/toast.ts
var DUPLICATE_TOAST_ID = "zen-duplicate-tab-toast";
var showDuplicateTabToast = async (tabCount, manager, container) => {
  const completion = manager.showToast(DUPLICATE_TOAST_ID, { timeout: 3e3 });
  const toast = [...container.children].find(
    (child) => child._messageId === DUPLICATE_TOAST_ID
  );
  const label = toast?.querySelector("label");
  if (!label) {
    await completion;
    throw new Error("Zen did not create the duplicate-tab toast");
  }
  label.removeAttribute("data-l10n-id");
  label.removeAttribute("data-l10n-args");
  label.textContent = duplicateToastText(tabCount);
  await completion;
};

// src/main.ts
var commandSet = document.getElementById("zenCommandSet");
var toastContainer = document.getElementById("zen-toast-container");
if (!commandSet || !toastContainer) {
  throw new Error("Zen duplicate command or toast container is unavailable");
}
var generation = startGeneration();
generation.defer(() => {
  console.info("[duplicate-tab-toast] unloaded");
});
try {
  generation.defer(
    observeDuplicateCommand({
      commandSet,
      report: (error) => console.error("[duplicate-tab-toast] action failed", error),
      schedule: queueMicrotask,
      showToast: (tabCount) => showDuplicateTabToast(tabCount, gZenUIManager, toastContainer),
      tabContainer: gBrowser.tabContainer
    })
  );
} catch (error) {
  generation.stop("startup-failure");
  throw error;
}
console.info("[duplicate-tab-toast] ready");
