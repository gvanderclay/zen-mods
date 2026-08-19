import { describe, expect, it, vi } from "vitest";
import { createClippedSidebarMotion } from "./clipped-sidebar-motion.ts";
import { installLegacySidebarAnimation } from "./sidebar-animation.ts";
import type { SidebarMotionDirection } from "./sidebar-animation.types.ts";

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((accept, deny) => {
    resolve = accept;
    reject = deny;
  });
  return { promise, reject, resolve };
};

const deferredBoolean = () => {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>(accept => {
    resolve = accept;
  });
  return { promise, resolve };
};

const createController = (
  commandID = "viewHistorySidebar",
  showResult?: Promise<boolean>,
) => {
  const events: string[] = [];
  let currentCommand = commandID;
  const box = { hidden: commandID === "" } as LegacySidebarElement;
  const splitter = { hidden: commandID === "" } as LegacySidebarElement;
  const browserStyle = createStyle();
  const browser = {
    contentDocument: null as Document | null,
    style: browserStyle,
  };
  const controller: LegacySidebarController = {
    _animationDurationMs: 200,
    _animationEnabled: true,
    _box: box,
    _splitter: splitter,
    browser: browser as unknown as LegacySidebarContentElement,
    get currentID() {
      return box.hidden ? "" : currentCommand;
    },
    get isOpen() {
      return !box.hidden;
    },
    async show(nextCommand = commandID) {
      events.push(`show:${nextCommand}`);
      currentCommand = nextCommand;
      box.hidden = false;
      splitter.hidden = false;
      return showResult ?? true;
    },
    async showInitially(nextCommand) {
      events.push(`show-initially:${nextCommand}`);
      currentCommand = nextCommand;
      box.hidden = false;
      splitter.hidden = false;
      return true;
    },
    hide() {
      if (box.hidden) {
        return;
      }
      events.push("hide");
      box.hidden = true;
      splitter.hidden = true;
    },
  };
  return { box, browser, browserStyle, controller, events, splitter };
};

const createMotion = (fixture: ReturnType<typeof createController>) => {
  const runs: Array<{
    cancel: ReturnType<typeof vi.fn>;
    direction: SidebarMotionDirection;
    gate: ReturnType<typeof deferred>;
    start: ReturnType<typeof vi.fn>;
  }> = [];
  const animate = (direction: SidebarMotionDirection) => {
    fixture.events.push(`animate:${direction}`);
    const gate = deferred();
    const cancel = vi.fn();
    const start = vi.fn(() => fixture.events.push(`start:${direction}`));
    runs.push({ cancel, direction, gate, start });
    if (direction === "close") {
      fixture.box.hidden = fixture.splitter.hidden = true;
    }
    return { cancel, finished: gate.promise, start };
  };
  return { animate, runs };
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("installLegacySidebarAnimation", () => {
  it("starts entry immediately while masking content until its native load settles", async () => {
    const showResult = deferredBoolean();
    const fixture = createController("", showResult.promise);
    const motion = createMotion(fixture);
    installLegacySidebarAnimation({
      controller: fixture.controller,
      motion,
      reduceMotion: () => false,
    });

    const opening = fixture.controller.show("viewHistorySidebar");

    expect(fixture.events).toEqual([
      "show:viewHistorySidebar",
      "animate:open",
      "start:open",
    ]);
    expect(motion.runs[0]?.start).toHaveBeenCalledOnce();
    expect(fixture.browserStyle.values.get("visibility")?.value).toBe("hidden");

    showResult.resolve(true);
    await opening;
    await flush();

    expect(fixture.events).toEqual([
      "show:viewHistorySidebar",
      "animate:open",
      "start:open",
    ]);
    expect(motion.runs[0]?.start).toHaveBeenCalledOnce();
    expect(fixture.browserStyle.values.has("visibility")).toBe(false);
    expect(fixture.box.hidden).toBe(false);
  });

  it("restores History search focus after revealing animated content", async () => {
    const showResult = deferredBoolean();
    const fixture = createController("", showResult.promise);
    const nativeShow = fixture.controller.show;
    let focused = false;
    const search = {
      focus: vi.fn(() => {
        focused = fixture.browserStyle.values.get("visibility")?.value !== "hidden";
      }),
    };
    fixture.browser.contentDocument = {
      getElementById: (id: string) => (id === "search-box" ? search : null),
    } as unknown as Document;
    fixture.controller.show = async (commandID, triggerNode) => {
      const shown = await nativeShow.call(fixture.controller, commandID, triggerNode);
      search.focus();
      return shown;
    };
    const motion = createMotion(fixture);
    installLegacySidebarAnimation({
      controller: fixture.controller,
      motion,
      reduceMotion: () => false,
    });

    const opening = fixture.controller.show("viewHistorySidebar");
    showResult.resolve(true);
    await opening;
    await flush();

    expect(search.focus).toHaveBeenCalledTimes(2);
    expect(focused).toBe(true);
  });

  it("keeps native content loaded until the clipped close settles", async () => {
    const fixture = createController();
    const motion = createMotion(fixture);
    installLegacySidebarAnimation({
      controller: fixture.controller,
      motion,
      reduceMotion: () => false,
    });

    fixture.controller.hide({ dismissPanel: true });

    expect(fixture.events).toEqual(["animate:close"]);
    expect(fixture.box.hidden).toBe(true);
    motion.runs[0]?.gate.resolve();
    await flush();

    expect(fixture.events).toEqual(["animate:close", "hide"]);
    expect(fixture.box.hidden).toBe(true);
  });

  it("cancels a closing run before animating a rapid reopen", async () => {
    const fixture = createController();
    const motion = createMotion(fixture);
    installLegacySidebarAnimation({
      controller: fixture.controller,
      motion,
      reduceMotion: () => false,
    });

    fixture.controller.hide();
    await fixture.controller.show("viewHistorySidebar");
    motion.runs[0]?.gate.resolve();
    await flush();

    expect(motion.runs[0]?.cancel).toHaveBeenCalledOnce();
    expect(fixture.events).toEqual([
      "animate:close",
      "show:viewHistorySidebar",
      "animate:open",
      "start:open",
    ]);
    expect(fixture.box.hidden).toBe(false);
  });

  it("lets initial restoration supersede a pending close without entry motion", async () => {
    const fixture = createController();
    const motion = createMotion(fixture);
    installLegacySidebarAnimation({
      controller: fixture.controller,
      motion,
      reduceMotion: () => false,
    });

    fixture.controller.hide();
    await fixture.controller.showInitially("viewHistorySidebar");
    motion.runs[0]?.gate.resolve();
    await flush();

    expect(motion.runs[0]?.cancel).toHaveBeenCalledOnce();
    expect(fixture.events).toEqual([
      "animate:close",
      "show-initially:viewHistorySidebar",
    ]);
    expect(fixture.box.hidden).toBe(false);
  });

  it("leaves unrelated sidebars and reduced-motion sessions native", async () => {
    const unrelated = createController("");
    const unrelatedMotion = createMotion(unrelated);
    installLegacySidebarAnimation({
      controller: unrelated.controller,
      motion: unrelatedMotion,
      reduceMotion: () => false,
    });
    await unrelated.controller.show("viewTabsSidebar");

    const reduced = createController();
    const reducedMotion = createMotion(reduced);
    installLegacySidebarAnimation({
      controller: reduced.controller,
      motion: reducedMotion,
      reduceMotion: () => true,
    });
    reduced.controller.hide();

    expect(unrelated.events).toEqual(["show:viewTabsSidebar"]);
    expect(reduced.events).toEqual(["hide"]);
  });

  it("restores native methods and cancels motion on disposal", () => {
    const fixture = createController();
    const motion = createMotion(fixture);
    const originalShow = fixture.controller.show;
    const originalHide = fixture.controller.hide;
    const dispose = installLegacySidebarAnimation({
      controller: fixture.controller,
      motion,
      reduceMotion: () => false,
    });
    fixture.controller.hide();

    dispose();

    expect(motion.runs[0]?.cancel).toHaveBeenCalledOnce();
    expect(fixture.controller.show).toBe(originalShow);
    expect(fixture.controller.hide).toBe(originalHide);
    expect(fixture.box.hidden).toBe(false);
  });

  it("does not reopen a sidebar that was already closed on disposal", () => {
    const fixture = createController("");
    const motion = createMotion(fixture);
    const dispose = installLegacySidebarAnimation({
      controller: fixture.controller,
      motion,
      reduceMotion: () => false,
    });

    dispose();

    expect(fixture.box.hidden).toBe(true);
    expect(fixture.splitter.hidden).toBe(true);
  });

  it("falls back to native close when clipped motion cannot start", () => {
    const fixture = createController();
    const report = vi.fn();
    installLegacySidebarAnimation({
      controller: fixture.controller,
      motion: {
        animate() {
          throw new Error("animation failed");
        },
      },
      reduceMotion: () => false,
      report,
    });

    fixture.controller.hide();

    expect(report).toHaveBeenCalledOnce();
    expect(fixture.events).toEqual(["hide"]);
  });
});

const createStyle = () => {
  const values = new Map<string, { priority: string; value: string }>();
  return {
    getPropertyPriority: (name: string) => values.get(name)?.priority ?? "",
    getPropertyValue: (name: string) => values.get(name)?.value ?? "",
    removeProperty: (name: string) => values.delete(name),
    setProperty: (name: string, value: string, priority = "") => {
      values.set(name, { priority, value });
    },
    values,
  };
};

describe("createClippedSidebarMotion", () => {
  it("reveals from the content edge without translating over the main sidebar", async () => {
    const style = createStyle();
    const animation = deferred();
    const nativeAnimation = {
      cancel: vi.fn(),
      currentTime: null as CSSNumberish | null,
      finished: animation.promise,
      pause: vi.fn(),
      play: vi.fn(),
    };
    const animate = vi.fn(
      (_: Keyframe[], _options?: KeyframeAnimationOptions) => nativeAnimation,
    );
    const box = {
      animate,
      getBoundingClientRect: () => ({ left: 100, width: 300 }),
      hidden: false,
      style,
    } as unknown as LegacySidebarElement;
    const splitter = { hidden: false } as LegacySidebarElement;
    const tabbox = {
      getBoundingClientRect: () => ({ left: 100, width: 1200 }),
    } as Element;
    const motion = createClippedSidebarMotion({
      box,
      durationMs: 200,
      splitter,
      tabbox,
    });

    const run = motion.animate("open");
    const [frames, options] = animate.mock.calls[0] ?? [];

    expect(frames).toEqual([
      { clipPath: "inset(0 300px 0 0)", marginRight: "-300px" },
      { clipPath: "inset(0 0 0 0)", marginRight: "0px" },
    ]);
    expect(frames).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ translate: expect.anything() })]),
    );
    expect(options).toEqual({ duration: 200, easing: "ease-in-out", fill: "both" });
    expect(nativeAnimation.pause).toHaveBeenCalledOnce();
    expect(nativeAnimation.currentTime).toBe(0);
    expect(nativeAnimation.play).not.toHaveBeenCalled();
    run?.start();
    expect(nativeAnimation.play).toHaveBeenCalledOnce();
    animation.resolve();
    await run?.finished;
    expect(style.values.size).toBe(0);
  });

  it("clips a right-side close toward its outer edge", async () => {
    const style = createStyle();
    const animation = deferred();
    const cancel = vi.fn();
    const animate = vi.fn((_: Keyframe[], _options?: KeyframeAnimationOptions) => ({
      cancel,
      finished: animation.promise,
    }));
    const box = {
      animate,
      getBoundingClientRect: () => ({ left: 1000, width: 280 }),
      hidden: false,
      style,
    } as unknown as LegacySidebarElement;
    const splitter = { hidden: false } as LegacySidebarElement;
    const tabbox = {
      getBoundingClientRect: () => ({ left: 80, width: 1200 }),
    } as Element;
    const motion = createClippedSidebarMotion({
      box,
      durationMs: 200,
      splitter,
      tabbox,
    });

    const run = motion.animate("close");
    const [frames] = animate.mock.calls[0] ?? [];

    expect(frames).toEqual([
      { clipPath: "inset(0 0 0 0)", marginLeft: "0px" },
      { clipPath: "inset(0 0 0 280px)", marginLeft: "-280px" },
    ]);
    expect(box.hidden).toBe(true);
    expect(splitter.hidden).toBe(true);
    animation.resolve();
    await run?.finished;
    expect(cancel).toHaveBeenCalledOnce();
  });
});
