import { restoreStyles } from "./clipped-sidebar-motion.ts";
import type {
  ContentMask,
  LegacySidebarAnimationOptions,
  PendingClose,
  SavedStyle,
  SidebarMotionDirection,
  SidebarMotionRun,
} from "./sidebar-animation.types.ts";

const HISTORY_SIDEBAR = "viewHistorySidebar";
const SUPPORTED_SIDEBARS = new Set(["viewBookmarksSidebar", HISTORY_SIDEBAR]);

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
