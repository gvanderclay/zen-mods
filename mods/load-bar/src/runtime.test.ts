import type { TimerPort } from "@zen-mods/sine-lifecycle/generation-scope";
import { describe, expect, it, vi } from "vitest";
import type { ActivityState, TerminalOutcome } from "./core/activity.ts";
import {
  type ActivityView,
  type BrowserProgressEvent,
  type BrowserProgressSource,
  type BrowserVisibilitySource,
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
  current: Browser[] = [];
  disposeCalls = 0;
  listener: ((event: BrowserProgressEvent<Browser>) => void) | null = null;
  retained: ((event: BrowserProgressEvent<Browser>) => void) | null = null;

  currentLoadingBrowsers(): readonly Browser[] {
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

class VisibilityHarness<Browser extends object>
  implements BrowserVisibilitySource<Browser>
{
  current: Browser[] = [];
  disposeCalls = 0;
  listener: ((browsers: readonly Browser[]) => void) | null = null;
  retained: ((browsers: readonly Browser[]) => void) | null = null;

  currentBrowsers(): readonly Browser[] {
    return this.current;
  }

  install(listener: (browsers: readonly Browser[]) => void): () => void {
    this.listener = listener;
    this.retained = listener;
    return () => {
      this.disposeCalls += 1;
      this.listener = null;
    };
  }

  show(...browsers: Browser[]): void {
    this.current = browsers;
    this.listener?.(browsers);
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

interface FakeBrowser {
  connected: boolean;
}

const setup = (current: FakeBrowser[] = [], visible: FakeBrowser[] = current) => {
  const timers = new FakeTimers();
  const progress = new ProgressHarness<FakeBrowser>();
  progress.current = current;
  const visibility = new VisibilityHarness<FakeBrowser>();
  visibility.current = visible;
  const views = new Map<FakeBrowser, ViewHarness[]>();
  const createView = vi.fn((browser: FakeBrowser) => {
    const view = new ViewHarness();
    const existing = views.get(browser) ?? [];
    existing.push(view);
    views.set(browser, existing);
    return view;
  });
  const errors: unknown[] = [];
  const controller = new LoadBarController({
    createView,
    isBrowserLive: browser => browser.connected,
    onError: error => errors.push(error),
    progress,
    revealDelayMs: 200,
    terminalDelayMs: {
      success: 220,
      canceled: 160,
      "network-error": 160,
    },
    timers,
    visibility,
  });
  return { controller, createView, errors, progress, timers, views, visibility };
};

const browser = (): FakeBrowser => ({ connected: true });
const latestView = (views: Map<FakeBrowser, ViewHarness[]>, value: FakeBrowser) =>
  views.get(value)?.at(-1);

const begin = <Browser extends object>(browser: Browser) =>
  ({ kind: "begin", browser }) as const;

const finish = <Browser extends object>(browser: Browser, outcome: TerminalOutcome) =>
  ({ kind: "finish", browser, outcome }) as const;

describe("LoadBarController", () => {
  it("seeds a load already active when the generation starts", () => {
    const current = browser();
    const { controller, views } = setup([current]);

    expect(controller.start()).toBe(true);
    expect(latestView(views, current)?.states).toEqual([{ kind: "waiting", token: 1 }]);
    expect(controller.snapshot()).toMatchObject({
      activeRecords: 1,
      live: true,
      pendingTimers: 1,
      started: true,
    });
  });

  it("keeps an instant load invisible and removes its exact view", () => {
    const current = browser();
    const { controller, progress, timers, views } = setup();
    controller.start();

    progress.emit(begin(current));
    progress.emit(finish(current, "success"));

    expect(views.get(current)).toBeUndefined();
    expect(timers.pending).toBe(0);
    expect(controller.snapshot().activeRecords).toBe(0);
  });

  it("reveals, completes, and settles a successful load", () => {
    const current = browser();
    const { controller, progress, timers, views } = setup([], [current]);
    controller.start();
    progress.emit(begin(current));

    timers.advance(199);
    expect(latestView(views, current)?.states.at(-1)?.kind).toBe("waiting");
    timers.advance(1);
    expect(latestView(views, current)?.states.at(-1)?.kind).toBe("visible");

    progress.emit(finish(current, "success"));
    expect(latestView(views, current)?.states.at(-1)).toEqual({
      kind: "completing",
      outcome: "success",
      token: 1,
    });
    timers.advance(219);
    expect(latestView(views, current)?.disposeCalls).toBe(0);
    timers.advance(1);
    expect(latestView(views, current)?.disposeCalls).toBe(1);
    expect(controller.snapshot().activeRecords).toBe(0);
  });

  it.each(["canceled", "network-error"] as const)(
    "fades a visible %s load without the success phase",
    outcome => {
      const current = browser();
      const { controller, progress, timers, views } = setup([], [current]);
      controller.start();
      progress.emit(begin(current));
      timers.advance(200);

      progress.emit(finish(current, outcome));
      expect(latestView(views, current)?.states.at(-1)).toEqual({
        kind: "canceling",
        outcome,
        token: 1,
      });
      timers.advance(160);
      expect(latestView(views, current)?.disposeCalls).toBe(1);
    },
  );

  it("supersedes a terminal navigation and makes its old timer inert", () => {
    const current = browser();
    const { controller, progress, timers, views } = setup([], [current]);
    controller.start();
    progress.emit(begin(current));
    timers.advance(200);
    progress.emit(finish(current, "success"));

    progress.emit(begin(current));
    expect(latestView(views, current)?.states.at(-1)).toEqual({
      kind: "waiting",
      token: 2,
    });
    timers.advance(200);
    expect(latestView(views, current)?.states.at(-1)).toEqual({
      kind: "visible",
      token: 2,
    });
    expect(latestView(views, current)?.disposeCalls).toBe(0);
  });

  it("tracks a hidden load and restores its current state when the pane becomes visible", () => {
    const hidden = browser();
    const { controller, createView, progress, timers, views, visibility } = setup();
    controller.start();

    progress.emit(begin(hidden));
    timers.advance(200);
    expect(createView).not.toHaveBeenCalled();
    expect(controller.snapshot()).toMatchObject({ activeRecords: 1, visibleRecords: 0 });

    visibility.show(hidden);
    expect(latestView(views, hidden)?.states).toEqual([{ kind: "visible", token: 1 }]);

    visibility.show();
    expect(latestView(views, hidden)?.disposeCalls).toBe(1);
    expect(controller.snapshot()).toMatchObject({ activeRecords: 1, visibleRecords: 0 });

    progress.emit(finish(hidden, "success"));
    timers.advance(220);
    expect(controller.snapshot().activeRecords).toBe(0);
  });

  it("owns independent views for every visible split browser", () => {
    const left = browser();
    const right = browser();
    const { controller, progress, timers, views } = setup([], [left, right]);
    controller.start();

    progress.emit(begin(left));
    progress.emit(begin(right));
    timers.advance(200);

    expect(latestView(views, left)?.states.at(-1)?.kind).toBe("visible");
    expect(latestView(views, right)?.states.at(-1)?.kind).toBe("visible");
    expect(controller.snapshot()).toMatchObject({ activeRecords: 2, visibleRecords: 2 });
  });

  it("drops a disconnected browser and makes retained visibility callbacks inert", () => {
    const removed = browser();
    const replacement = browser();
    const { controller, progress, timers, views, visibility } = setup([], [removed]);
    controller.start();
    progress.emit(begin(removed));
    timers.advance(200);

    removed.connected = false;
    visibility.show(replacement);
    expect(latestView(views, removed)?.disposeCalls).toBe(1);
    expect(controller.snapshot().activeRecords).toBe(0);

    controller.stop("sine-unload");
    visibility.retained?.([replacement]);
    expect(controller.snapshot()).toMatchObject({ activeRecords: 0, live: false });
  });

  it("stops terminally before draining the listener, timers, and views", () => {
    const current = browser();
    const { controller, progress, timers, views, visibility } = setup([], [current]);
    controller.start();
    progress.emit(begin(current));

    expect(controller.stop("window-unload")).toBe(true);
    expect(controller.stop("sine-unload")).toBe(false);
    expect(controller.stopReason).toBe("window-unload");
    expect(progress.disposeCalls).toBe(1);
    expect(visibility.disposeCalls).toBe(1);
    expect(timers.pending).toBe(0);
    expect(latestView(views, current)?.disposeCalls).toBe(1);
    expect(controller.snapshot()).toMatchObject({
      activeRecords: 0,
      live: false,
      pendingTimers: 0,
    });

    progress.retained?.(begin(browser()));
    expect(controller.snapshot().activeRecords).toBe(0);
  });

  it("fails closed when a platform view cannot be created safely", () => {
    const current = browser();
    const timers = new FakeTimers();
    const progress = new ProgressHarness<FakeBrowser>();
    const visibility = new VisibilityHarness<FakeBrowser>();
    visibility.current = [current];
    const error = new Error("missing pane container");
    const reported: unknown[] = [];
    const controller = new LoadBarController({
      createView: () => {
        throw error;
      },
      isBrowserLive: value => value.connected,
      onError: value => reported.push(value),
      progress,
      revealDelayMs: 200,
      terminalDelayMs: { success: 220, canceled: 160, "network-error": 160 },
      timers,
      visibility,
    });
    controller.start();

    progress.emit(begin(current));

    expect(controller.stopReason).toBe("platform-failure");
    expect(controller.isLive()).toBe(false);
    expect(progress.disposeCalls).toBe(1);
    expect(reported).toEqual([error]);
  });
});
