import type {
  ClippedSidebarMotionOptions,
  SavedStyle,
  SidebarMotionPort,
} from "./sidebar-animation.types.ts";

const MOTION_PROPERTIES = ["display", "max-width", "min-width", "overflow"] as const;

const saveStyles = (style: CSSStyleDeclaration): SavedStyle[] =>
  MOTION_PROPERTIES.map(name => ({
    name,
    priority: style.getPropertyPriority(name),
    value: style.getPropertyValue(name),
  }));

export const restoreStyles = (style: CSSStyleDeclaration, saved: SavedStyle[]) => {
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
