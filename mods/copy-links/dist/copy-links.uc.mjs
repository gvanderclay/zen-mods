// Generated from src/ by build.mjs — do not edit.

// src/platform/browser.ts
var { SharingUtils } = ChromeUtils.importESModule(
  "resource:///modules/SharingUtils.sys.mjs"
);
var clipboardHelper = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(
  Ci.nsIClipboardHelper
);
var getLinksToShare = (shareMenu) => SharingUtils.getLinksToShare(shareMenu);
var copyPlainText = (text) => {
  clipboardHelper.copyString(text);
};

// src/core/links.ts
var linksAsPlainText = (links) => links.map((link) => link.url).join("\n");
var copyLinksMenuState = (shareableCount) => ({
  disabled: shareableCount < 1,
  labelCount: Math.max(1, shareableCount)
});

// src/platform/menu.ts
var ITEM_ID = "copy-links-context-item";
var MENU_ID = "tabContextMenu";
var SHARE_ANCHOR_ID = "context_moveTabOptions";
var SHARE_MENU_CLASS = "share-tab-url-item";
var installCopyLinksMenuItem = ({
  copyText,
  getLinksToShare: getLinksToShare2,
  report
}) => {
  const document = window.document;
  const menu = document.getElementById(MENU_ID);
  const anchor = document.getElementById(SHARE_ANCHOR_ID);
  if (!menu || !anchor || typeof document.createXULElement !== "function") {
    console.error("[copy-links] tab context menu is unavailable");
    return () => {
    };
  }
  document.getElementById(ITEM_ID)?.remove();
  const item = document.createXULElement("menuitem");
  item.id = ITEM_ID;
  let currentLinks = [];
  let destroyed = false;
  const currentShareMenu = () => [...menu.children].find((child) => child.classList.contains(SHARE_MENU_CLASS)) ?? null;
  const placeAfterShare = () => {
    const shareMenu = currentShareMenu();
    (shareMenu ?? anchor).after(item);
    return shareMenu;
  };
  const updateState = (shareableCount) => {
    const state = copyLinksMenuState(shareableCount);
    document.l10n.setAttributes(item, "menu-share-copy-links", {
      count: state.labelCount
    });
    item.toggleAttribute("disabled", state.disabled);
  };
  const onShowing = (event) => {
    if (destroyed || event.target !== menu) {
      return;
    }
    try {
      const shareMenu = placeAfterShare();
      currentLinks = shareMenu ? [...getLinksToShare2(shareMenu)] : [];
      updateState(currentLinks.length);
    } catch (error) {
      currentLinks = [];
      updateState(0);
      report(error);
    }
  };
  const onCommand = () => {
    if (destroyed || currentLinks.length === 0) {
      return;
    }
    try {
      copyText(linksAsPlainText(currentLinks));
    } catch (error) {
      report(error);
    }
  };
  updateState(0);
  placeAfterShare();
  menu.addEventListener("popupshowing", onShowing);
  item.addEventListener("command", onCommand);
  return () => {
    if (destroyed) {
      return;
    }
    destroyed = true;
    menu.removeEventListener("popupshowing", onShowing);
    item.removeEventListener("command", onCommand);
    item.remove();
    currentLinks = [];
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
  window.zenCopyLinks?.stop("replacement");
  const scope = new DisposableScope({
    onDisposeError: (error) => {
      console.error("[copy-links] disposer failed", error);
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
  window.zenCopyLinks = generation2;
  generation2.defer(() => {
    if (window.zenCopyLinks === generation2) {
      delete window.zenCopyLinks;
    }
  });
  try {
    const binding = bindSineWindowLifecycle(window, generation2);
    if (binding.sineUnload === "unavailable") {
      console.error("[copy-links] Sine unload hook is unavailable");
    }
  } catch (error) {
    generation2.stop("startup-failure");
    throw error;
  }
  return generation2;
};

// src/main.ts
var generation = startGeneration();
generation.defer(() => {
  console.info("[copy-links] unloaded");
});
try {
  generation.defer(
    installCopyLinksMenuItem({
      copyText: copyPlainText,
      getLinksToShare,
      report: (error) => console.error("[copy-links] action failed", error)
    })
  );
} catch (error) {
  generation.stop("startup-failure");
  throw error;
}
console.info("[copy-links] ready");
