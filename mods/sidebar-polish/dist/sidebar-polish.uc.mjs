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

// src/platform/sidebar-animation.ts
var SUPPORTED_SIDEBARS = /* @__PURE__ */ new Set(["viewBookmarksSidebar", "viewHistorySidebar"]);
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
  const safelyReport = (error) => {
    try {
      report(error);
    } catch {
    }
  };
  const canAnimate = (commandID) => controller._animationEnabled && !reduceMotion() && SUPPORTED_SIDEBARS.has(commandID);
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
      safelyReport(error);
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
            safelyReport(error);
          }
        );
      }
      return run;
    } catch (error) {
      safelyReport(error);
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
          safelyReport(error);
          cancelMotion();
        }
        void result.then(
          (shown) => {
            mask?.restore();
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
      safelyReport(error);
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
  console.info("[sidebar-polish] ready");
} catch (error) {
  generation.stop("startup-failure");
  throw error;
}
