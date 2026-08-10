import { describe, expect, it } from "vitest";

import { type PulseSchedule, SerialPulseScheduler } from "./pulse-scheduler.ts";

class ManualClock {
  now = 0;
  #nextId = 1;
  readonly tasks = new Map<
    number,
    { at: number; callback: () => void; canceled: boolean }
  >();

  readonly setTimeout = (callback: () => void, delayMs: number) => {
    const id = this.#nextId++;
    this.tasks.set(id, { at: this.now + delayMs, callback, canceled: false });
    return id;
  };

  readonly clearTimeout = (id: number) => {
    const task = this.tasks.get(id);
    if (task) {
      task.canceled = true;
    }
  };

  advance(ms: number) {
    this.now += ms;
    for (;;) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => !task.canceled && task.at <= this.now)
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

const settings = (everyMs = 30, holdMs = 10): PulseSchedule => ({ everyMs, holdMs });

describe("SerialPulseScheduler", () => {
  it("starts on an intended deadline and exposes one in-flight cycle", () => {
    const clock = new ManualClock();
    const starts: number[] = [];
    const scheduler = new SerialPulseScheduler({
      now: () => clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: handle => clock.clearTimeout(handle as number),
      onDue: () => starts.push(clock.now),
    });

    scheduler.set(settings());
    clock.advance(29);
    expect(starts).toEqual([]);
    expect(scheduler.inFlight).toBe(false);
    clock.advance(1);
    expect(starts).toEqual([30]);
    expect(scheduler.inFlight).toBe(true);
  });

  it("keeps one fair trailing cycle after an overrun, without catch-up bursts", () => {
    const clock = new ManualClock();
    const starts: number[] = [];
    const scheduler = new SerialPulseScheduler({
      now: () => clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: handle => clock.clearTimeout(handle as number),
      onDue: () => starts.push(clock.now),
    });

    scheduler.set(settings());
    clock.advance(30);
    clock.advance(40);
    // The next intended start was 60, so this is one immediate trailing cycle.
    scheduler.complete();
    expect(starts).toEqual([30]);
    clock.advance(0);
    expect(starts).toEqual([30, 70]);
    expect(scheduler.inFlight).toBe(true);
    // The next regular deadline is measured from the trailing start, not a burst of
    // every missed 30ms slot.
    scheduler.complete();
    clock.advance(29);
    expect(starts).toEqual([30, 70]);
    clock.advance(1);
    expect(starts).toEqual([30, 70, 100]);
  });

  it("coalesces repeated settings and cancels all future work when disabled", () => {
    const clock = new ManualClock();
    const starts: number[] = [];
    const scheduler = new SerialPulseScheduler({
      now: () => clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: handle => clock.clearTimeout(handle as number),
      onDue: () => starts.push(clock.now),
    });

    scheduler.set(settings(50));
    scheduler.set(settings(20));
    clock.advance(19);
    expect(starts).toEqual([]);
    clock.advance(1);
    expect(starts).toEqual([20]);
    scheduler.set({ everyMs: 0, holdMs: 0 });
    scheduler.complete();
    clock.advance(1000);
    expect(starts).toEqual([20]);
    expect(scheduler.inFlight).toBe(false);
  });

  it("returns to a normal interval when the trailing cycle also overruns", () => {
    const clock = new ManualClock();
    const starts: number[] = [];
    const scheduler = new SerialPulseScheduler({
      now: () => clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: handle => clock.clearTimeout(handle as number),
      onDue: () => starts.push(clock.now),
    });

    scheduler.set(settings());
    clock.advance(30);
    clock.advance(40);
    scheduler.complete();
    clock.advance(0);
    expect(starts).toEqual([30, 70]);
    clock.advance(40);
    scheduler.complete();
    expect(starts).toEqual([30, 70]);
    clock.advance(29);
    expect(starts).toEqual([30, 70]);
    clock.advance(1);
    expect(starts).toEqual([30, 70, 140]);
    clock.advance(30);
    expect(starts).toEqual([30, 70, 140]);
  });

  it("does not begin a second cycle while the first due callback is still in flight", () => {
    const clock = new ManualClock();
    const starts: number[] = [];
    const scheduler = new SerialPulseScheduler({
      now: () => clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: handle => clock.clearTimeout(handle as number),
      onDue: () => starts.push(clock.now),
    });

    scheduler.set(settings());
    clock.advance(30);
    clock.advance(100);
    expect(starts).toEqual([30]);
    scheduler.complete();
    clock.advance(0);
    expect(starts).toEqual([30, 130]);
  });

  it("reports a due-callback failure and still permits the next intended cycle", () => {
    const clock = new ManualClock();
    const errors: unknown[] = [];
    let calls = 0;
    const scheduler = new SerialPulseScheduler({
      now: () => clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: handle => clock.clearTimeout(handle as number),
      onDue: () => {
        calls += 1;
        if (calls === 1) {
          throw new Error("pulse callback failed");
        }
      },
      onError: error => errors.push(error),
    });

    scheduler.set(settings());
    clock.advance(30);
    expect(errors).toHaveLength(1);
    expect(scheduler.inFlight).toBe(false);
    clock.advance(30);
    expect(calls).toBe(2);
  });
});
