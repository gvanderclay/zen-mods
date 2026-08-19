import type {
  ClippedSidebarMotionOptions,
  ContentMask,
  LegacySidebarAnimationOptions,
  PendingClose,
  SavedStyle,
  SidebarMotionDirection,
  SidebarMotionPort,
  SidebarMotionRun,
} from "./sidebar-animation.types.ts";

const HISTORY_SIDEBAR = "viewHistorySidebar";
const SUPPORTED_SIDEBARS = new Set(["viewBookmarksSidebar", HISTORY_SIDEBAR]);

const MOTION_PROPERTIES = ["display", "max-width", "min-width", "overflow"] as const;

const saveStyles = (style: CSSStyleDeclaration): SavedStyle[] =>
  MOTION_PROPERTIES.map(name => ({
    name,
    priority: style.getPropertyPriority(name),
    value: style.getPropertyValue(name),
  }));

const restoreStyles = (style: CSSStyleDeclaration, saved: SavedStyle[]) => {
  for (const { name, priority, value } of saved) {
    if (value === "") {
      style.removeProperty(name);
    } else {
      style.setProperty(name, value, priority);
    }
  }
};

export const createClippedSidebarMotion = ({
  box,
  durationMs,
  splitter,
  tabbox,
}: ClippedSidebarMotionOptions): SidebarMotionPort => ({
  animate(direction) {
    const boxRect = box.getBoundingClientRect();
    const tabboxRect = tabbox.getBoundingClientRect();
    const width = boxRect.width;
    if (!Number.isFinite(width) || width <= 0) {
      return null;
    }

    const physicalLeft =
      boxRect.left + width / 2 <= tabboxRect.left + tabboxRect.width / 2;
    const marginProperty = physicalLeft ? "marginRight" : "marginLeft";
    const clipped = physicalLeft
      ? { clipPath: `inset(0 ${width}px 0 0)`, [marginProperty]: `${-width}px` }
      : { clipPath: `inset(0 0 0 ${width}px)`, [marginProperty]: `${-width}px` };
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

    let animation: Animation;
    try {
      animation = box.animate(
        direction === "open" ? [clipped, expanded] : [expanded, clipped],
        { duration: durationMs, easing: "ease-in-out", fill: "both" },
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
      error => {
        cleanup();
        if (!canceled) {
          throw error;
        }
      },
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
      },
    };
  },
});

export const installLegacySidebarAnimation = ({
  controller,
  motion,
  reduceMotion,
  report = () => {},
}: LegacySidebarAnimationOptions): (() => void) => {
  const originalShow = controller.show;
  const originalShowInitially = controller.showInitially;
  const originalHide = controller.hide;
  let active = true;
  let currentRun: SidebarMotionRun | null = null;
  let closing: PendingClose | null = null;
  let contentMask: ContentMask | null = null;

  const safelyReport = (error: unknown) => {
    try {
      report(error);
    } catch {
      // Error reporting cannot own browser behavior.
    }
  };
  const canAnimate = (commandID: string) =>
    controller._animationEnabled && !reduceMotion() && SUPPORTED_SIDEBARS.has(commandID);
  const restoreHistoryFocus = (commandID: string, shown: boolean) => {
    if (
      !active ||
      !shown ||
      commandID !== HISTORY_SIDEBAR ||
      controller.currentID !== commandID
    ) {
      return;
    }
    try {
      controller.browser.contentDocument?.getElementById("search-box")?.focus();
    } catch (error) {
      safelyReport(error);
    }
  };
  const maskContent = () => {
    const style = controller.browser.style;
    const saved: SavedStyle = {
      name: "visibility",
      priority: style.getPropertyPriority("visibility"),
      value: style.getPropertyValue("visibility"),
    };
    let masked = true;
    const mask: ContentMask = {
      restore() {
        if (!masked) {
          return;
        }
        masked = false;
        restoreStyles(style, [saved]);
        if (contentMask === mask) {
          contentMask = null;
        }
      },
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
  const startMotion = (direction: SidebarMotionDirection) => {
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
          error => {
            if (currentRun === run) {
              currentRun = null;
            }
            safelyReport(error);
          },
        );
      }
      return run;
    } catch (error) {
      safelyReport(error);
      return null;
    }
  };

  const show: LegacySidebarController["show"] = (commandID, triggerNode) => {
    const targetCommand = commandID ?? "";
    const opening = !controller.isOpen;
    cancelMotion();
    const animateOpening = opening && canAnimate(targetCommand);
    const mask = animateOpening ? maskContent() : null;
    let result: Promise<boolean>;
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
          shown => {
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
          },
        );
      } else {
        mask?.restore();
      }
    }
    return result;
  };

  const showInitially: LegacySidebarController["showInitially"] = commandID => {
    cancelMotion();
    return originalShowInitially.call(controller, commandID);
  };

  const finishClose = (pending: PendingClose) => {
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

  const hide: LegacySidebarController["hide"] = options => {
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
    const pending: PendingClose =
      options === undefined ? { run, token: {} } : { options, run, token: {} };
    closing = pending;
    void run.finished.then(
      () => finishClose(pending),
      () => finishClose(pending),
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
