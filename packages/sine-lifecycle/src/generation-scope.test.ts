import { describe, expect, it } from "vitest";

import { GenerationScope, type TimerPort } from "./generation-scope.js";

class ManualTimers implements TimerPort {
  #nextId = 1;
  readonly tasks = new Map<
    number,
    { callback: () => void; canceled: boolean; delayMs: number }
  >();

  readonly setTimeout = (callback: () => void, delayMs: number) => {
    const id = this.#nextId++;
    this.tasks.set(id, { callback, canceled: false, delayMs });
    return id;
  };

  readonly clearTimeout = (id: number) => {
    const task = this.tasks.get(id);
    if (task) {
      task.canceled = true;
    }
  };

  fire(id: number, force = false) {
    const task = this.tasks.get(id);
    if (!task || (task.canceled && !force)) {
      return false;
    }
    task.callback();
    return true;
  }
}

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
};

describe("GenerationScope", () => {
  it("becomes terminal before it drains every disposer in LIFO order", () => {
    const timers = new ManualTimers();
    const order: string[] = [];
    const errors: unknown[] = [];
    const scope = new GenerationScope({
      timers,
      onDisposeError: error => errors.push(error),
    });

    scope.defer(() => order.push(`first:${scope.isLive()}`));
    scope.defer(() => {
      order.push(`throwing:${scope.isLive()}`);
      throw new Error("expected disposer failure");
    });
    scope.defer(() => order.push(`last:${scope.isLive()}`));

    expect(scope.stop()).toBe(true);
    expect(scope.stop()).toBe(false);
    expect(scope.signal.aborted).toBe(true);
    expect(order).toEqual(["last:false", "throwing:false", "first:false"]);
    expect(errors).toHaveLength(1);
  });

  it("settles owned waits as stopped and ignores their later result", async () => {
    const gate = deferred<string>();
    const scope = new GenerationScope({ timers: new ManualTimers() });
    const result = scope.wait(gate.promise);

    scope.stop();
    await expect(result).resolves.toEqual({ kind: "stopped" });

    gate.resolve("stale");
    await Promise.resolve();
    expect(scope.isLive()).toBe(false);
  });

  it("cancels sleeps and makes forced stale timer delivery inert", async () => {
    const timers = new ManualTimers();
    const scope = new GenerationScope({ timers });
    const calls: string[] = [];
    const sleep = scope.sleep(100);
    scope.schedule(200, () => calls.push("scheduled"));
    const ids = [...timers.tasks.keys()];

    scope.stop();
    await expect(sleep).resolves.toBe("stopped");
    expect([...timers.tasks.values()].every(task => task.canceled)).toBe(true);

    for (const id of ids) {
      expect(timers.fire(id, true)).toBe(true);
    }
    expect(calls).toEqual([]);
  });

  it("disposes a resource immediately when it is offered after stop", () => {
    const scope = new GenerationScope({ timers: new ManualTimers() });
    const calls: string[] = [];

    scope.stop();
    scope.defer(() => calls.push("disposed"));

    expect(calls).toEqual(["disposed"]);
  });

  it("rejects async teardown without abandoning its rejection", async () => {
    const errors: unknown[] = [];
    const rejection = new Error("late async failure");
    const scope = new GenerationScope({
      timers: new ManualTimers(),
      onDisposeError: error => errors.push(error),
    });

    scope.defer(() => Promise.reject(rejection));
    expect(scope.stop()).toBe(true);
    await Promise.resolve();

    expect(errors).toHaveLength(2);
    expect(errors).toContain(rejection);
    expect(errors.some(error => error instanceof TypeError)).toBe(true);
  });

  it("continues past several failing disposers", () => {
    const errors: unknown[] = [];
    const calls: string[] = [];
    const scope = new GenerationScope({
      timers: new ManualTimers(),
      onDisposeError: error => errors.push(error),
    });
    scope.defer(() => {
      calls.push("first");
      throw new Error("first");
    });
    scope.defer(() => {
      calls.push("second");
      throw new Error("second");
    });

    expect(scope.stop()).toBe(true);
    expect(calls).toEqual(["second", "first"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(SuppressedError);
  });

  it("reports a rejection that wins before stop without hiding it", async () => {
    const gate = deferred<string>();
    const scope = new GenerationScope({ timers: new ManualTimers() });
    const result = scope.wait(gate.promise);
    const failure = new Error("readiness failed");

    gate.reject(failure);

    await expect(result).rejects.toBe(failure);
    expect(scope.isLive()).toBe(true);
  });

  it("releases stop subscriptions after completed waits and sleeps", async () => {
    const timers = new ManualTimers();
    const scope = new GenerationScope({ timers });

    await expect(
      Promise.all(Array.from({ length: 50 }, (_, index) => scope.wait(index))),
    ).resolves.toHaveLength(50);
    expect(scope.pendingWaits).toBe(0);

    const sleeps = Array.from({ length: 50 }, () => scope.sleep(10));
    for (const id of timers.tasks.keys()) {
      timers.fire(id);
    }
    await expect(Promise.all(sleeps)).resolves.toEqual(
      Array.from({ length: 50 }, () => "elapsed"),
    );
    expect(scope.pendingWaits).toBe(0);
    expect(scope.pendingTimers).toBe(0);
  });

  it("settles every sleep and drains every resource when reporting fails", async () => {
    let nextId = 1;
    const canceled: number[] = [];
    const disposed: string[] = [];
    const scope = new GenerationScope({
      timers: {
        setTimeout: () => nextId++,
        clearTimeout: id => {
          canceled.push(id);
          if (id === 1) {
            throw new Error("expected clear failure");
          }
        },
      },
      onDisposeError: () => {
        throw new Error("expected reporter failure");
      },
    });
    const sleep = scope.sleep(100);
    scope.schedule(200, () => {});
    scope.defer(() => disposed.push("first"));
    scope.defer(() => {
      disposed.push("second");
      throw new Error("expected disposer failure");
    });

    expect(() => scope.stop()).not.toThrow();
    await expect(sleep).resolves.toBe("stopped");

    expect(canceled).toEqual([1, 2]);
    expect(disposed).toEqual(["second", "first"]);
    expect(scope.signal.aborted).toBe(true);
    expect(scope.pendingWaits).toBe(0);
    expect(scope.pendingTimers).toBe(0);
  });

  it("drops the stop subscription when scheduling a sleep fails", async () => {
    const failure = new Error("expected scheduling failure");
    const scope = new GenerationScope({
      timers: {
        setTimeout: () => {
          throw failure;
        },
        clearTimeout: () => {},
      },
    });

    await expect(scope.sleep(100)).rejects.toBe(failure);
    expect(scope.pendingWaits).toBe(0);
    expect(scope.pendingTimers).toBe(0);
    expect(scope.stop()).toBe(true);
  });

  it("observes work rejected after the scope is already stopped", async () => {
    const failure = new Error("expected late rejection");
    const errors: unknown[] = [];
    const scope = new GenerationScope({
      timers: new ManualTimers(),
      onDisposeError: error => errors.push(error),
    });
    scope.stop();

    await expect(scope.wait(Promise.reject(failure))).resolves.toEqual({
      kind: "stopped",
    });
    await Promise.resolve();

    expect(errors).toEqual([failure]);
  });

  it("contains a reporter that rejects asynchronously", async () => {
    const scope = new GenerationScope({
      timers: new ManualTimers(),
      onDisposeError: async () => {
        throw new Error("expected asynchronous reporter failure");
      },
    });
    scope.defer(() => {
      throw new Error("expected disposer failure");
    });

    expect(() => scope.stop()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(scope.signal.aborted).toBe(true);
  });
});
