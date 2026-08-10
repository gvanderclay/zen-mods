import { describe, expect, it } from "vitest";
import { KeepLoadedController, type OperationToken } from "./controller.ts";

class ManualTimers {
  #nextId = 1;
  readonly tasks = new Map<number, { callback: () => void; canceled: boolean }>();

  readonly setTimeout = (callback: () => void) => {
    const id = this.#nextId++;
    this.tasks.set(id, { callback, canceled: false });
    return id;
  };

  readonly clearTimeout = (id: number) => {
    const task = this.tasks.get(id);
    if (task) {
      task.canceled = true;
    }
  };

  force(id: number) {
    this.tasks.get(id)?.callback();
  }
}

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
};

const controllerHarness = (onDemand = true) => {
  const timers = new ManualTimers();
  const writes: boolean[] = [];
  let current = onDemand;
  const controller = new KeepLoadedController({
    timers,
    preferences: {
      readOnDemand: () => current,
      writeOnDemand: value => {
        current = value;
        writes.push(value);
      },
    },
  });
  return { controller, current: () => current, timers, writes };
};

describe("KeepLoadedController", () => {
  it("keeps startup readiness terminal after a replacement starts", async () => {
    const oldHarness = controllerHarness();
    const replacement = controllerHarness();
    const startup = deferred();
    const oldMutations: string[] = [];
    const replacementMutations: string[] = [];
    const oldWork = oldHarness.controller.wait(startup.promise).then(result => {
      if (result.kind === "ready" && oldHarness.controller.isLive()) {
        oldMutations.push("startup");
      }
    });

    oldHarness.controller.stop();
    await replacement.controller.runSweep(async () => {
      replacementMutations.push("startup");
    });
    startup.resolve();
    await oldWork;

    expect(oldMutations).toEqual([]);
    expect(replacementMutations).toEqual(["startup"]);
    expect(oldHarness.controller.state).toEqual({ kind: "stopped", reason: "manual" });
  });

  it("restores a held wake preference once and rejects the stale finally", async () => {
    let pref = true;
    const writes: Array<{ owner: string; value: boolean }> = [];
    const make = (owner: string) =>
      new KeepLoadedController({
        timers: new ManualTimers(),
        preferences: {
          readOnDemand: () => pref,
          writeOnDemand: value => {
            pref = value;
            writes.push({ owner, value });
          },
        },
      });
    const old = make("old");
    const replacement = make("replacement");
    const oldGate = deferred();
    const replacementGate = deferred();
    const oldHeld = deferred();
    const replacementHeld = deferred();

    const oldRun = old.runSweep(token =>
      old.withOnDemandDisabled(token, async () => {
        oldHeld.resolve();
        await old.wait(oldGate.promise);
      }),
    );
    await oldHeld.promise;
    old.stop();

    const replacementRun = replacement.runSweep(token =>
      replacement.withOnDemandDisabled(token, async () => {
        replacementHeld.resolve();
        await replacement.wait(replacementGate.promise);
      }),
    );
    await replacementHeld.promise;
    oldGate.resolve();
    await oldRun;

    expect(pref).toBe(false);
    expect(writes).toEqual([
      { owner: "old", value: false },
      { owner: "old", value: true },
      { owner: "replacement", value: false },
    ]);

    replacementGate.resolve();
    await replacementRun;
    expect(pref).toBe(true);
  });

  it("represents recovery ownership with its exact tab and token", async () => {
    const { controller } = controllerHarness();
    const tab = { id: "mail" } as unknown as BrowserTab;
    const gate = deferred();
    let captured!: OperationToken;
    const recovery = controller.runRecovery(
      tab,
      { pollMs: 10, timeoutMs: 100 },
      async token => {
        captured = token;
        expect(controller.state).toEqual({
          kind: "live",
          operation: { kind: "recovery", restore: { kind: "unheld" }, tab, token },
        });
        await controller.wait(gate.promise);
      },
    );

    await Promise.resolve();
    expect(captured).toBeDefined();
    gate.resolve();
    await recovery;
    expect(controller.state).toEqual({ kind: "live", operation: { kind: "idle" } });
  });

  it("does not begin a queued recovery after its generation stops", async () => {
    const { controller } = controllerHarness();
    const sweepGate = deferred();
    const sweep = controller.runSweep(async () => {
      await controller.wait(sweepGate.promise);
    });
    const recoveries: string[] = [];
    const recovery = controller.runRecovery(
      { id: "mail" } as unknown as BrowserTab,
      { pollMs: 10, timeoutMs: 100 },
      async () => {
        recoveries.push("started");
      },
    );

    controller.stop();
    sweepGate.resolve();
    await Promise.all([sweep, recovery]);

    expect(recoveries).toEqual([]);
  });

  it("makes a canceled freshness callback inert even when forced", () => {
    const { controller, timers } = controllerHarness();
    const mutations: string[] = [];
    controller.schedule(100, () => mutations.push("pulse"));
    const [timer] = timers.tasks.keys();

    controller.stop();
    if (timer !== undefined) {
      timers.force(timer);
    }

    expect(mutations).toEqual([]);
  });

  it("does not fill a stale panel after its wake promise settles", async () => {
    const { controller } = controllerHarness();
    const wake = deferred();
    const fills: string[] = [];
    const settled = controller.settlePanel(
      wake.promise,
      () => fills.push("old"),
      () => fills.push("old-error"),
    );

    controller.stop();
    wake.resolve();
    await settled;

    expect(fills).toEqual([]);
  });

  it("stops and retries a failed preference restore instead of remaining busy", async () => {
    let current = true;
    let restoreAttempts = 0;
    const writes: boolean[] = [];
    const errors: unknown[] = [];
    const controller = new KeepLoadedController({
      timers: new ManualTimers(),
      preferences: {
        readOnDemand: () => current,
        writeOnDemand: value => {
          writes.push(value);
          if (value && restoreAttempts++ === 0) {
            throw new Error("expected first restore failure");
          }
          current = value;
        },
      },
      onDisposeError: error => errors.push(error),
    });

    await expect(
      controller.runSweep(token =>
        controller.withOnDemandDisabled(token, async () => {}),
      ),
    ).resolves.toBe("stopped");

    expect(controller.state).toEqual({
      kind: "stopped",
      reason: "preference-restore-failure",
    });
    expect(controller.isBusy()).toBe(false);
    expect(current).toBe(true);
    expect(writes).toEqual([false, true, true]);
    expect(errors).toHaveLength(1);
  });

  it("contains a throwing restore reporter and retries again during scope disposal", async () => {
    let current = true;
    let restoreAttempts = 0;
    const writes: boolean[] = [];
    const controller = new KeepLoadedController({
      timers: new ManualTimers(),
      preferences: {
        readOnDemand: () => current,
        writeOnDemand: value => {
          writes.push(value);
          if (value && restoreAttempts++ === 0) {
            throw new Error("expected first stop restore failure");
          }
          current = value;
        },
      },
      onDisposeError: () => {
        throw new Error("expected reporter failure");
      },
    });
    const held = deferred();
    const run = controller.runSweep(token =>
      controller.withOnDemandDisabled(token, () => held.promise),
    );
    await Promise.resolve();

    expect(() => controller.stop()).not.toThrow();
    held.resolve();
    await expect(run).resolves.toBe("stopped");

    expect(current).toBe(true);
    expect(writes).toEqual([false, true, true]);
  });

  it("keeps the first terminal stop reason when later lifecycle signals arrive", () => {
    const { controller } = controllerHarness();

    expect(controller.stop("window-unload")).toBe(true);
    expect(controller.stop("sine-unload")).toBe(false);
    expect(controller.stop("replacement")).toBe(false);

    expect(controller.state).toEqual({
      kind: "stopped",
      reason: "window-unload",
    });
    expect(controller.stopReason).toBe("window-unload");
  });

  it("rejects nested ownership of the restore preference and restores the outer lease", async () => {
    const { controller, current, writes } = controllerHarness();

    await expect(
      controller.runSweep(token =>
        controller.withOnDemandDisabled(token, () =>
          controller.withOnDemandDisabled(token, async () => {}),
        ),
      ),
    ).rejects.toThrow("cannot acquire the restore preference twice");

    expect(current()).toBe(true);
    expect(writes).toEqual([false, true]);
    expect(controller.state).toEqual({
      kind: "live",
      operation: { kind: "idle" },
    });
  });
});
