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

const controllerHarness = () => {
  const timers = new ManualTimers();
  const controller = new KeepLoadedController({ timers });
  return { controller, timers };
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
          operation: { kind: "recovery", tab, token },
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
});
