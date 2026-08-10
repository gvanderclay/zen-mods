import { describe, expect, it } from "vitest";
import { createLifecycleModel } from "./lifecycle-model.mjs";

const settle = async () => {
  for (let turn = 0; turn < 4; turn += 1) {
    await Promise.resolve();
  }
};

const problemCategories = (model, generation) =>
  model.audit(generation).problems.map(problem => problem.category);

describe("lifecycle identity and ordering", () => {
  it("keeps windows and generations distinct while sharing one application carrier", () => {
    const model = createLifecycleModel();
    const windowA = model.window("a");
    const windowB = model.window("b");
    const a1 = model.load(windowA);
    const b1 = model.load(windowB);

    expect(a1.token).not.toBe(b1.token);
    expect(a1.token).toEqual({ id: "a@1", windowId: "a", ordinal: 1 });
    expect(b1.token).toEqual({ id: "b@1", windowId: "b", ordinal: 1 });
    expect(Object.isFrozen(a1)).toBe(true);
    expect(Object.isFrozen(a1.token)).toBe(true);
    expect(windowA.state).not.toBe(windowB.state);
    expect(a1.applicationCarrier).toBe(b1.applicationCarrier);

    a1.mutateApplication("seed application carrier", carrier => {
      carrier.owner = "seen through a";
    });
    expect(b1.applicationCarrier.owner).toBe("seen through a");
    expect(() => {
      b1.applicationCarrier.bypass = true;
    }).toThrow(/read-only/);
    a1.mutateWindow(windowA, "seed persistent window state", state => {
      state.reloads = 1;
    });
    expect(() => {
      windowA.state.bypass = true;
    }).toThrow(/read-only/);

    expect(model.stop(a1)).toBe(true);
    expect(model.stop(a1)).toBe(false);
    const a2 = model.load(windowA);

    expect(a2.token).toEqual({ id: "a@2", windowId: "a", ordinal: 2 });
    expect(a2.window.state).toBe(windowA.state);
    expect(a2.window.state.reloads).toBe(1);
    expect(a2.applicationCarrier).toBe(b1.applicationCarrier);
    expect(a1.isCurrent()).toBe(false);
    expect(a2.isCurrent()).toBe(true);
    expect(b1.isCurrent()).toBe(true);
    expect(windowA.lifecycle).toEqual([
      { order: 1, type: "load", generation: "a@1" },
      { order: 2, type: "stop", generation: "a@1" },
      { order: 3, type: "load", generation: "a@2" },
    ]);
  });

  it("rejects and records loading a replacement before its window stops", () => {
    const model = createLifecycleModel();
    const windowA = model.window("a");
    const current = model.load(windowA);

    expect(() => model.load(windowA)).toThrow(/must stop a@1 before loading/);

    expect(windowA.lifecycle).toEqual([
      { order: 1, type: "load", generation: "a@1" },
      { order: 2, type: "rejected-load", generation: "a@1" },
    ]);
    expect(problemCategories(model, current)).toEqual(["lifecycle-order"]);
  });

  it("records both A-first and B-first two-window reload order", () => {
    const run = firstId => {
      const model = createLifecycleModel();
      const a1 = model.load(model.window("a"));
      const b1 = model.load(model.window("b"));
      const first = firstId === "a" ? a1 : b1;
      const second = firstId === "a" ? b1 : a1;
      model.stop(first);
      model.load(model.window(firstId));
      model.stop(second);
      model.load(model.window(firstId === "a" ? "b" : "a"));
      return {
        a: model.window("a").lifecycle.map(event => event.type),
        b: model.window("b").lifecycle.map(event => event.type),
      };
    };

    expect(run("a")).toEqual({
      a: ["load", "stop", "load"],
      b: ["load", "stop", "load"],
    });
    expect(run("b")).toEqual({
      a: ["load", "stop", "load"],
      b: ["load", "stop", "load"],
    });
  });
});

describe("controllable asynchronous boundaries", () => {
  it("releases owner-tagged readiness and pause gates independently", async () => {
    const model = createLifecycleModel();
    const windowA = model.window("a");
    const generation = model.load(windowA);
    const operation = model.gate("wake-poll");
    const order = [];

    const task = (async () => {
      await generation.wait(model.application.ready);
      order.push(model.application.ready.name);
      await generation.wait(windowA.ready);
      order.push(windowA.ready.name);
      await generation.wait(operation);
      order.push(operation.name);
    })();

    await settle();
    expect(model.application.ready.reached).toBe(true);
    expect(model.application.ready.waiterCount).toBe(1);
    expect(model.audit(generation).waits.map(wait => wait.gate)).toEqual([
      "application-ready",
    ]);
    expect(order).toEqual([]);

    model.application.ready.release();
    await settle();
    expect(model.application.ready.waiterCount).toBe(0);
    expect(windowA.ready.waiterCount).toBe(1);
    expect(model.audit(generation).waits.map(wait => wait.gate)).toEqual([
      "window-a-ready",
    ]);
    expect(order).toEqual(["application-ready"]);

    windowA.ready.release();
    await settle();
    expect(windowA.ready.waiterCount).toBe(0);
    expect(operation.waiterCount).toBe(1);
    expect(model.audit(generation).waits.map(wait => wait.gate)).toEqual(["wake-poll"]);

    operation.release();
    await task;
    expect(operation.waiterCount).toBe(0);
    expect(model.audit(generation).waits).toEqual([]);
    expect(order).toEqual(["application-ready", "window-a-ready", "wake-poll"]);
  });

  it("settles owner-tagged gates on both resolve and reject without stranded waits", async () => {
    const model = createLifecycleModel();
    const generation = model.load(model.window("a"));
    const resolvedGate = model.gate("resolved-operation");
    const rejectedGate = model.gate("rejected-operation");
    const resolved = generation.wait(resolvedGate);
    const rejected = generation.wait(rejectedGate);
    const rejectedAssertion = expect(rejected).rejects.toThrow("deliberate rejection");

    expect(model.audit(generation).waits).toHaveLength(2);
    resolvedGate.release("done");
    rejectedGate.reject(new Error("deliberate rejection"));

    await expect(resolved).resolves.toBe("done");
    await rejectedAssertion;
    await settle();
    expect(resolvedGate.waiterCount).toBe(0);
    expect(rejectedGate.waiterCount).toBe(0);
    expect(model.audit(generation).waits).toEqual([]);
  });

  it("runs timers by deadline and same-deadline registration order", () => {
    const model = createLifecycleModel({ now: 100 });
    const generation = model.load(model.window("a"));
    const order = [];

    generation.setTimeout(() => order.push("late"), 20);
    generation.setTimeout(() => order.push("first"), 10);
    generation.setTimeout(() => order.push("second"), 10);

    model.clock.advanceBy(9);
    expect(order).toEqual([]);
    model.clock.advanceBy(1);
    expect(order).toEqual(["first", "second"]);
    model.clock.advanceBy(10);
    expect(order).toEqual(["first", "second", "late"]);
    expect(model.clock.now).toBe(120);
  });
});

describe("guarded deterministic state", () => {
  it("guards nested window state and catches a closure that writes another window", () => {
    const model = createLifecycleModel();
    const windowA = model.window("a");
    const windowB = model.window("b");
    const a = model.load(windowA);
    const b = model.load(windowB);
    const externalSeed = { rows: [{ value: "a" }] };
    a.mutateWindow(windowA, "seed A nested state", state => {
      state.nested = externalSeed;
    });
    b.mutateWindow(windowB, "seed B nested state", state => {
      state.nested = { rows: [{ value: "b" }] };
    });
    externalSeed.rows[0].value = "alias bypass";

    expect(windowA.state.nested.rows[0].value).toBe("a");
    expect(Object.getPrototypeOf(windowA.state.nested.rows)).toBeNull();
    expect(windowA.state.nested.rows.constructor).toBeUndefined();
    const nestedDescriptor = Object.getOwnPropertyDescriptor(
      windowA.state.nested.rows,
      "0",
    );
    expect(() => {
      nestedDescriptor.value.value = "descriptor bypass";
    }).toThrow(/read-only/);
    expect(() => {
      windowA.state.nested.rows[0].value = "bypass";
    }).toThrow(/read-only/);
    expect(() =>
      a.mutateWindow(windowA, "nested foreign write", () => {
        windowB.state.nested.rows[0].value = "wrong";
      }),
    ).toThrow(/wrong-window mutation/);

    expect(windowA.state.nested.rows[0].value).toBe("a");
    expect(windowB.state.nested.rows[0].value).toBe("b");
    expect(problemCategories(model, a)).toEqual(["wrong-window-mutation"]);
  });

  it("shares a recursively guarded application carrier and audits a stale app write", () => {
    const model = createLifecycleModel();
    const windowA = model.window("a");
    const a1 = model.load(windowA);
    const b1 = model.load(model.window("b"));
    a1.mutateApplication("seed shared application state", carrier => {
      carrier.shared = { queue: ["first"] };
    });

    expect(b1.applicationCarrier.shared.queue).toEqual(["first"]);
    expect(() => {
      b1.applicationCarrier.shared.queue.push("bypass");
    }).toThrow(/read-only/);

    model.stop(a1);
    model.load(windowA);
    expect(() =>
      a1.mutateApplication("stale shared write", carrier => {
        carrier.shared.queue.push("stale");
      }),
    ).toThrow(/stale continuation/);
    expect(b1.applicationCarrier.shared.queue).toEqual(["first"]);
    expect(model.audit(a1).violations.at(-1)).toMatchObject({
      category: "stale-continuation",
      actor: "a@1",
      target: "application",
    });
  });

  it("cannot reach inherited mutable objects through a guarded array", () => {
    const model = createLifecycleModel();
    const generation = model.load(model.window("a"));
    const marker = "__keepLoadedLifecycleEscape";
    const unscopables = Array.prototype[Symbol.unscopables];
    delete unscopables[marker];
    generation.mutateWindow(generation.window, "seed guarded array", state => {
      state.rows = [];
    });

    try {
      expect(() =>
        generation.mutateWindow(
          generation.window,
          "attempt inherited object mutation",
          state => {
            state.rows[Symbol.unscopables][marker] = true;
          },
        ),
      ).toThrow(/harness contract.*inherited mutable objects/);
      expect(Object.hasOwn(unscopables, marker)).toBe(false);
    } finally {
      delete unscopables[marker];
    }

    expect(problemCategories(model, generation)).toEqual(["harness-contract"]);
  });

  it("cannot mutate inherited array function objects through guarded state", () => {
    const model = createLifecycleModel();
    const generation = model.load(model.window("a"));
    const marker = "__keepLoadedLifecycleFunctionEscape";
    delete Array.prototype.push[marker];
    generation.mutateWindow(generation.window, "seed guarded array", state => {
      state.rows = [];
    });

    try {
      const guardedPush = generation.window.state.rows.push;
      guardedPush[marker] = true;
      const inheritedFunctionPrototype = Object.getPrototypeOf(guardedPush);
      if (inheritedFunctionPrototype) {
        inheritedFunctionPrototype[marker] = true;
      }
      expect(Object.getPrototypeOf(guardedPush)).toBeNull();
      expect(guardedPush.constructor).toBeUndefined();
      expect(Object.hasOwn(Array.prototype.push, marker)).toBe(false);
      expect(Object.hasOwn(Function.prototype, marker)).toBe(false);
    } finally {
      delete Array.prototype.push[marker];
      delete Function.prototype[marker];
    }

    generation.mutateWindow(generation.window, "append through guarded method", state => {
      state.rows.push("kept");
    });
    expect(generation.window.state.rows).toEqual(["kept"]);

    expect(problemCategories(model, generation)).toEqual([]);
  });

  it("preserves an ordinary own constructor key without exposing prototypes", () => {
    const model = createLifecycleModel();
    const generation = model.load(model.window("a"));
    generation.mutateWindow(
      generation.window,
      "store JSON-like constructor key",
      state => {
        state.record = { constructor: "ordinary value" };
        state.rows = [];
      },
    );

    expect(generation.window.state.record.constructor).toBe("ordinary value");
    expect(generation.window.state.rows.constructor).toBeUndefined();
    expect(Object.keys(generation.window.state.record)).toEqual(["constructor"]);
    expect(problemCategories(model, generation)).toEqual([]);
  });

  it("rejects mutable collections and class instances with a harness-contract error", () => {
    const model = createLifecycleModel();
    const generation = model.load(model.window("a"));

    for (const value of [
      new Map(),
      new WeakMap(),
      new Set(),
      new WeakSet(),
      new Date(),
      new (class Mutable {})(),
    ]) {
      expect(() =>
        generation.mutateApplication("unsupported carrier value", carrier => {
          carrier.value = value;
        }),
      ).toThrow(/harness contract.*plain objects and arrays/);
    }

    expect(generation.applicationCarrier.value).toBeUndefined();
    expect(problemCategories(model, generation)).toEqual([
      "harness-contract",
      "harness-contract",
      "harness-contract",
      "harness-contract",
      "harness-contract",
      "harness-contract",
    ]);
  });

  it("rejects thenable mutation callbacks, rolls back their writes, and audits the contract", async () => {
    const model = createLifecycleModel();
    const generation = model.load(model.window("a"));

    expect(() =>
      generation.mutateWindow(generation.window, "async window mutation", state => {
        state.changed = true;
        return Promise.resolve();
      }),
    ).toThrow(/harness contract.*synchronous/);
    expect(() =>
      generation.mutateApplication("async app mutation", carrier => {
        carrier.changed = true;
        return Promise.reject(new Error("late rejection"));
      }),
    ).toThrow(/harness contract.*synchronous/);

    await settle();
    expect(generation.window.state.changed).toBeUndefined();
    expect(generation.applicationCarrier.changed).toBeUndefined();
    expect(problemCategories(model, generation)).toEqual([
      "harness-contract",
      "harness-contract",
    ]);
  });

  it("requires synchronous unload cleanup and still stops exactly once", async () => {
    const model = createLifecycleModel();
    const generation = model.load(model.window("a"));
    generation.onUnload(() => Promise.reject(new Error("late unload rejection")));

    expect(() => model.stop(generation)).toThrow(/harness contract.*synchronous unload/);
    await settle();

    expect(generation.isCurrent()).toBe(false);
    expect(model.stop(generation)).toBe(false);
    expect(generation.window.lifecycle.map(event => event.type)).toEqual([
      "load",
      "stop",
    ]);
    expect(problemCategories(model, generation)).toEqual(["harness-contract"]);
  });

  it("durably audits a synchronous unload failure while still stopping", () => {
    const model = createLifecycleModel();
    const generation = model.load(model.window("a"));
    generation.onUnload(() => {
      throw new Error("deliberate teardown failure");
    });

    expect(() => model.stop(generation)).toThrow("deliberate teardown failure");
    expect(generation.isCurrent()).toBe(false);
    expect(model.stop(generation)).toBe(false);
    expect(problemCategories(model, generation)).toEqual(["teardown-error"]);
    expect(() => model.assertClean(generation)).toThrow(
      /teardown error.*deliberate teardown failure/,
    );
  });
});

describe("cleanup and fault audit", () => {
  it("accepts complete cleanup and a guarded continuation from an old generation", async () => {
    const model = createLifecycleModel();
    const windowA = model.window("a");
    const old = model.load(windowA);
    const paused = model.gate("panel-completion");
    let mutations = 0;
    let listenerCalls = 0;
    let timerCalls = 0;
    let continuationResumed = false;

    const removeListener = old.listen(windowA.events, "resume", () => {
      listenerCalls += 1;
    });
    const timer = old.setTimeout(() => {
      timerCalls += 1;
    }, 50);
    old.onUnload(() => {
      removeListener();
      old.clearTimeout(timer);
    });

    const continuation = (async () => {
      await old.wait(paused);
      continuationResumed = true;
      if (old.isCurrent()) {
        old.mutateWindow(windowA, "old panel fill", () => {
          mutations += 1;
        });
      }
    })();

    await settle();
    expect(paused.waiterCount).toBe(1);
    windowA.events.dispatch("resume");
    expect(listenerCalls).toBe(1);
    expect(model.clock.has(timer)).toBe(true);
    expect(model.audit(old).timers).toHaveLength(1);

    model.stop(old);
    const replacement = model.load(windowA);
    paused.release();
    await continuation;

    expect(replacement.isCurrent()).toBe(true);
    expect(continuationResumed).toBe(true);
    expect(mutations).toBe(0);
    expect(model.clock.has(timer)).toBe(false);
    expect(timerCalls).toBe(0);
    windowA.events.dispatch("resume");
    expect(listenerCalls).toBe(1);
    expect(model.audit(old)).toMatchObject({
      clean: true,
      listeners: [],
      timers: [],
      waits: [],
      violations: [],
    });
    expect(() => model.assertClean(old)).not.toThrow();
  });

  it("records a stale listener delivery even when its callback removes itself", () => {
    const model = createLifecycleModel();
    const windowA = model.window("a");
    const generation = model.load(windowA);
    let calls = 0;
    let removeListener;
    removeListener = generation.listen(windowA.events, "resume", () => {
      calls += 1;
      removeListener();
    });

    model.stop(generation);
    expect(problemCategories(model, generation)).toEqual(["leaked-listener"]);
    windowA.events.dispatch("resume");

    expect(calls).toBe(1);
    expect(model.audit(generation).listeners).toEqual([]);
    expect(problemCategories(model, generation)).toEqual([
      "leaked-listener",
      "stale-callback",
    ]);
    expect(model.audit(generation).violations[0]).toMatchObject({
      category: "stale-callback",
      actor: "a@1",
      source: "listener",
      target: "a",
    });
  });

  it("records a stale timer delivery after proving the timer leaked", () => {
    const model = createLifecycleModel();
    const generation = model.load(model.window("a"));
    let calls = 0;
    const timer = generation.setTimeout(() => {
      calls += 1;
    }, 50);

    model.stop(generation);
    expect(model.clock.has(timer)).toBe(true);
    expect(problemCategories(model, generation)).toEqual(["leaked-timer"]);
    expect(model.clock.force(timer)).toBe(true);

    expect(calls).toBe(1);
    expect(model.audit(generation).timers).toEqual([]);
    expect(problemCategories(model, generation)).toEqual([
      "leaked-timer",
      "stale-callback",
    ]);
    expect(model.clock.force(timer)).toBe(false);
  });

  it("keeps stop-boundary listener and timer leaks visible after late cleanup", () => {
    const model = createLifecycleModel();
    const generation = model.load(model.window("a"));
    const removeListener = generation.listen(
      generation.window.events,
      "resume",
      () => {},
    );
    const timer = generation.setTimeout(() => {}, 50);

    model.stop(generation);
    expect(problemCategories(model, generation)).toEqual([
      "leaked-listener",
      "leaked-timer",
    ]);

    removeListener();
    generation.clearTimeout(timer);

    expect(model.audit(generation)).toMatchObject({ listeners: [], timers: [] });
    expect(problemCategories(model, generation)).toEqual([
      "leaked-listener",
      "leaked-timer",
    ]);
    expect(() => model.assertClean(generation)).toThrow(/leaked listener.*leaked timer/);
  });

  it("can force one canceled timer tombstone without allowing stale mutation or re-arm", () => {
    const model = createLifecycleModel();
    const windowA = model.window("a");
    const old = model.load(windowA);
    let calls = 0;
    let nestedWriteDenied = false;
    old.mutateWindow(windowA, "seed nested timer state", state => {
      state.nested = { value: "before" };
    });
    const capturedNested = windowA.state.nested;
    const timer = old.setTimeout(() => {
      calls += 1;
      try {
        capturedNested.value = "stale";
      } catch {
        nestedWriteDenied = true;
      }
      try {
        old.mutateWindow(windowA, "canceled timer mutation", state => {
          state.changed = true;
        });
      } catch {}
      try {
        old.setTimeout(() => {}, 1);
      } catch {}
    }, 50);
    old.onUnload(() => old.clearTimeout(timer));

    model.stop(old);
    model.load(windowA);
    expect(model.clock.has(timer)).toBe(false);
    expect(model.clock.force(timer)).toBe(true);

    expect(calls).toBe(1);
    expect(nestedWriteDenied).toBe(true);
    expect(windowA.state.nested.value).toBe("before");
    expect(windowA.state.changed).toBeUndefined();
    expect(model.audit(old).timers).toEqual([]);
    expect(problemCategories(model, old)).toEqual([
      "stale-callback",
      "stale-continuation",
      "stale-registration",
    ]);
    expect(model.audit(old).violations.at(-1)).toMatchObject({
      category: "stale-registration",
      actor: "a@1",
      resource: "timer",
    });
    expect(model.clock.force(timer)).toBe(false);
  });

  it("fails closed when a stopped generation resumes a stale promise continuation", async () => {
    const model = createLifecycleModel();
    const windowA = model.window("a");
    const old = model.load(windowA);
    const paused = model.gate("stale-wake");
    const continuation = (async () => {
      await old.wait(paused);
      old.mutateWindow(windowA, "restore old preference", () => {});
    })();

    await settle();
    expect(paused.waiterCount).toBe(1);
    model.stop(old);
    expect(problemCategories(model, old)).toEqual(["pending-wait"]);
    model.load(windowA);
    paused.release();

    await expect(continuation).rejects.toThrow(/stale continuation/);
    expect(model.audit(old).waits).toEqual([]);
    expect(problemCategories(model, old)).toEqual(["stale-continuation"]);
  });

  it("makes window state read-only except through the actor-tagged mutation boundary", () => {
    const model = createLifecycleModel();
    const windowA = model.window("a");
    const windowB = model.window("b");
    const generation = model.load(windowA);

    expect(() => {
      windowB.state.value = "bypass";
    }).toThrow(/read-only/);
    expect(() =>
      generation.mutateWindow(windowA, "closure writes foreign state", () => {
        windowB.state.value = "wrong";
      }),
    ).toThrow(/wrong-window mutation/);

    expect(windowB.state.value).toBeUndefined();
    expect(problemCategories(model, generation)).toEqual(["wrong-window-mutation"]);
    expect(model.audit(generation).violations).toEqual([
      {
        category: "wrong-window-mutation",
        actor: "a@1",
        target: "b",
        label: "closure writes foreign state",
      },
    ]);
  });

  it("durably records denied stale listener, timer, and unload registration", () => {
    const model = createLifecycleModel();
    const windowA = model.window("a");
    const old = model.load(windowA);
    model.stop(old);
    model.load(windowA);

    expect(() => old.listen(windowA.events, "resume", () => {})).toThrow(/stopped/);
    expect(() => old.setTimeout(() => {}, 1)).toThrow(/stopped/);
    expect(() => old.onUnload(() => {})).toThrow(/stopped/);

    expect(problemCategories(model, old)).toEqual([
      "stale-registration",
      "stale-registration",
      "stale-registration",
    ]);
    expect(model.audit(old).violations.map(violation => violation.resource)).toEqual([
      "listener",
      "timer",
      "unload",
    ]);
  });

  it("keeps A cleanup from hiding or canceling B listener and timer controls", () => {
    const model = createLifecycleModel();
    const windowA = model.window("a");
    const windowB = model.window("b");
    const a = model.load(windowA);
    const b = model.load(windowB);
    let bListenerCalls = 0;
    let bTimerCalls = 0;
    const removeA = a.listen(windowA.events, "resume", () => {});
    const aTimer = a.setTimeout(() => {}, 10);
    const removeB = b.listen(windowB.events, "resume", () => {
      bListenerCalls += 1;
    });
    const bTimer = b.setTimeout(() => {
      bTimerCalls += 1;
    }, 10);
    a.onUnload(() => {
      removeA();
      a.clearTimeout(aTimer);
    });

    expect(() => b.clearTimeout(aTimer)).toThrow(/owned by a@1/);
    expect(model.clock.has(aTimer)).toBe(true);

    model.stop(a);
    windowB.events.dispatch("resume");

    expect(bListenerCalls).toBe(1);
    expect(model.clock.has(bTimer)).toBe(true);
    expect(model.clock.force(bTimer)).toBe(true);
    expect(bTimerCalls).toBe(1);
    removeB();
    expect(model.audit(a).clean).toBe(true);
    expect(problemCategories(model, b)).toEqual(["wrong-resource-owner"]);
  });
});
