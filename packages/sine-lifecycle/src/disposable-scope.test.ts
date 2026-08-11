import { describe, expect, it, vi } from "vitest";

import { DisposableScope } from "./disposable-scope.js";

describe("DisposableScope", () => {
  it("becomes terminal before draining every disposer in LIFO order", () => {
    const errors: unknown[] = [];
    const calls: string[] = [];
    const scope = new DisposableScope({ onDisposeError: error => errors.push(error) });

    scope.defer(() => calls.push(`first:${scope.isLive()}`));
    scope.defer(() => {
      calls.push(`throwing:${scope.isLive()}`);
      throw new Error("cleanup failed");
    });
    scope.defer(() => calls.push(`last:${scope.isLive()}`));

    expect(scope.stop()).toBe(true);
    expect(scope.stop()).toBe(false);
    expect(calls).toEqual(["last:false", "throwing:false", "first:false"]);
    expect(errors).toHaveLength(1);
  });

  it("disposes a late resource immediately", () => {
    const dispose = vi.fn();
    const scope = new DisposableScope();

    scope.stop();
    scope.defer(dispose);

    expect(dispose).toHaveBeenCalledOnce();
  });

  it("contains synchronous and asynchronous reporter failures", async () => {
    const rejected = Promise.reject(new Error("reporter rejected"));
    const scope = new DisposableScope({
      onDisposeError: () => rejected,
    });
    scope.defer(() => {
      throw new Error("cleanup failed");
    });

    expect(() => scope.stop()).not.toThrow();
    await expect(rejected).rejects.toThrow("reporter rejected");

    const throwingReporter = new DisposableScope({
      onDisposeError: () => {
        throw new Error("reporter failed");
      },
    });
    throwingReporter.defer(() => {
      throw new Error("cleanup failed");
    });
    expect(() => throwingReporter.stop()).not.toThrow();
  });
});
