import { describe, expect, it } from "vitest";

import { KeepLoadedApplicationOwner } from "./application-coordinator.ts";
import type { ApplicationTimerPort } from "./application-owner-contracts.ts";
import type {
  ApplicationRegistration,
  WakeCandidate,
  WakeCandidateState,
  WindowWorkDelegate,
} from "./application-protocol.ts";

interface Evidence {
  revision: number;
}

interface Tab {
  id: string;
}

const settle = async (turns = 8) => {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve();
  }
};

class ManualApplicationTimers implements ApplicationTimerPort {
  #failNextSet: Error | null = null;
  #nextId = 1;
  #now = 0;
  readonly tasks = new Map<
    number,
    { callback: () => void; canceled: boolean; dueAt: number }
  >();

  readonly clearTimeout = (handle: unknown) => {
    const task = this.tasks.get(handle as number);
    if (task) {
      task.canceled = true;
    }
  };

  readonly now = () => this.#now;

  readonly setTimeout = (callback: () => void, delayMs: number): unknown => {
    if (this.#failNextSet) {
      const error = this.#failNextSet;
      this.#failNextSet = null;
      throw error;
    }
    const id = this.#nextId++;
    this.tasks.set(id, {
      callback,
      canceled: false,
      dueAt: this.#now + delayMs,
    });
    return id;
  };

  failNextSet(error = new Error("timer unavailable")): void {
    this.#failNextSet = error;
  }

  advance(delayMs: number): void {
    this.#now += delayMs;
    const due = [...this.tasks]
      .filter(([, task]) => !task.canceled && task.dueAt <= this.#now)
      .sort(([leftId, left], [rightId, right]) =>
        left.dueAt === right.dueAt ? leftId - rightId : left.dueAt - right.dueAt,
      );
    for (const [id, task] of due) {
      if (!task.canceled && this.tasks.delete(id)) {
        task.callback();
      }
    }
  }

  forceAll(): void {
    for (const [id, task] of [...this.tasks]) {
      this.tasks.delete(id);
      task.callback();
    }
  }
}

interface CandidateHarness {
  candidate: WakeCandidate;
  insertCalls: number;
  rollbackCalls: number;
  state: WakeCandidateState;
}

const candidateHarness = (tab: Tab): CandidateHarness => {
  const harness: CandidateHarness = {
    candidate: undefined as unknown as WakeCandidate,
    insertCalls: 0,
    rollbackCalls: 0,
    state: "lazy",
  };
  harness.candidate = Object.freeze({
    key: tab,
    insert: () => {
      harness.insertCalls += 1;
      harness.state = "inserted-pending";
    },
    rollback: () => {
      harness.rollbackCalls += 1;
      harness.state = "lazy";
      return true;
    },
    state: () => harness.state,
  });
  return harness;
};

const ownerHarness = (original = true) => {
  let onDemand = original;
  const errors: unknown[] = [];
  const timers = new ManualApplicationTimers();
  const writes: boolean[] = [];
  const owner = new KeepLoadedApplicationOwner<Tab, Evidence>({
    applicationId: "wake-transaction-test",
    preferences: {
      readOnDemand: () => onDemand,
      writeOnDemand: value => {
        onDemand = value;
        writes.push(value);
      },
    },
    reportError: error => errors.push(error),
    timers,
  });
  return { errors, onDemand: () => onDemand, owner, timers, writes };
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

const transaction = (
  candidates: readonly WakeCandidate[],
  trace?: string[],
): Partial<WindowWorkDelegate<Tab, Evidence>> => ({
  sweep: async context => {
    const result = await context.wakeCandidates(candidates, {
      pollMs: 10,
      retryLimit: 1,
      timeoutMs: 20,
    });
    trace?.push(result);
    if (result === "failed") {
      throw new Error("wake transaction failed");
    }
  },
});

describe("application wake transactions", () => {
  it.each([
    ["a", "b"],
    ["b", "a"],
  ] as const)(
    "holds the preference until both candidates start (%s then %s)",
    async (first, second) => {
      const { onDemand, owner, timers, writes } = ownerHarness();
      const candidates = {
        a: candidateHarness({ id: "a" }),
        b: candidateHarness({ id: "b" }),
      };
      const registration = owner.register(
        delegate(transaction([candidates.a.candidate, candidates.b.candidate])),
      );

      const receipt = registration.requestSweep().done;
      expect(onDemand()).toBe(false);
      expect(owner.snapshot()).toMatchObject({
        wakeCandidates: 2,
        wakePhase: "waiting",
      });

      candidates[first].state = "started";
      timers.advance(10);
      await settle();
      expect(onDemand()).toBe(false);
      expect(owner.snapshot().wakeCandidates).toBe(1);

      candidates[second].state = "started";
      timers.advance(10);
      await expect(receipt).resolves.toBe("completed");
      expect(onDemand()).toBe(true);
      expect(writes).toEqual([false, true]);
      expect(owner.snapshot()).toMatchObject({
        activeCount: 0,
        wakeCandidates: 0,
        wakePhase: "idle",
      });
    },
  );

  it.each([
    { desired: true, expected: [false, true], original: true },
    { desired: false, expected: [false], original: true },
    { desired: true, expected: [true], original: false },
    { desired: false, expected: [], original: false },
  ])(
    "preserves exact pref writes from original=$original to desired=$desired",
    async ({ desired, expected, original }) => {
      const { onDemand, owner, timers, writes } = ownerHarness(original);
      const pending = candidateHarness({ id: "pref-matrix" });
      const registration = owner.register(delegate(transaction([pending.candidate])));

      const receipt = registration.requestSweep().done;
      registration.reconcileOnDemand(desired);
      expect(onDemand()).toBe(false);

      pending.state = "started";
      timers.advance(10);
      await expect(receipt).resolves.toBe("completed");
      expect(onDemand()).toBe(desired);
      expect(writes).toEqual(expected);
    },
  );

  it("rolls a timed-out candidate back before one bounded retry", async () => {
    const { onDemand, owner, timers, writes } = ownerHarness();
    const pending = candidateHarness({ id: "timeout" });
    const trace: string[] = [];
    const registration = owner.register(
      delegate(transaction([pending.candidate], trace)),
    );

    const receipt = registration.requestSweep().done;
    timers.advance(10);
    timers.advance(10);
    await settle();

    expect(pending.rollbackCalls).toBe(1);
    expect(pending.state).toBe("lazy");
    expect(onDemand()).toBe(false);
    expect(owner.snapshot()).toMatchObject({
      wakeAttempt: 1,
      wakePhase: "retrying",
    });

    timers.advance(10);
    expect(pending.insertCalls).toBe(2);
    expect(pending.state).toBe("inserted-pending");
    pending.state = "started";
    timers.advance(10);

    await expect(receipt).resolves.toBe("failed");
    expect(trace).toEqual(["failed"]);
    expect(writes).toEqual([false, true]);
    expect(owner.snapshot().activeCount).toBe(0);
  });

  it("keeps the owner and pref held while rollback refuses, then retries cleanup", async () => {
    const { onDemand, owner, timers } = ownerHarness();
    const pending = candidateHarness({ id: "rollback-refused" });
    let refuseRollback = true;
    pending.candidate = Object.freeze({
      ...pending.candidate,
      rollback: () => {
        pending.rollbackCalls += 1;
        if (refuseRollback) {
          return false;
        }
        pending.state = "lazy";
        return true;
      },
    });
    const registration = owner.register(delegate(transaction([pending.candidate])));

    let receiptSettled = false;
    void registration.requestSweep().done.then(() => {
      receiptSettled = true;
    });
    timers.advance(20);
    await settle();

    expect(receiptSettled).toBe(false);
    expect(onDemand()).toBe(false);
    expect(owner.snapshot()).toMatchObject({
      activeCount: 1,
      wakeCandidates: 1,
      wakePhase: "blocked",
    });

    refuseRollback = false;
    timers.advance(10);
    await settle();
    expect(pending.rollbackCalls).toBe(2);
    expect(owner.snapshot().wakePhase).toBe("retrying");
  });

  it("keeps ownership when candidate state inspection throws while waiting", async () => {
    const { errors, onDemand, owner, timers } = ownerHarness();
    const pending = candidateHarness({ id: "state-throw" });
    let throwState = false;
    pending.candidate = Object.freeze({
      ...pending.candidate,
      state: () => {
        if (throwState) {
          throw new Error("state unavailable");
        }
        return pending.state;
      },
    });
    const registration = owner.register(
      delegate({
        ...transaction([pending.candidate]),
        reportError: error => errors.push(error),
      }),
    );

    const receipt = registration.requestSweep().done;
    throwState = true;
    timers.advance(10);
    await settle();

    expect(onDemand()).toBe(false);
    expect(owner.snapshot()).toMatchObject({
      activeCount: 1,
      wakeCandidates: 1,
      wakePhase: "blocked",
    });

    throwState = false;
    timers.advance(10);
    expect(pending.rollbackCalls).toBe(1);
    expect(owner.snapshot().wakePhase).toBe("retrying");
    timers.advance(10);
    pending.state = "started";
    timers.advance(10);

    await expect(receipt).resolves.toBe("failed");
    expect(onDemand()).toBe(true);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps ownership when rollback throws and retries the same cleanup", async () => {
    const { errors, onDemand, owner, timers } = ownerHarness();
    const pending = candidateHarness({ id: "rollback-throw" });
    let firstRollback = true;
    pending.candidate = Object.freeze({
      ...pending.candidate,
      rollback: () => {
        pending.rollbackCalls += 1;
        if (firstRollback) {
          firstRollback = false;
          throw new Error("rollback unavailable");
        }
        pending.state = "lazy";
        return true;
      },
    });
    const registration = owner.register(
      delegate({
        ...transaction([pending.candidate]),
        reportError: error => errors.push(error),
      }),
    );

    const receipt = registration.requestSweep().done;
    timers.advance(20);
    await settle();

    expect(pending.rollbackCalls).toBe(1);
    expect(onDemand()).toBe(false);
    expect(owner.snapshot()).toMatchObject({
      activeCount: 1,
      wakeCandidates: 1,
      wakePhase: "blocked",
    });

    timers.advance(10);
    expect(pending.rollbackCalls).toBe(2);
    expect(owner.snapshot().wakePhase).toBe("retrying");
    timers.advance(10);
    pending.state = "started";
    timers.advance(10);

    await expect(receipt).resolves.toBe("failed");
    expect(onDemand()).toBe(true);
    expect(errors.map(error => String(error))).toEqual([
      "Error: rollback unavailable",
      "Error: wake transaction failed",
    ]);
  });

  it("keeps only the latest desired target while a candidate is held", async () => {
    const { onDemand, owner, timers, writes } = ownerHarness();
    const pending = candidateHarness({ id: "settings" });
    const registration = owner.register(delegate(transaction([pending.candidate])));

    const receipt = registration.requestSweep().done;
    registration.reconcileOnDemand(false);
    registration.reconcileOnDemand(true);
    registration.reconcileOnDemand(false);
    expect(onDemand()).toBe(false);
    expect(writes).toEqual([false]);

    pending.state = "started";
    timers.advance(10);
    await expect(receipt).resolves.toBe("completed");
    expect(onDemand()).toBe(false);
    expect(writes).toEqual([false]);
  });

  it("rolls back synchronously on generation disposal and ignores stale timers", async () => {
    const { onDemand, owner, timers, writes } = ownerHarness();
    const pending = candidateHarness({ id: "old" });
    const oldRegistration = owner.register(delegate(transaction([pending.candidate])));
    const replacementTrace: string[] = [];
    const replacement = owner.register(
      delegate({
        sweep: () => {
          replacementTrace.push("replacement");
        },
      }),
    );

    const oldReceipt = oldRegistration.requestSweep().done;
    const replacementReceipt = replacement.requestSweep().done;
    expect(oldRegistration.dispose("generation-ended")).toBe(true);
    expect(pending.rollbackCalls).toBe(1);
    expect(onDemand()).toBe(true);
    expect(writes).toEqual([false, true]);

    timers.forceAll();
    await expect(oldReceipt).resolves.toBe("completed");
    await expect(replacementReceipt).resolves.toBe("completed");
    expect(replacementTrace).toEqual(["replacement", "replacement"]);
    expect(writes).toEqual([false, true]);
  });

  it("never claims or rolls back a candidate that was already inserted", async () => {
    const { onDemand, owner } = ownerHarness();
    const foreign = candidateHarness({ id: "foreign" });
    foreign.state = "inserted-pending";
    const registration = owner.register(delegate(transaction([foreign.candidate])));

    await expect(registration.requestSweep().done).resolves.toBe("failed");
    expect(foreign.insertCalls).toBe(0);
    expect(foreign.rollbackCalls).toBe(0);
    expect(onDemand()).toBe(true);
  });

  it.each(["before", "after"] as const)(
    "rolls back an insert that throws %s mutation and retries once",
    async timing => {
      const { owner, timers } = ownerHarness();
      const pending = candidateHarness({ id: `insert-${timing}` });
      const baseInsert = pending.candidate.insert;
      let first = true;
      pending.candidate = Object.freeze({
        ...pending.candidate,
        insert: () => {
          pending.insertCalls += 1;
          if (first) {
            first = false;
            if (timing === "after") {
              pending.state = "inserted-pending";
            }
            throw new Error(`insert ${timing}`);
          }
          // Avoid the wrapper's own counter on the successful retry.
          pending.insertCalls -= 1;
          baseInsert();
        },
      });
      const registration = owner.register(delegate(transaction([pending.candidate])));

      const receipt = registration.requestSweep().done;
      expect(pending.rollbackCalls).toBe(timing === "after" ? 1 : 0);
      expect(owner.snapshot().wakePhase).toBe("retrying");

      timers.advance(10);
      expect(pending.insertCalls).toBe(2);
      pending.state = "started";
      timers.advance(10);
      await expect(receipt).resolves.toBe("failed");
      expect(owner.snapshot().activeCount).toBe(0);
    },
  );

  it("bounds a second timeout without creating another retry", async () => {
    const { owner, timers } = ownerHarness();
    const pending = candidateHarness({ id: "bounded-timeout" });
    const registration = owner.register(delegate(transaction([pending.candidate])));

    const receipt = registration.requestSweep().done;
    timers.advance(20);
    timers.advance(10);
    expect(pending.insertCalls).toBe(2);
    timers.advance(20);

    await expect(receipt).resolves.toBe("failed");
    expect(pending.rollbackCalls).toBe(2);
    expect(owner.snapshot()).toMatchObject({
      activeCount: 0,
      wakeAttempt: null,
      wakePhase: "idle",
    });
    const insertCalls = pending.insertCalls;
    timers.forceAll();
    expect(pending.insertCalls).toBe(insertCalls);
  });

  it("does not release the owner until a failed final pref write is retried", async () => {
    let onDemand = true;
    let refuseRestore = true;
    const errors: unknown[] = [];
    const timers = new ManualApplicationTimers();
    const writes: boolean[] = [];
    const owner = new KeepLoadedApplicationOwner<Tab, Evidence>({
      applicationId: "restore-retry",
      preferences: {
        readOnDemand: () => onDemand,
        writeOnDemand: value => {
          writes.push(value);
          if (value && refuseRestore) {
            throw new Error("restore refused");
          }
          onDemand = value;
        },
      },
      reportError: error => errors.push(error),
      timers,
    });
    const pending = candidateHarness({ id: "restore-retry" });
    const trace: string[] = [];
    const registration = owner.register(
      delegate({
        ...transaction([pending.candidate]),
        recover: () => {},
      }),
    );
    const queuedRegistration = owner.register(
      delegate({
        recover: () => {
          trace.push("queued");
        },
      }),
    );

    let settled = false;
    void registration.requestSweep().done.then(() => {
      settled = true;
    });
    const queued = queuedRegistration.requestRecovery(
      { id: "queued" },
      { revision: 0 },
    ).done;
    pending.state = "started";
    timers.advance(10);
    await settle();

    expect(settled).toBe(false);
    expect(trace).toEqual([]);
    expect(onDemand).toBe(false);
    expect(owner.snapshot()).toMatchObject({
      activeCount: 1,
      readyCount: 1,
      wakePhase: "blocked",
    });

    refuseRestore = false;
    timers.advance(10);
    await expect(queued).resolves.toBe("completed");
    expect(trace).toEqual(["queued"]);
    expect(onDemand).toBe(true);
    expect(errors).toHaveLength(1);
    expect(writes).toEqual([false, true, true]);
  });

  it("treats a mutate-then-throw final write as applied but reports failure", async () => {
    let onDemand = true;
    const timers = new ManualApplicationTimers();
    const owner = new KeepLoadedApplicationOwner<Tab, Evidence>({
      applicationId: "mutate-then-throw",
      preferences: {
        readOnDemand: () => onDemand,
        writeOnDemand: value => {
          onDemand = value;
          if (value) {
            throw new Error("reported after mutation");
          }
        },
      },
      timers,
    });
    const pending = candidateHarness({ id: "mutate-then-throw" });
    const registration = owner.register(delegate(transaction([pending.candidate])));

    const receipt = registration.requestSweep().done;
    pending.state = "started";
    timers.advance(10);

    await expect(receipt).resolves.toBe("failed");
    expect(onDemand).toBe(true);
    expect(owner.snapshot().activeCount).toBe(0);
  });

  it("invalidates a tab owned by an active sweep, not only a recovery key", async () => {
    const { onDemand, owner } = ownerHarness();
    const tab = { id: "sweep-candidate" };
    const pending = candidateHarness(tab);
    const registration = owner.register(delegate(transaction([pending.candidate])));

    const receipt = registration.requestSweep().done;
    expect(registration.invalidateTab(tab)).toBe(true);
    expect(pending.rollbackCalls).toBe(1);
    expect(onDemand()).toBe(true);
    await expect(receipt).resolves.toBe("failed");
  });

  it("rolls back native-window candidates before treating their realm as terminal", async () => {
    const { onDemand, owner } = ownerHarness();
    const pending = candidateHarness({ id: "closing-window" });
    const registration = owner.register(delegate(transaction([pending.candidate])));

    const receipt = registration.requestSweep().done;
    expect(registration.dispose("window-closed")).toBe(true);

    expect(pending.rollbackCalls).toBe(1);
    expect(onDemand()).toBe(true);
    await expect(receipt).resolves.toBe("canceled");
  });

  it("applies a settings callback reentrantly without restoring the stale original", async () => {
    let onDemand = true;
    const timers = new ManualApplicationTimers();
    let registration!: ApplicationRegistration<Tab, Evidence>;
    const writes: boolean[] = [];
    const owner = new KeepLoadedApplicationOwner<Tab, Evidence>({
      applicationId: "reentrant-setting",
      preferences: {
        readOnDemand: () => onDemand,
        writeOnDemand: value => {
          onDemand = value;
          writes.push(value);
          if (!value) {
            registration.reconcileOnDemand(false);
          }
        },
      },
      timers,
    });
    const pending = candidateHarness({ id: "reentrant-setting" });
    registration = owner.register(delegate(transaction([pending.candidate])));

    const receipt = registration.requestSweep().done;
    pending.state = "started";
    timers.advance(10);

    await expect(receipt).resolves.toBe("completed");
    expect(writes).toEqual([false]);
    expect(onDemand).toBe(false);
  });

  it("reconciles a desired target changed during the final preference write", async () => {
    let onDemand = true;
    const timers = new ManualApplicationTimers();
    let registration!: ApplicationRegistration<Tab, Evidence>;
    const writes: boolean[] = [];
    const owner = new KeepLoadedApplicationOwner<Tab, Evidence>({
      applicationId: "reentrant-final-target",
      preferences: {
        readOnDemand: () => onDemand,
        writeOnDemand: value => {
          onDemand = value;
          writes.push(value);
          if (value) {
            registration.reconcileOnDemand(false);
          }
        },
      },
      timers,
    });
    const pending = candidateHarness({ id: "reentrant-final-target" });
    registration = owner.register(delegate(transaction([pending.candidate])));

    const receipt = registration.requestSweep().done;
    pending.state = "started";
    timers.advance(10);

    await expect(receipt).resolves.toBe("completed");
    expect(writes).toEqual([false, true, false]);
    expect(onDemand).toBe(false);
    expect(owner.snapshot()).toMatchObject({
      activeCount: 0,
      desiredOnDemand: false,
      wakePhase: "idle",
    });
  });

  it("does not insert while a synchronous observer reverses the held preference", async () => {
    let onDemand = true;
    let reverseWrite = true;
    const errors: unknown[] = [];
    const timers = new ManualApplicationTimers();
    const writes: boolean[] = [];
    const owner = new KeepLoadedApplicationOwner<Tab, Evidence>({
      applicationId: "reentrant-physical-pref",
      preferences: {
        readOnDemand: () => onDemand,
        writeOnDemand: value => {
          onDemand = value;
          writes.push(value);
          if (!value && reverseWrite) {
            onDemand = true;
          }
        },
      },
      reportError: error => errors.push(error),
      timers,
    });
    const pending = candidateHarness({ id: "reentrant-physical-pref" });
    const registration = owner.register(delegate(transaction([pending.candidate])));

    const receipt = registration.requestSweep().done;
    expect(pending.insertCalls).toBe(0);
    expect(onDemand).toBe(true);
    expect(owner.snapshot()).toMatchObject({
      activeCount: 1,
      wakeCandidates: 0,
      wakePhase: "idle",
    });
    await expect(receipt).resolves.toBe("failed");
    expect(owner.snapshot().activeCount).toBe(0);

    reverseWrite = false;
    const successor = registration.requestSweep().done;
    expect(pending.insertCalls).toBe(1);
    expect(onDemand).toBe(false);
    pending.state = "started";
    timers.advance(10);

    await expect(successor).resolves.toBe("completed");
    expect(onDemand).toBe(true);
    expect(writes).toEqual([false, false, true]);
    expect(errors).toHaveLength(1);
  });

  it("does not report an idle desired write applied when an observer reverses it", () => {
    let onDemand = true;
    let reverseWrite = true;
    const errors: unknown[] = [];
    const timers = new ManualApplicationTimers();
    const owner = new KeepLoadedApplicationOwner<Tab, Evidence>({
      applicationId: "idle-physical-pref",
      preferences: {
        readOnDemand: () => onDemand,
        writeOnDemand: value => {
          onDemand = reverseWrite ? !value : value;
        },
      },
      reportError: error => errors.push(error),
      timers,
    });
    const registration = owner.register(delegate());

    expect(registration.reconcileOnDemand(false)).toBe(false);
    expect(onDemand).toBe(true);
    expect(owner.snapshot().desiredOnDemand).toBe(false);
    expect(errors).toHaveLength(1);

    reverseWrite = false;
    expect(registration.reconcileOnDemand(false)).toBe(true);
    expect(onDemand).toBe(false);
  });

  it("rolls back and releases instead of wedging when wake timer scheduling fails", async () => {
    let onDemand = true;
    const errors: unknown[] = [];
    const owner = new KeepLoadedApplicationOwner<Tab, Evidence>({
      applicationId: "timer-schedule-failure",
      preferences: {
        readOnDemand: () => onDemand,
        writeOnDemand: value => {
          onDemand = value;
        },
      },
      reportError: error => errors.push(error),
      timers: {
        clearTimeout: () => {},
        now: () => 0,
        setTimeout: () => {
          throw new Error("timer unavailable");
        },
      },
    });
    const pending = candidateHarness({ id: "timer-schedule-failure" });
    const registration = owner.register(delegate(transaction([pending.candidate])));

    await expect(registration.requestSweep().done).resolves.toBe("failed");
    expect(pending.insertCalls).toBe(1);
    expect(pending.rollbackCalls).toBe(1);
    expect(pending.state).toBe("lazy");
    expect(onDemand).toBe(true);
    expect(owner.snapshot()).toMatchObject({
      activeCount: 0,
      wakeCandidates: 0,
      wakePhase: "idle",
    });
    expect(errors.map(error => String(error))).toContain("Error: timer unavailable");
  });

  it("fails before insertion and drains when the initial hold write is refused", async () => {
    let onDemand = true;
    let refuseHold = true;
    const errors: unknown[] = [];
    const timers = new ManualApplicationTimers();
    const owner = new KeepLoadedApplicationOwner<Tab, Evidence>({
      applicationId: "hold-write-refused",
      preferences: {
        readOnDemand: () => onDemand,
        writeOnDemand: value => {
          if (!value && refuseHold) {
            throw new Error("hold refused");
          }
          onDemand = value;
        },
      },
      reportError: error => errors.push(error),
      timers,
    });
    const pending = candidateHarness({ id: "hold-write-refused" });
    const registration = owner.register(delegate(transaction([pending.candidate])));

    await expect(registration.requestSweep().done).resolves.toBe("failed");
    expect(pending.insertCalls).toBe(0);
    expect(onDemand).toBe(true);
    expect(owner.snapshot()).toMatchObject({
      activeCount: 0,
      keyRecords: 0,
      wakePhase: "idle",
    });

    refuseHold = false;
    const successor = registration.requestSweep().done;
    expect(pending.insertCalls).toBe(1);
    pending.state = "started";
    timers.advance(10);

    await expect(successor).resolves.toBe("completed");
    expect(onDemand).toBe(true);
    expect(errors.map(error => String(error))).toContain("Error: hold refused");
  });

  it("retains acquisition ownership until a mutate-then-fail hold is restored", async () => {
    let onDemand = true;
    let failVerificationRead = false;
    let refuseRestore = true;
    const errors: unknown[] = [];
    const timers = new ManualApplicationTimers();
    const owner = new KeepLoadedApplicationOwner<Tab, Evidence>({
      applicationId: "failed-acquisition-restore",
      preferences: {
        readOnDemand: () => {
          if (failVerificationRead) {
            failVerificationRead = false;
            throw new Error("hold verification unavailable");
          }
          return onDemand;
        },
        writeOnDemand: value => {
          if (!value) {
            onDemand = false;
            failVerificationRead = true;
            throw new Error("hold reported failure after mutation");
          }
          if (refuseRestore) {
            throw new Error("restore refused");
          }
          onDemand = true;
        },
      },
      reportError: error => errors.push(error),
      timers,
    });
    const pending = candidateHarness({ id: "failed-acquisition-restore" });
    const registration = owner.register(delegate(transaction([pending.candidate])));
    let settled = false;
    const receipt = registration.requestSweep().done;
    void receipt.then(() => {
      settled = true;
    });
    await settle();

    expect(settled).toBe(false);
    expect(pending.insertCalls).toBe(0);
    expect(onDemand).toBe(false);
    expect(owner.snapshot()).toMatchObject({
      activeCount: 1,
      keyRecords: 1,
      wakeCandidates: 0,
      wakePhase: "blocked",
    });

    refuseRestore = false;
    timers.advance(10);
    await expect(receipt).resolves.toBe("failed");
    expect(onDemand).toBe(true);
    expect(owner.snapshot()).toMatchObject({
      activeCount: 0,
      keyRecords: 0,
      wakePhase: "idle",
    });
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it("uses one immediate cleanup fallback when a blocked retry timer cannot arm", async () => {
    const { onDemand, owner, timers } = ownerHarness();
    const pending = candidateHarness({ id: "blocked-arm-failure" });
    pending.candidate = Object.freeze({
      ...pending.candidate,
      rollback: () => {
        pending.rollbackCalls += 1;
        if (pending.rollbackCalls === 1) {
          return false;
        }
        pending.state = "lazy";
        return true;
      },
    });
    const registration = owner.register(delegate(transaction([pending.candidate])));
    const receipt = registration.requestSweep().done;

    timers.advance(10);
    timers.failNextSet();
    timers.advance(10);
    await settle();

    expect(pending.rollbackCalls).toBe(2);
    expect(onDemand()).toBe(false);
    expect(owner.snapshot()).toMatchObject({
      activeCount: 1,
      wakeAttempt: 1,
      wakePhase: "retrying",
      wakeRetryScheduled: true,
    });

    timers.advance(10);
    pending.state = "started";
    timers.advance(10);
    await expect(receipt).resolves.toBe("failed");
    expect(onDemand()).toBe(true);
    expect(owner.snapshot()).toMatchObject({
      activeCount: 0,
      wakePhase: "idle",
      wakeRetryScheduled: false,
    });
  });

  it("uses the bounded fallback when a final preference retry timer cannot arm", async () => {
    let onDemand = true;
    let restoreFailures = 1;
    const timers = new ManualApplicationTimers();
    const owner = new KeepLoadedApplicationOwner<Tab, Evidence>({
      applicationId: "restore-arm-failure",
      preferences: {
        readOnDemand: () => onDemand,
        writeOnDemand: value => {
          if (value && restoreFailures > 0) {
            restoreFailures -= 1;
            throw new Error("restore unavailable");
          }
          onDemand = value;
        },
      },
      timers,
    });
    const pending = candidateHarness({ id: "restore-arm-failure" });
    const registration = owner.register(delegate(transaction([pending.candidate])));
    const receipt = registration.requestSweep().done;

    pending.state = "started";
    timers.failNextSet();
    timers.advance(10);

    await expect(receipt).resolves.toBe("failed");
    expect(onDemand).toBe(true);
    expect(restoreFailures).toBe(0);
    expect(owner.snapshot()).toMatchObject({ activeCount: 0, wakePhase: "idle" });
  });
});
