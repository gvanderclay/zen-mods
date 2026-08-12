import type { TimerPort } from "@zen-mods/sine-lifecycle/generation-scope";
import { describe, expect, it, vi } from "vitest";
import type { ActivityState, TerminalOutcome } from "./core/activity.ts";
import {
  type ActivityView,
  type BrowserProgressEvent,
  type BrowserProgressSource,
  LoadBarController,
} from "./runtime.ts";

class FakeTimers implements TimerPort {
  readonly #tasks = new Map<
    number,
    { readonly callback: () => void; readonly due: number }
  >();
  #nextHandle = 1;
  #now = 0;

  get pending(): number {
    return this.#tasks.size;
  }

  setTimeout(callback: () => void, delayMs: number): number {
    const handle = this.#nextHandle++;
    this.#tasks.set(handle, { callback, due: this.#now + delayMs });
    return handle;
  }

  clearTimeout(handle: number): void {
    this.#tasks.delete(handle);
  }

  advance(delayMs: number): void {
    const target = this.#now + delayMs;
    while (true) {
      const next = [...this.#tasks.entries()]
        .filter(([, task]) => task.due <= target)
        .sort((left, right) => left[1].due - right[1].due)[0];
      if (!next) {
        break;
      }
      this.#now = next[1].due;
      this.#tasks.delete(next[0]);
      next[1].callback();
    }
    this.#now = target;
  }
}

class ProgressHarness<Browser extends object> implements BrowserProgressSource<Browser> {
  current: Browser | null = null;
  disposeCalls = 0;
  listener: ((event: BrowserProgressEvent<Browser>) => void) | null = null;
  retained: ((event: BrowserProgressEvent<Browser>) => void) | null = null;

  currentLoadingBrowser(): Browser | null {
    return this.current;
  }

  install(listener: (event: BrowserProgressEvent<Browser>) => void): () => void {
    this.listener = listener;
    this.retained = listener;
    return () => {
      this.disposeCalls += 1;
      this.listener = null;
    };
  }

  emit(event: BrowserProgressEvent<Browser>): void {
    this.listener?.(event);
  }
}

class ViewHarness implements ActivityView {
  readonly states: ActivityState[] = [];
  disposeCalls = 0;

  render(state: ActivityState): void {
    this.states.push(state);
  }

  dispose(): void {
    this.disposeCalls += 1;
  }
}

const setup = (current: object | null = null) => {
  const timers = new FakeTimers();
  const progress = new ProgressHarness<object>();
  progress.current = current;
  const views = new Map<object, ViewHarness>();
  const createView = vi.fn((browser: object) => {
    const view = new ViewHarness();
    views.set(browser, view);
    return view;
  });
  const errors: unknown[] = [];
  const controller = new LoadBarController({
    createView,
    onError: error => errors.push(error),
    progress,
    revealDelayMs: 200,
    terminalDelayMs: {
      success: 220,
      canceled: 160,
      "network-error": 160,
    },
    timers,
  });
  return { controller, createView, errors, progress, timers, views };
};

const begin = <Browser extends object>(browser: Browser) =>
  ({ kind: "begin", browser }) as const;

const finish = <Browser extends object>(browser: Browser, outcome: TerminalOutcome) =>
  ({ kind: "finish", browser, outcome }) as const;

describe("LoadBarController", () => {
  it("seeds a load already active when the generation starts", () => {
    const browser = {};
    const { controller, views } = setup(browser);

    expect(controller.start()).toBe(true);
    expect(views.get(browser)?.states).toEqual([{ kind: "waiting", token: 1 }]);
    expect(controller.snapshot()).toMatchObject({
      activeRecords: 1,
      live: true,
      pendingTimers: 1,
      started: true,
    });
  });

  it("keeps an instant load invisible and removes its exact view", () => {
    const browser = {};
    const { controller, progress, timers, views } = setup();
    controller.start();

    progress.emit(begin(browser));
    progress.emit(finish(browser, "success"));

    expect(views.get(browser)?.states).toEqual([{ kind: "waiting", token: 1 }]);
    expect(views.get(browser)?.disposeCalls).toBe(1);
    expect(timers.pending).toBe(0);
    expect(controller.snapshot().activeRecords).toBe(0);
  });

  it("reveals, completes, and settles a successful load", () => {
    const browser = {};
    const { controller, progress, timers, views } = setup();
    controller.start();
    progress.emit(begin(browser));

    timers.advance(199);
    expect(views.get(browser)?.states.at(-1)?.kind).toBe("waiting");
    timers.advance(1);
    expect(views.get(browser)?.states.at(-1)?.kind).toBe("visible");

    progress.emit(finish(browser, "success"));
    expect(views.get(browser)?.states.at(-1)).toEqual({
      kind: "completing",
      outcome: "success",
      token: 1,
    });
    timers.advance(219);
    expect(views.get(browser)?.disposeCalls).toBe(0);
    timers.advance(1);
    expect(views.get(browser)?.disposeCalls).toBe(1);
    expect(controller.snapshot().activeRecords).toBe(0);
  });

  it.each(["canceled", "network-error"] as const)(
    "fades a visible %s load without the success phase",
    outcome => {
      const browser = {};
      const { controller, progress, timers, views } = setup();
      controller.start();
      progress.emit(begin(browser));
      timers.advance(200);

      progress.emit(finish(browser, outcome));
      expect(views.get(browser)?.states.at(-1)).toEqual({
        kind: "canceling",
        outcome,
        token: 1,
      });
      timers.advance(160);
      expect(views.get(browser)?.disposeCalls).toBe(1);
    },
  );

  it("supersedes a terminal navigation and makes its old timer inert", () => {
    const browser = {};
    const { controller, progress, timers, views } = setup();
    controller.start();
    progress.emit(begin(browser));
    timers.advance(200);
    progress.emit(finish(browser, "success"));

    progress.emit(begin(browser));
    expect(views.get(browser)?.states.at(-1)).toEqual({
      kind: "waiting",
      token: 2,
    });
    timers.advance(200);
    expect(views.get(browser)?.states.at(-1)).toEqual({
      kind: "visible",
      token: 2,
    });
    expect(views.get(browser)?.disposeCalls).toBe(0);
  });

  it("stops terminally before draining the listener, timers, and views", () => {
    const browser = {};
    const { controller, progress, timers, views } = setup();
    controller.start();
    progress.emit(begin(browser));

    expect(controller.stop("window-unload")).toBe(true);
    expect(controller.stop("sine-unload")).toBe(false);
    expect(controller.stopReason).toBe("window-unload");
    expect(progress.disposeCalls).toBe(1);
    expect(timers.pending).toBe(0);
    expect(views.get(browser)?.disposeCalls).toBe(1);
    expect(controller.snapshot()).toMatchObject({
      activeRecords: 0,
      live: false,
      pendingTimers: 0,
    });

    progress.retained?.(begin({}));
    expect(controller.snapshot().activeRecords).toBe(0);
  });

  it("fails closed when a platform view cannot be created safely", () => {
    const browser = {};
    const timers = new FakeTimers();
    const progress = new ProgressHarness<object>();
    const error = new Error("missing pane container");
    const reported: unknown[] = [];
    const controller = new LoadBarController({
      createView: () => {
        throw error;
      },
      onError: value => reported.push(value),
      progress,
      revealDelayMs: 200,
      terminalDelayMs: { success: 220, canceled: 160, "network-error": 160 },
      timers,
    });
    controller.start();

    progress.emit(begin(browser));

    expect(controller.stopReason).toBe("platform-failure");
    expect(controller.isLive()).toBe(false);
    expect(progress.disposeCalls).toBe(1);
    expect(reported).toEqual([error]);
  });
});
