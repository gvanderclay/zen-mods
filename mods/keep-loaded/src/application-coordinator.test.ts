import { describe, expect, it, vi } from "vitest";

import {
  type ApplicationRegistration,
  KeepLoadedApplicationOwner,
  type StatusWidgetViewShowing,
  type WindowWorkDelegate,
  type WorkContext,
  type WorkReceipt,
} from "./application-coordinator.ts";

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
};

const settle = async (turns = 8) => {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve();
  }
};

const waitFor = async (condition: () => boolean, label: string) => {
  for (let turn = 0; turn < 80; turn += 1) {
    if (condition()) {
      return;
    }
    await settle(2);
  }
  throw new Error(`timed out waiting for ${label}`);
};

interface Evidence {
  revision: number;
}

interface Tab {
  id: string;
}

class ManualOwnerTimers {
  nowValue = 0;
  #nextId = 1;
  readonly tasks = new Map<
    number,
    { at: number; callback: () => void; canceled: boolean }
  >();

  readonly now = () => this.nowValue;

  readonly setTimeout = (callback: () => void, delayMs: number) => {
    const id = this.#nextId++;
    this.tasks.set(id, { at: this.nowValue + delayMs, callback, canceled: false });
    return id;
  };

  readonly clearTimeout = (handle: unknown) => {
    const task = this.tasks.get(handle as number);
    if (task) {
      task.canceled = true;
    }
  };

  advance(ms: number) {
    this.nowValue += ms;
    for (;;) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => !task.canceled && task.at <= this.nowValue)
        .sort(([, left], [, right]) => left.at - right.at || 0)[0];
      if (!next) {
        return;
      }
      const [id, task] = next;
      this.tasks.delete(id);
      if (!task.canceled) {
        task.callback();
      }
    }
  }
}

const ownerHarness = () => {
  let onDemand = true;
  const writes: boolean[] = [];
  const errors: unknown[] = [];
  const owner = new KeepLoadedApplicationOwner<Tab, Evidence>({
    applicationId: "application-test",
    preferences: {
      readOnDemand: () => onDemand,
      writeOnDemand: value => {
        onDemand = value;
        writes.push(value);
      },
    },
    reportError: error => errors.push(error),
    timers: {
      clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
      now: Date.now,
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    },
  });
  return { errors, onDemand: () => onDemand, owner, writes };
};

const delegate = (
  overrides: Partial<WindowWorkDelegate<Tab, Evidence>> = {},
): WindowWorkDelegate<Tab, Evidence> => ({
  isLive: () => true,
  recover: () => {},
  reportError: () => {},
  sweep: () => {},
  ...overrides,
});

describe("KeepLoadedApplicationOwner", () => {
  it("drives the process-wide pulse schedule from its intended deadline", async () => {
    const timers = new ManualOwnerTimers();
    const trace: string[] = [];
    let active = 0;
    let maxActive = 0;
    const owner = new KeepLoadedApplicationOwner<Tab, Evidence>({
      applicationId: "pulse-schedule-test",
      preferences: { readOnDemand: () => true, writeOnDemand: () => {} },
      timers,
    });
    const pulse = (name: string) => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      trace.push(`${name}:start`);
      await Promise.resolve();
      trace.push(`${name}:end`);
      active -= 1;
    };
    const registrationA = owner.register(delegate({ pulse: pulse("A") }));
    owner.register(delegate({ pulse: pulse("B") }));
    registrationA.setPulseSchedule({ everyMs: 30, holdMs: 10 });

    timers.advance(29);
    expect(trace).toEqual([]);
    timers.advance(1);
    await settle();
    expect(trace).toEqual(["A:start", "A:end", "B:start", "B:end"]);
    expect(maxActive).toBe(1);
    registrationA.setPulseSchedule({ everyMs: 0, holdMs: 0 });
    timers.advance(1000);
    await settle();
    expect(trace).toEqual(["A:start", "A:end", "B:start", "B:end"]);
  });

  it("runs one application-wide pulse serially across windows and coalesces one trailing cycle", async () => {
    const { owner } = ownerHarness();
    const firstGate = deferred();
    const trace: string[] = [];
    let active = 0;
    let maxActive = 0;
    const registrationA = owner.register(
      delegate({
        pulse: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          trace.push("A:start");
          await firstGate.promise;
          trace.push("A:end");
          active -= 1;
        },
      }),
    );
    const registrationB = owner.register(
      delegate({
        pulse: () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          trace.push("B");
          active -= 1;
        },
      }),
    );

    const first = registrationA.requestPulse().done;
    await waitFor(() => trace.length === 1, "active pulse");
    const trailing = registrationB.requestPulse().done;
    expect(owner.snapshot()).toMatchObject({
      activeCount: 1,
      activeKind: "pulse",
      trailingCount: 1,
    });
    firstGate.resolve();
    await expect(first).resolves.toBe("completed");
    await expect(trailing).resolves.toBe("completed");

    expect(trace).toEqual(["A:start", "A:end", "B", "A:start", "A:end", "B"]);
    expect(maxActive).toBe(1);
    registrationA.dispose();
    registrationB.dispose();
  });

  it("does not cancel an application-wide pulse when one unrelated tab is invalidated", async () => {
    const { owner } = ownerHarness();
    const gate = deferred();
    const trace: string[] = [];
    const registration = owner.register(
      delegate({
        pulse: async () => {
          trace.push("start");
          await gate.promise;
          trace.push("end");
        },
      }),
    );
    const running = registration.requestPulse().done;
    await waitFor(() => trace.length === 1, "active pulse");

    expect(registration.invalidateTab({ id: "unrelated" })).toBe(false);
    expect(owner.snapshot()).toMatchObject({
      activeCount: 1,
      activeKind: "pulse",
      drainingCount: 0,
    });

    gate.resolve();
    await expect(running).resolves.toBe("completed");
    expect(trace).toEqual(["start", "end"]);
    registration.dispose();
  });

  it("keeps a duplicate recovery in its original FIFO slot with the newest evidence", async () => {
    const { owner } = ownerHarness();
    const sweepGate = deferred();
    const trace: string[] = [];
    const registration = owner.register(
      delegate({
        sweep: async () => {
          trace.push("sweep");
          await sweepGate.promise;
        },
        recover: (_context, tab, evidence) => {
          trace.push(`${tab.id}:${evidence.revision}`);
        },
      }),
    );
    const tabA = { id: "a" };
    const tabB = { id: "b" };

    const running = registration.requestSweep().done;
    await waitFor(() => trace.length === 1, "active sweep");
    const firstA = registration.requestRecovery(tabA, { revision: 1 }).done;
    const requestB = registration.requestRecovery(tabB, { revision: 1 }).done;
    const newestA = registration.requestRecovery(tabA, { revision: 2 }).done;

    expect(owner.snapshot()).toMatchObject({
      activeCount: 1,
      keyRecords: 3,
      readyCount: 2,
      trailingCount: 0,
    });

    sweepGate.resolve();
    await Promise.all([running, firstA, requestB, newestA]);

    expect(trace).toEqual(["sweep", "a:2", "b:1"]);
    expect(owner.snapshot()).toMatchObject({
      activeCount: 0,
      keyRecords: 0,
      readyCount: 0,
    });
  });

  it("keeps crash attempts on the stable owner across registration replacement", () => {
    const { owner } = ownerHarness();
    const tab = { id: "persistent" };
    const first = owner.register(delegate());

    expect(first.recentRecoveryAttempts(tab, 10_000, 60_000)).toEqual([]);
    expect(first.chargeRecoveryAttempt(tab, 10_000, 60_000)).toEqual([10_000]);
    first.dispose("generation-ended");

    const replacement = owner.register(delegate());
    expect(replacement.recentRecoveryAttempts(tab, 20_000, 60_000)).toEqual([10_000]);
    expect(replacement.chargeRecoveryAttempt(tab, 30_000, 60_000)).toEqual([
      10_000, 30_000,
    ]);
  });

  it("ages crash attempts and does not let a stale registration charge them", () => {
    const { owner } = ownerHarness();
    const tab = { id: "aging" };
    const old = owner.register(delegate());

    expect(old.chargeRecoveryAttempt(tab, 10_000, 60_000)).toEqual([10_000]);
    old.dispose("generation-ended");
    const current = owner.register(delegate());

    expect(current.recentRecoveryAttempts(tab, 70_001, 60_000)).toEqual([]);
    expect(old.chargeRecoveryAttempt(tab, 70_001, 60_000)).toBe(false);
    expect(current.recentRecoveryAttempts(tab, 70_001, 60_000)).toEqual([]);
  });

  it("moves one trailing hot-key round behind older keys instead of starving them", async () => {
    const { owner } = ownerHarness();
    const firstGate = deferred();
    const trace: string[] = [];
    const registration = owner.register(
      delegate({
        recover: async (_context, tab, evidence) => {
          trace.push(`${tab.id}:${evidence.revision}`);
          if (tab.id === "a" && evidence.revision === 0) {
            await firstGate.promise;
          }
        },
      }),
    );
    const tabA = { id: "a" };
    const tabB = { id: "b" };
    const tabC = { id: "c" };

    const receipts = [registration.requestRecovery(tabA, { revision: 0 }).done];
    await waitFor(() => trace.length === 1, "active recovery A");
    receipts.push(registration.requestRecovery(tabB, { revision: 0 }).done);
    receipts.push(registration.requestRecovery(tabC, { revision: 0 }).done);
    for (let revision = 1; revision <= 100; revision += 1) {
      receipts.push(registration.requestRecovery(tabA, { revision }).done);
    }

    expect(owner.snapshot()).toMatchObject({
      keyRecords: 3,
      trailingCount: 1,
    });

    firstGate.resolve();
    await Promise.all(receipts);

    expect(trace).toEqual(["a:0", "b:0", "c:0", "a:100"]);
  });

  it("fans one sweep out to every currently registered live window", async () => {
    const { owner } = ownerHarness();
    const blocker = deferred();
    const trace: string[] = [];
    const tab = { id: "blocker" };
    const registrationA = owner.register(
      delegate({
        recover: async () => blocker.promise,
        sweep: () => {
          trace.push("a");
        },
      }),
    );
    const registrationB = owner.register(
      delegate({
        sweep: () => {
          trace.push("b");
        },
      }),
    );

    const active = registrationA.requestRecovery(tab, { revision: 0 }).done;
    await waitFor(() => owner.snapshot().activeKind === "recovery", "active blocker");
    const sweep = registrationA.requestSweep().done;
    registrationB.dispose("window-closed");
    const registrationC = owner.register(
      delegate({
        sweep: () => {
          trace.push("c");
        },
      }),
    );

    blocker.resolve();
    await Promise.all([active, sweep]);

    expect(trace).toEqual(["a", "c"]);
    expect(registrationC.isApplicationBusy()).toBe(false);
  });

  it("keeps a canceled active window as an inert drain until its work settles", async () => {
    const { owner } = ownerHarness();
    const oldGate = deferred();
    const oldContexts: WorkContext[] = [];
    const trace: string[] = [];
    const oldRegistration = owner.register(
      delegate({
        recover: async context => {
          oldContexts.push(context);
          trace.push("old-start");
          await oldGate.promise;
          if (context.isCurrent()) {
            trace.push("old-mutation");
          }
        },
      }),
    );
    const newRegistration = owner.register(
      delegate({
        sweep: () => {
          trace.push("new-sweep");
        },
      }),
    );
    const oldTab = { id: "old" };

    const oldReceipt = oldRegistration.requestRecovery(oldTab, { revision: 0 }).done;
    await waitFor(() => trace.includes("old-start"), "old recovery");
    const sweepReceipt = newRegistration.requestSweep().done;
    oldRegistration.dispose();

    expect(oldContexts[0]?.isCurrent()).toBe(false);
    expect(trace).toEqual(["old-start"]);
    expect(owner.snapshot()).toMatchObject({
      activeCount: 1,
      drainingCount: 1,
      registrationCount: 1,
    });

    await settle();
    expect(trace).toEqual(["old-start"]);
    oldGate.resolve();

    await expect(oldReceipt).resolves.toBe("canceled");
    await expect(sweepReceipt).resolves.toBe("completed");
    expect(trace).toEqual(["old-start", "new-sweep"]);
    expect(owner.snapshot()).toMatchObject({
      activeCount: 0,
      drainingCount: 0,
      keyRecords: 0,
    });
  });

  it.each(["cancel-recovery", "dispose"] as const)(
    "rolls back an active wake synchronously on %s before its delegate settles",
    async cancellation => {
      const { onDemand, owner, writes } = ownerHarness();
      const gate = deferred();
      const tab = { id: "active" };
      let state: "inserted-pending" | "lazy" = "lazy";
      const registration = owner.register(
        delegate({
          recover: async context => {
            await context.wakeCandidates(
              [
                {
                  key: tab,
                  insert: () => {
                    state = "inserted-pending";
                  },
                  rollback: () => {
                    state = "lazy";
                    return true;
                  },
                  state: () => state,
                },
              ],
              { pollMs: 10, retryLimit: 0, timeoutMs: 20 },
            );
            await gate.promise;
          },
        }),
      );

      const receipt = registration.requestRecovery(tab, { revision: 0 }).done;
      await waitFor(() => !onDemand(), "held wake lease");

      if (cancellation === "cancel-recovery") {
        expect(registration.cancelRecovery(tab)).toBe(true);
      } else {
        expect(registration.dispose()).toBe(true);
      }

      expect(onDemand()).toBe(true);
      expect(writes).toEqual([false, true]);
      expect(owner.snapshot()).toMatchObject({
        activeCount: 1,
        drainingCount: 1,
      });

      gate.resolve();
      await expect(receipt).resolves.toBe("canceled");
      expect(writes).toEqual([false, true]);
      expect(owner.snapshot().activeCount).toBe(0);
    },
  );

  it("lets a live window invalidate another window's queued recovery for the exact tab", async () => {
    const { owner } = ownerHarness();
    const blocker = deferred();
    const registrationA = owner.register(
      delegate({
        recover: async () => blocker.promise,
      }),
    );
    const registrationB = owner.register(delegate());

    const active = registrationA.requestRecovery({ id: "blocker" }, { revision: 0 }).done;
    await waitFor(() => owner.snapshot().activeKind === "recovery", "active blocker");
    const tab = { id: "queued-b" };
    const queued = registrationB.requestRecovery(tab, { revision: 0 }).done;

    const canceled = registrationA.cancelRecovery(tab);
    blocker.resolve();

    expect(canceled).toBe(true);
    await expect(active).resolves.toBe("completed");
    await expect(queued).resolves.toBe("canceled");
  });

  it.each([
    ["a", "b"],
    ["b", "a"],
  ] as const)(
    "invalidates both active %s and trailing %s recovery ownership for the exact tab",
    async (activeOwner, trailingOwner) => {
      const { owner } = ownerHarness();
      const gate = deferred();
      const trace: string[] = [];
      const registrationA = owner.register(
        delegate({
          recover: async () => {
            trace.push("a");
            await gate.promise;
          },
        }),
      );
      const registrationB = owner.register(
        delegate({
          recover: async () => {
            trace.push("b");
            await gate.promise;
          },
        }),
      );
      const registrations = { a: registrationA, b: registrationB };
      const tab = { id: "active-and-trailing" };

      const active = registrations[activeOwner].requestRecovery(tab, {
        revision: 0,
      }).done;
      await waitFor(() => trace.length === 1, "active recovery");
      const trailing = registrations[trailingOwner].requestRecovery(tab, {
        revision: 1,
      }).done;

      const canceled = registrationA.cancelRecovery(tab);
      gate.resolve();

      expect(canceled).toBe(true);
      await expect(active).resolves.toBe("canceled");
      await expect(trailing).resolves.toBe("canceled");
      expect(trace).toEqual([activeOwner]);
    },
  );

  it("does not let a disposed registration invalidate a live window's recovery", async () => {
    const { owner } = ownerHarness();
    const gate = deferred();
    const registrationA = owner.register(delegate());
    const registrationB = owner.register(
      delegate({
        recover: async () => gate.promise,
      }),
    );
    const tab = { id: "live-b" };

    expect(registrationA.dispose()).toBe(true);
    const recovery = registrationB.requestRecovery(tab, { revision: 0 }).done;
    await waitFor(() => owner.snapshot().activeKind === "recovery", "live B recovery");

    expect(registrationA.cancelRecovery(tab)).toBe(false);
    gate.resolve();
    await expect(recovery).resolves.toBe("completed");
  });

  it("cancels only the disposing window's queued recoveries and keeps the global sweep", async () => {
    const { owner } = ownerHarness();
    const gate = deferred();
    const trace: string[] = [];
    const registrationA = owner.register(
      delegate({
        recover: async () => gate.promise,
        sweep: () => {
          trace.push("a-sweep");
        },
      }),
    );
    const registrationB = owner.register(
      delegate({
        recover: () => {
          trace.push("b-recovery");
        },
        sweep: () => {
          trace.push("b-sweep");
        },
      }),
    );

    const active = registrationA.requestRecovery({ id: "a" }, { revision: 0 }).done;
    await waitFor(() => owner.snapshot().activeKind === "recovery", "active A");
    const queuedB = registrationB.requestRecovery({ id: "b" }, { revision: 0 }).done;
    const sweep = registrationB.requestSweep().done;
    registrationB.dispose();

    await expect(queuedB).resolves.toBe("canceled");
    gate.resolve();
    await Promise.all([active, sweep]);

    expect(trace).toEqual(["a-sweep"]);
  });

  it("preserves a different live window's trailing recovery when the active owner disposes", async () => {
    const { owner } = ownerHarness();
    const gate = deferred();
    const trace: string[] = [];
    const tab = { id: "shared" };
    const registrationA = owner.register(
      delegate({
        recover: async () => {
          trace.push("a-start");
          await gate.promise;
        },
      }),
    );
    const registrationB = owner.register(
      delegate({
        recover: (_context, _tab, evidence) => {
          trace.push(`b:${evidence.revision}`);
        },
      }),
    );

    const active = registrationA.requestRecovery(tab, { revision: 0 }).done;
    await waitFor(() => trace.includes("a-start"), "active recovery A");
    const trailing = registrationB.requestRecovery(tab, { revision: 1 }).done;

    expect(registrationA.dispose()).toBe(true);
    expect(trace).toEqual(["a-start"]);
    expect(owner.snapshot()).toMatchObject({
      activeCount: 1,
      drainingCount: 1,
      keyRecords: 1,
      readyCount: 1,
      trailingCount: 0,
    });

    gate.resolve();
    await expect(active).resolves.toBe("canceled");
    await expect(trailing).resolves.toBe("completed");
    expect(trace).toEqual(["a-start", "b:1"]);
  });

  it("coalesces a foreign trailing update dispatched synchronously by cancellation", async () => {
    const { owner } = ownerHarness();
    const gate = deferred();
    const trace: string[] = [];
    const tab = { id: "shared-abort" };
    let newest: Promise<unknown> | null = null;
    let registrationB!: ApplicationRegistration<Tab, Evidence>;
    const registrationA = owner.register(
      delegate({
        recover: async context => {
          context.signal.addEventListener(
            "abort",
            () => {
              newest = registrationB.requestRecovery(tab, { revision: 2 }).done;
            },
            { once: true },
          );
          trace.push("a-start");
          await gate.promise;
        },
      }),
    );
    registrationB = owner.register(
      delegate({
        recover: (_context, _tab, evidence) => {
          trace.push(`b:${evidence.revision}`);
        },
      }),
    );

    const active = registrationA.requestRecovery(tab, { revision: 0 }).done;
    await waitFor(() => trace.includes("a-start"), "active recovery A");
    const trailing = registrationB.requestRecovery(tab, { revision: 1 }).done;

    expect(registrationA.dispose()).toBe(true);
    const duplicateCoalesced = newest === trailing;
    gate.resolve();

    await expect(active).resolves.toBe("canceled");
    await expect(trailing).resolves.toBe("completed");
    await expect(newest).resolves.toBe("completed");
    expect(duplicateCoalesced).toBe(true);
    expect(trace).toEqual(["a-start", "b:2"]);
  });

  it("isolates a failed window invocation and continues draining", async () => {
    const { errors, owner } = ownerHarness();
    const delegateError = new Error("window failed");
    const trace: string[] = [];
    const reportError = vi.fn();
    const registrationA = owner.register(
      delegate({
        reportError,
        sweep: () => {
          trace.push("a");
          throw delegateError;
        },
      }),
    );
    owner.register(
      delegate({
        sweep: () => {
          trace.push("b");
        },
      }),
    );

    await expect(registrationA.requestSweep().done).resolves.toBe("failed");

    expect(trace).toEqual(["a", "b"]);
    expect(reportError).toHaveBeenCalledWith(delegateError);
    expect(errors).toEqual([]);
    expect(owner.snapshot().activeCount).toBe(0);
  });

  it("owns persistent reconciliation without redundant transaction writes", async () => {
    const { onDemand, owner, writes } = ownerHarness();
    const trace: string[] = [];
    const tab = { id: "reconciled" };
    let state: "lazy" | "started" = "lazy";
    const registration = owner.register(
      delegate({
        sweep: async context => {
          expect(context.readOnDemand()).toBe(true);
          context.reconcileOnDemand(false);
          expect(context.readOnDemand()).toBe(false);
          await context.wakeCandidates(
            [
              {
                key: tab,
                insert: () => {
                  state = "started";
                  trace.push(`held:${context.readOnDemand()}`);
                },
                rollback: () => true,
                state: () => state,
              },
            ],
            { pollMs: 10, retryLimit: 0, timeoutMs: 20 },
          );
        },
      }),
    );

    await expect(registration.requestSweep().done).resolves.toBe("completed");

    expect(trace).toEqual(["held:false"]);
    expect(writes).toEqual([false]);
    expect(onDemand()).toBe(false);
  });

  it("creates the shared status widget once and destroys it after the last window", () => {
    const { owner } = ownerHarness();
    const createA = vi.fn();
    const destroyA = vi.fn();
    const createB = vi.fn();
    const destroyB = vi.fn();
    const registrationA = owner.register(delegate());
    const registrationB = owner.register(delegate());

    const leaseA = registrationA.acquireStatusWidget({
      create: createA,
      destroy: destroyA,
      show: () => false,
    });
    const leaseB = registrationB.acquireStatusWidget({
      create: createB,
      destroy: destroyB,
      show: () => false,
    });

    expect(createA).toHaveBeenCalledOnce();
    expect(createB).not.toHaveBeenCalled();
    expect(leaseA.release()).toBe(true);
    expect(destroyA).not.toHaveBeenCalled();
    expect(destroyB).not.toHaveBeenCalled();
    expect(leaseB.release()).toBe(true);
    expect(destroyA).not.toHaveBeenCalled();
    expect(destroyB).toHaveBeenCalledOnce();
    expect(leaseB.release()).toBe(false);

    registrationA.dispose();
    registrationB.dispose();
  });

  it("uses the surviving window's destroy adapter when the creator closes first", () => {
    const { owner } = ownerHarness();
    const createA = vi.fn();
    const destroyA = vi.fn();
    const createB = vi.fn();
    const destroyB = vi.fn();
    const registrationA = owner.register(delegate());
    const registrationB = owner.register(delegate());
    const leaseA = registrationA.acquireStatusWidget({
      create: createA,
      destroy: destroyA,
      show: () => false,
    });
    const leaseB = registrationB.acquireStatusWidget({
      create: createB,
      destroy: destroyB,
      show: () => false,
    });

    expect(leaseA.release()).toBe(true);
    expect(destroyA).not.toHaveBeenCalled();
    expect(leaseB.release()).toBe(true);
    expect(destroyA).not.toHaveBeenCalled();
    expect(destroyB).toHaveBeenCalledOnce();

    registrationA.dispose();
    registrationB.dispose();
  });

  it("releases a widget lease when a registration is disposed directly", () => {
    const { owner } = ownerHarness();
    const destroy = vi.fn();
    const registration = owner.register(delegate());
    registration.acquireStatusWidget({ create: vi.fn(), destroy, show: () => false });

    expect(registration.dispose("window-closed")).toBe(true);
    expect(destroy).toHaveBeenCalledOnce();
    expect(owner.snapshot().registrationCount).toBe(0);
  });

  it("rolls back a failed first-widget creation without retaining the lease", () => {
    const { errors, owner } = ownerHarness();
    const create = vi.fn(() => {
      throw new Error("widget create failed");
    });
    const destroy = vi.fn();
    const registration = owner.register(delegate());

    expect(() =>
      registration.acquireStatusWidget({ create, destroy, show: () => false }),
    ).toThrow("widget create failed");
    expect(destroy).toHaveBeenCalledOnce();
    expect(errors).toEqual([]);
    expect(registration.dispose()).toBe(true);
    expect(owner.snapshot().registrationCount).toBe(0);
  });

  it("routes the persistent widget callback only to its current exact view host", () => {
    const { owner } = ownerHarness();
    const oldView = {} as Element;
    const currentView = {} as Element;
    const shownOld = vi.fn();
    const shownCurrent = vi.fn();
    const dispatchers: { old: StatusWidgetViewShowing | null } = { old: null };
    const registrationOld = owner.register(delegate());
    const registrationCurrent = owner.register(delegate());

    const oldLease = registrationOld.acquireStatusWidget({
      create: dispatcher => {
        dispatchers.old = dispatcher;
      },
      destroy: vi.fn(),
      show: event => {
        if (event.target !== oldView) {
          return false;
        }
        shownOld();
        return true;
      },
    });

    const dispatch = dispatchers.old;
    if (!dispatch) {
      throw new Error("first widget host did not receive the stable dispatcher");
    }
    const eventFor = (target: Element) => ({ target });

    dispatch(eventFor(oldView));
    expect(shownOld).toHaveBeenCalledOnce();

    const destroyCurrent = vi.fn();
    const currentLease = registrationCurrent.acquireStatusWidget({
      create: vi.fn(),
      destroy: destroyCurrent,
      show: event => {
        if (event.target !== currentView) {
          return false;
        }
        shownCurrent();
        return true;
      },
    });

    // The physical widget retains the first window's stable owner callback while
    // the creator closes. The callback must now route to B's exact view, not the
    // dead A host or a fresh cache-busted closure.
    expect(registrationOld.dispose()).toBe(true);
    expect(oldLease.release()).toBe(false);
    expect(destroyCurrent).not.toHaveBeenCalled();
    dispatch(eventFor(oldView));
    expect(shownOld).toHaveBeenCalledOnce();
    expect(shownCurrent).not.toHaveBeenCalled();

    dispatch(eventFor(currentView));
    expect(shownCurrent).toHaveBeenCalledOnce();

    currentLease.release();
    expect(destroyCurrent).toHaveBeenCalledOnce();
    registrationCurrent.dispose();
  });

  it("marks a registration terminal before final widget destruction can reenter", async () => {
    const { owner } = ownerHarness();
    const sweep = vi.fn();
    const registration = owner.register(delegate({ sweep }));
    const reentry: { receipt: WorkReceipt | null } = { receipt: null };

    registration.acquireStatusWidget({
      create: () => {},
      destroy: () => {
        reentry.receipt = registration.requestSweep();
      },
      show: () => false,
    });

    expect(registration.dispose()).toBe(true);
    const receipt = reentry.receipt;
    if (!receipt) {
      throw new Error("final widget destruction did not attempt reentrant work");
    }
    await expect(receipt.done).resolves.toBe("canceled");
    expect(sweep).not.toHaveBeenCalled();
  });

  it("waits for a reentrant final destroy before creating its successor widget", () => {
    const { owner } = ownerHarness();
    const trace: string[] = [];
    const registrationA = owner.register(delegate());
    const registrationB = owner.register(delegate());
    const successor: {
      lease: ReturnType<typeof registrationB.acquireStatusWidget> | null;
    } = { lease: null };
    const leaseA = registrationA.acquireStatusWidget({
      create: () => {
        trace.push("create-a");
      },
      destroy: () => {
        trace.push("destroy-a:start");
        successor.lease = registrationB.acquireStatusWidget({
          create: () => {
            trace.push("create-b");
          },
          destroy: vi.fn(),
          show: () => false,
        });
        trace.push("destroy-a:end");
      },
      show: () => false,
    });

    expect(leaseA.release()).toBe(true);
    expect(trace).toEqual(["create-a", "destroy-a:start", "destroy-a:end", "create-b"]);
    expect(owner.snapshot()).toMatchObject({
      statusWidgetLeaseIds: [registrationB.id],
      statusWidgetLeases: 1,
      statusWidgetPhase: "present",
    });

    successor.lease?.release();
    registrationA.dispose();
    registrationB.dispose();
  });

  it("terminates a successor whose deferred widget creation fails", async () => {
    const { owner } = ownerHarness();
    const registrationA = owner.register(delegate());
    const registrationB = owner.register(delegate());
    const successor: {
      lease: ReturnType<typeof registrationB.acquireStatusWidget> | null;
    } = { lease: null };
    const destroyB = vi.fn();
    const failB = vi.fn(() => registrationB.dispose());
    const leaseA = registrationA.acquireStatusWidget({
      create: () => {},
      destroy: () => {
        successor.lease = registrationB.acquireStatusWidget({
          create: () => {
            throw new Error("successor create failed");
          },
          destroy: destroyB,
          fail: failB,
          show: () => false,
        });
      },
      show: () => false,
    });

    expect(leaseA.release()).toBe(true);
    expect(destroyB).toHaveBeenCalledOnce();
    expect(failB).toHaveBeenCalledOnce();
    expect(owner.snapshot()).toMatchObject({
      registrationCount: 1,
      statusWidgetLeaseIds: [],
      statusWidgetLeases: 0,
      statusWidgetPhase: "absent",
    });
    expect(successor.lease?.release()).toBe(false);
    await expect(registrationB.requestSweep().done).resolves.toBe("canceled");

    registrationA.dispose();
  });

  it.each([20, 100, 500])(
    "bounds a %i-tab burst to one sweep key plus one recovery key per tab",
    async count => {
      const { owner } = ownerHarness();
      const firstGate = deferred();
      const trace: string[] = [];
      let active = 0;
      let maxActive = 0;
      const registration = owner.register(
        delegate({
          recover: async (_context, tab, evidence) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            trace.push(`${tab.id}:${evidence.revision}`);
            try {
              if (tab.id === "tab-0" && evidence.revision === 0) {
                await firstGate.promise;
              }
            } finally {
              active -= 1;
            }
          },
          sweep: async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            trace.push("sweep");
            active -= 1;
          },
        }),
      );
      const tabs = Array.from({ length: count }, (_, index) => ({ id: `tab-${index}` }));
      const receipts: Array<Promise<unknown>> = [];

      receipts.push(registration.requestRecovery(tabs[0] as Tab, { revision: 0 }).done);
      await waitFor(() => trace.length === 1, "held first recovery");
      receipts.push(registration.requestRecovery(tabs[1] as Tab, { revision: 0 }).done);
      receipts.push(registration.requestSweep().done);
      for (const tab of tabs.slice(2)) {
        receipts.push(registration.requestRecovery(tab, { revision: 0 }).done);
      }
      for (let request = 0; request < 2 * count - 1; request += 1) {
        receipts.push(registration.requestSweep().done);
      }
      for (const tab of tabs) {
        receipts.push(registration.requestRecovery(tab, { revision: 1 }).done);
        receipts.push(registration.requestRecovery(tab, { revision: 2 }).done);
      }

      expect(receipts).toHaveLength(5 * count);
      expect(owner.snapshot()).toMatchObject({
        activeCount: 1,
        keyRecords: count + 1,
        readyCount: count,
        sweepRecords: 1,
        trailingCount: 1,
      });

      firstGate.resolve();
      await Promise.all(receipts);

      expect(trace).toHaveLength(count + 2);
      expect(trace.slice(0, 3)).toEqual(["tab-0:0", "tab-1:2", "sweep"]);
      expect(trace.at(-1)).toBe("tab-0:2");
      expect(maxActive).toBe(1);
      expect(owner.snapshot()).toMatchObject({
        activeCount: 0,
        drainingCount: 0,
        keyRecords: 0,
        readyCount: 0,
        trailingCount: 0,
      });
    },
  );
});
