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

// src/platform/clipped-sidebar-motion.ts
var MOTION_PROPERTIES = ["display", "max-width", "min-width", "overflow"];
var saveStyles = (style) => MOTION_PROPERTIES.map((name) => ({
  name,
  priority: style.getPropertyPriority(name),
  value: style.getPropertyValue(name)
}));
var restoreStyles = (style, saved) => {
  for (const { name, priority, value } of saved) {
    if (value === "") {
      style.removeProperty(name);
    } else {
      style.setProperty(name, value, priority);
    }
  }
};
var createClippedSidebarMotion = ({
  box,
  durationMs,
  splitter,
  tabbox
}) => ({
  animate(direction) {
    const boxRect = box.getBoundingClientRect();
    const tabboxRect = tabbox.getBoundingClientRect();
    const width = boxRect.width;
    if (!Number.isFinite(width) || width <= 0) {
      return null;
    }
    const physicalLeft = boxRect.left + width / 2 <= tabboxRect.left + tabboxRect.width / 2;
    const marginProperty = physicalLeft ? "marginRight" : "marginLeft";
    const clipped = physicalLeft ? { clipPath: `inset(0 ${width}px 0 0)`, [marginProperty]: `${-width}px` } : { clipPath: `inset(0 0 0 ${width}px)`, [marginProperty]: `${-width}px` };
    const expanded = { clipPath: "inset(0 0 0 0)", [marginProperty]: "0px" };
    const saved = saveStyles(box.style);
    let active = true;
    let canceled = false;
    const cleanup = () => {
      if (!active) {
        return;
      }
      active = false;
      restoreStyles(box.style, saved);
    };
    box.style.setProperty("min-width", `${width}px`);
    box.style.setProperty("max-width", `${width}px`);
    box.style.setProperty("overflow", "clip");
    if (direction === "close") {
      box.style.setProperty("display", "flex");
      box.hidden = splitter.hidden = true;
    }
    let animation;
    try {
      animation = box.animate(
        direction === "open" ? [clipped, expanded] : [expanded, clipped],
        { duration: durationMs, easing: "ease-in-out", fill: "both" }
      );
      if (direction === "open") {
        animation.pause();
        animation.currentTime = 0;
      }
    } catch (error) {
      cleanup();
      if (direction === "close") {
        box.hidden = splitter.hidden = false;
      }
      throw error;
    }
    const finished = Promise.resolve(animation.finished).then(
      () => {
        try {
          animation.cancel();
        } finally {
          cleanup();
        }
      },
      (error) => {
        cleanup();
        if (!canceled) {
          throw error;
        }
      }
    );
    return {
      cancel() {
        if (!active) {
          return;
        }
        canceled = true;
        try {
          animation.cancel();
        } finally {
          cleanup();
        }
      },
      finished,
      start() {
        if (active && direction === "open") {
          animation.play();
        }
      }
    };
  }
});

// src/platform/history-entry-remove.ts
var HISTORY_DOCUMENT = "chrome://browser/content/places/historySidebar.xhtml";
var BUTTON_ID = "sidebar-polish-history-remove";
var BUTTON_SIZE = 24;
var BUTTON_INSET = 8;
var BUTTON_OPTICAL_OFFSET = 2;
var safelyReport = (report, error) => {
  try {
    report?.(error);
  } catch {
  }
};
var attachHistoryDocument = (document, history, isLive, report) => {
  const tree = document.getElementById("historyTree");
  if (!tree || typeof document.createXULElement !== "function") {
    return () => {
    };
  }
  const button = document.createXULElement("image");
  button.id = BUTTON_ID;
  button.classList.add("close-icon");
  button.hidden = true;
  button.tabIndex = -1;
  button.style.pointerEvents = "none";
  button.setAttribute("aria-hidden", "true");
  document.l10n?.setAttributes(button, "places-delete-page", { count: 1 });
  document.documentElement.append(button);
  let active = true;
  let actionBounds = null;
  const hide = () => {
    actionBounds = null;
    button.removeAttribute("data-hover");
    button.removeAttribute("data-pressed");
    button.hidden = true;
  };
  const contains = (pointer) => actionBounds !== null && pointer.clientX >= actionBounds.left && pointer.clientX <= actionBounds.right && pointer.clientY >= actionBounds.top && pointer.clientY <= actionBounds.bottom;
  const suppressTreeAction = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onMove = (event) => {
    if (!active || !isLive()) {
      hide();
      return;
    }
    const pointer = event;
    try {
      const { row } = tree.getCellAt(pointer.clientX, pointer.clientY);
      const node = row >= 0 ? tree.view?.nodeForTreeIndex(row) : null;
      if (!node || !history.isURI(node) || typeof node.uri !== "string") {
        hide();
        return;
      }
      const rowHeight = tree.rowHeight;
      const bodyRect = tree.treeBody.getBoundingClientRect();
      if (!Number.isFinite(rowHeight) || rowHeight <= 0) {
        hide();
        return;
      }
      const rowTop = bodyRect.y + rowHeight * (row - tree.getFirstVisibleRow());
      const rtl = document.defaultView?.getComputedStyle(tree).direction === "rtl";
      const left = rtl ? bodyRect.left + BUTTON_INSET : bodyRect.right - BUTTON_INSET - BUTTON_SIZE;
      const top = rowTop + (rowHeight - BUTTON_SIZE) / 2 + BUTTON_OPTICAL_OFFSET;
      actionBounds = {
        bottom: top + BUTTON_SIZE,
        left,
        right: left + BUTTON_SIZE,
        top,
        uri: node.uri
      };
      button.style.left = `${left}px`;
      button.style.top = `${top}px`;
      button.hidden = false;
      button.toggleAttribute("data-hover", contains(pointer));
    } catch (error) {
      hide();
      safelyReport(report, error);
    }
  };
  const onMouseDown = (event) => {
    const pointer = event;
    if (!active || !isLive() || !contains(pointer)) {
      return;
    }
    suppressTreeAction(pointer);
    button.setAttribute("data-pressed", "");
  };
  const onMouseUp = (event) => {
    const pointer = event;
    button.removeAttribute("data-pressed");
    if (active && isLive() && contains(pointer)) {
      suppressTreeAction(pointer);
    }
  };
  const onClick = (event) => {
    const pointer = event;
    if (!active || !isLive() || !contains(pointer)) {
      return;
    }
    suppressTreeAction(pointer);
    const uri = actionBounds?.uri ?? null;
    hide();
    if (uri === null) {
      return;
    }
    try {
      void Promise.resolve(history.remove(uri)).catch(
        (error) => safelyReport(report, error)
      );
    } catch (error) {
      safelyReport(report, error);
    }
  };
  const onTreeLeave = () => hide();
  tree.addEventListener("mousemove", onMove);
  tree.addEventListener("mouseleave", onTreeLeave);
  tree.addEventListener("mousedown", onMouseDown, true);
  tree.addEventListener("mouseup", onMouseUp, true);
  tree.addEventListener("click", onClick, true);
  tree.addEventListener("scroll", hide, true);
  tree.addEventListener("keydown", hide);
  return () => {
    if (!active) {
      return;
    }
    active = false;
    hide();
    tree.removeEventListener("mousemove", onMove);
    tree.removeEventListener("mouseleave", onTreeLeave);
    tree.removeEventListener("mousedown", onMouseDown, true);
    tree.removeEventListener("mouseup", onMouseUp, true);
    tree.removeEventListener("click", onClick, true);
    tree.removeEventListener("scroll", hide, true);
    tree.removeEventListener("keydown", hide);
    button.remove();
  };
};
var createPlacesHistoryPort = () => {
  const { PlacesUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/PlacesUtils.sys.mjs"
  );
  return {
    isURI: (node) => PlacesUtils.nodeIsURI(node),
    // Zen 1.21.13b controller.js:871-878 uses this call for one History URI.
    remove: (uri) => PlacesUtils.history.remove(uri)
  };
};
var installHistoryEntryRemoveButton = ({
  browser,
  history,
  isLive,
  report
}) => {
  let active = true;
  let currentDocument = null;
  let detachDocument = () => {
  };
  const bind = (document) => {
    if (!active || !isLive() || currentDocument === document) {
      return;
    }
    detachDocument();
    detachDocument = () => {
    };
    currentDocument = document;
    if (document?.documentURI === HISTORY_DOCUMENT) {
      detachDocument = attachHistoryDocument(
        document,
        history,
        isLive,
        report
      );
    }
  };
  const onLoad = (event) => {
    const document = browser.contentDocument;
    if (event.target === document) {
      bind(document);
    }
  };
  browser.addEventListener("load", onLoad, true);
  bind(browser.contentDocument);
  return () => {
    if (!active) {
      return;
    }
    active = false;
    browser.removeEventListener("load", onLoad, true);
    detachDocument();
    detachDocument = () => {
    };
    currentDocument = null;
  };
};

// src/platform/sidebar-animation.ts
var HISTORY_SIDEBAR = "viewHistorySidebar";
var SUPPORTED_SIDEBARS = /* @__PURE__ */ new Set(["viewBookmarksSidebar", HISTORY_SIDEBAR]);
var installLegacySidebarAnimation = ({
  controller,
  motion,
  reduceMotion,
  report = () => {
  }
}) => {
  const originalShow = controller.show;
  const originalShowInitially = controller.showInitially;
  const originalHide = controller.hide;
  let active = true;
  let currentRun = null;
  let closing = null;
  let contentMask = null;
  const safelyReport2 = (error) => {
    try {
      report(error);
    } catch {
    }
  };
  const canAnimate = (commandID) => controller._animationEnabled && !reduceMotion() && SUPPORTED_SIDEBARS.has(commandID);
  const restoreHistoryFocus = (commandID, shown) => {
    if (!active || !shown || commandID !== HISTORY_SIDEBAR || controller.currentID !== commandID) {
      return;
    }
    try {
      controller.browser.contentDocument?.getElementById("search-box")?.focus();
    } catch (error) {
      safelyReport2(error);
    }
  };
  const maskContent = () => {
    const style = controller.browser.style;
    const saved = {
      name: "visibility",
      priority: style.getPropertyPriority("visibility"),
      value: style.getPropertyValue("visibility")
    };
    let masked = true;
    const mask = {
      restore() {
        if (!masked) {
          return;
        }
        masked = false;
        restoreStyles(style, [saved]);
        if (contentMask === mask) {
          contentMask = null;
        }
      }
    };
    style.setProperty("visibility", "hidden");
    contentMask = mask;
    return mask;
  };
  const cancelMotion = () => {
    const run = currentRun;
    currentRun = null;
    closing = null;
    contentMask?.restore();
    try {
      run?.cancel();
    } catch (error) {
      safelyReport2(error);
    }
  };
  const startMotion = (direction) => {
    try {
      const run = motion.animate(direction);
      currentRun = run;
      if (run) {
        void run.finished.then(
          () => {
            if (currentRun === run) {
              currentRun = null;
            }
          },
          (error) => {
            if (currentRun === run) {
              currentRun = null;
            }
            safelyReport2(error);
          }
        );
      }
      return run;
    } catch (error) {
      safelyReport2(error);
      return null;
    }
  };
  const show = (commandID, triggerNode) => {
    const targetCommand = commandID ?? "";
    const opening = !controller.isOpen;
    cancelMotion();
    const animateOpening = opening && canAnimate(targetCommand);
    const mask = animateOpening ? maskContent() : null;
    let result;
    try {
      result = originalShow.call(controller, commandID, triggerNode);
    } catch (error) {
      mask?.restore();
      throw error;
    }
    if (animateOpening) {
      const run = startMotion("open");
      if (run) {
        try {
          run.start();
        } catch (error) {
          safelyReport2(error);
          cancelMotion();
        }
        void result.then(
          (shown) => {
            mask?.restore();
            restoreHistoryFocus(targetCommand, shown);
            if (currentRun !== run) {
              return;
            }
            if (!shown) {
              cancelMotion();
            }
          },
          () => {
            mask?.restore();
            if (currentRun === run) {
              cancelMotion();
            }
          }
        );
      } else {
        mask?.restore();
      }
    }
    return result;
  };
  const showInitially = (commandID) => {
    cancelMotion();
    return originalShowInitially.call(controller, commandID);
  };
  const finishClose = (pending) => {
    if (!active || closing?.token !== pending.token) {
      return;
    }
    currentRun = null;
    closing = null;
    controller._box.hidden = controller._splitter.hidden = false;
    try {
      originalHide.call(controller, pending.options);
    } catch (error) {
      safelyReport2(error);
    }
  };
  const hide = (options) => {
    if (closing) {
      return;
    }
    cancelMotion();
    if (!canAnimate(controller.currentID)) {
      originalHide.call(controller, options);
      return;
    }
    const run = startMotion("close");
    if (!run) {
      originalHide.call(controller, options);
      return;
    }
    const pending = options === void 0 ? { run, token: {} } : { options, run, token: {} };
    closing = pending;
    void run.finished.then(
      () => finishClose(pending),
      () => finishClose(pending)
    );
  };
  controller.show = show;
  controller.showInitially = showInitially;
  controller.hide = hide;
  return () => {
    if (!active) {
      return;
    }
    active = false;
    const wasClosing = closing !== null;
    cancelMotion();
    if (controller.show === show) {
      controller.show = originalShow;
    }
    if (controller.showInitially === showInitially) {
      controller.showInitially = originalShowInitially;
    }
    if (controller.hide === hide) {
      controller.hide = originalHide;
    }
    if (wasClosing) {
      controller._box.hidden = controller._splitter.hidden = false;
    }
  };
};

// src/main.ts
window.zenSidebarPolish?.stop("replacement");
var scope = new DisposableScope({
  onDisposeError: (error) => {
    console.error("[sidebar-polish] disposer failed", error);
  }
});
var stopReason = null;
var generation = {
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
window.zenSidebarPolish = generation;
generation.defer(() => {
  if (window.zenSidebarPolish === generation) {
    delete window.zenSidebarPolish;
  }
});
try {
  const binding = bindSineWindowLifecycle(window, generation);
  if (binding.sineUnload === "unavailable") {
    console.error("[sidebar-polish] Sine unload hook is unavailable");
  }
  const tabbox = window.document.getElementById("tabbrowser-tabbox");
  if (!tabbox) {
    throw new Error("Sidebar Polish requires #tabbrowser-tabbox");
  }
  generation.defer(
    installLegacySidebarAnimation({
      controller: SidebarController,
      motion: createClippedSidebarMotion({
        box: SidebarController._box,
        durationMs: SidebarController._animationDurationMs,
        splitter: SidebarController._splitter,
        tabbox
      }),
      reduceMotion: () => window.gReduceMotion,
      report: (error) => console.error("[sidebar-polish] animation failed", error)
    })
  );
  generation.defer(
    installHistoryEntryRemoveButton({
      browser: SidebarController.browser,
      history: createPlacesHistoryPort(),
      isLive: generation.isLive,
      report: (error) => console.error("[sidebar-polish] history removal failed", error)
    })
  );
  console.info("[sidebar-polish] ready");
} catch (error) {
  generation.stop("startup-failure");
  throw error;
}
