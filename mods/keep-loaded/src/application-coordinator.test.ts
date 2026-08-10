import { describe, expect, it, vi } from "vitest";

import {
  type ApplicationRegistration,
  KeepLoadedApplicationOwner,
  type WindowWorkDelegate,
  type WorkContext,
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
    registrationB.dispose();
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
    "restores an active wake lease synchronously on %s before its work settles",
    async cancellation => {
      const { onDemand, owner, writes } = ownerHarness();
      const gate = deferred();
      const tab = { id: "active" };
      const registration = owner.register(
        delegate({
          recover: async context => {
            await context.withOnDemandDisabled(() => gate.promise);
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

  it("keeps a canceled invocation's stale finalizer from restoring over its successor", async () => {
    const { onDemand, owner, writes } = ownerHarness();
    const oldInvocationGate = deferred();
    const oldLeaseGate = deferred();
    const newLeaseGate = deferred();
    let oldLease: Promise<void> | null = null;
    const trace: string[] = [];
    const oldRegistration = owner.register(
      delegate({
        recover: async context => {
          oldLease = context.withOnDemandDisabled(async () => {
            trace.push("old-held");
            await oldLeaseGate.promise;
          });
          await oldInvocationGate.promise;
        },
      }),
    );
    const newRegistration = owner.register(
      delegate({
        recover: async context => {
          await context.withOnDemandDisabled(async () => {
            trace.push("new-held");
            await newLeaseGate.promise;
          });
        },
      }),
    );

    const oldReceipt = oldRegistration.requestRecovery(
      { id: "old" },
      { revision: 0 },
    ).done;
    await waitFor(() => trace.includes("old-held"), "old wake lease");
    const newReceipt = newRegistration.requestRecovery(
      { id: "new" },
      { revision: 0 },
    ).done;

    expect(oldRegistration.dispose()).toBe(true);
    expect(onDemand()).toBe(true);
    oldInvocationGate.resolve();
    await waitFor(() => trace.includes("new-held"), "successor wake lease");
    expect(onDemand()).toBe(false);

    oldLeaseGate.resolve();
    await oldLease;
    expect(onDemand()).toBe(false);
    expect(writes).toEqual([false, true, false]);

    newLeaseGate.resolve();
    await expect(oldReceipt).resolves.toBe("canceled");
    await expect(newReceipt).resolves.toBe("completed");
    expect(onDemand()).toBe(true);
    expect(writes).toEqual([false, true, false, true]);
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

  it("owns both persistent reconciliation and temporary restore-pref writes", async () => {
    const { onDemand, owner, writes } = ownerHarness();
    const trace: string[] = [];
    const registration = owner.register(
      delegate({
        sweep: async context => {
          expect(context.readOnDemand()).toBe(true);
          context.reconcileOnDemand(false);
          expect(context.readOnDemand()).toBe(false);
          await context.withOnDemandDisabled(async () => {
            trace.push(`held:${context.readOnDemand()}`);
          });
        },
      }),
    );

    await expect(registration.requestSweep().done).resolves.toBe("completed");

    expect(trace).toEqual(["held:false"]);
    expect(writes).toEqual([false, false, false]);
    expect(onDemand()).toBe(false);
  });

  it("fails closed over a restore error instead of starting queued work", async () => {
    let onDemand = true;
    const errors: unknown[] = [];
    const trace: string[] = [];
    const owner = new KeepLoadedApplicationOwner<Tab, Evidence>({
      applicationId: "restore-failure",
      preferences: {
        readOnDemand: () => onDemand,
        writeOnDemand: value => {
          if (value) {
            throw new Error("restore refused");
          }
          onDemand = value;
        },
      },
      reportError: error => errors.push(error),
    });
    const registration = owner.register(
      delegate({
        recover: async context => {
          trace.push("recovery");
          await context.withOnDemandDisabled(() => {});
        },
        reportError: error => errors.push(error),
        sweep: () => {
          trace.push("sweep");
        },
      }),
    );

    let recoverySettled = false;
    let sweepSettled = false;
    void registration
      .requestRecovery({ id: "restore-failure" }, { revision: 0 })
      .done.then(() => {
        recoverySettled = true;
      });
    void registration.requestSweep().done.then(() => {
      sweepSettled = true;
    });
    await settle(12);

    expect(onDemand).toBe(false);
    expect(trace).toEqual(["recovery"]);
    expect(errors).toHaveLength(2);
    expect(recoverySettled).toBe(false);
    expect(sweepSettled).toBe(false);
    expect(owner.snapshot()).toMatchObject({
      activeCount: 1,
      activeKind: "recovery",
      keyRecords: 2,
      readyCount: 1,
    });
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
