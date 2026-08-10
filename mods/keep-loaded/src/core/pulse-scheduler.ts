import type { PulseSettings } from "./freshness.ts";

/** The settings a process-wide freshness clock needs; the hold is used by its clients. */
export type PulseSchedule = PulseSettings;

export interface PulseSchedulerOptions {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  onDue: () => void;
  onError?: (error: unknown) => void;
}

interface ScheduledTimer {
  readonly token: object;
  handle: unknown;
}

const OFF: PulseSchedule = Object.freeze({ everyMs: 0, holdMs: 0 });

const validSchedule = (schedule: PulseSchedule): boolean =>
  Number.isFinite(schedule.everyMs) &&
  Number.isFinite(schedule.holdMs) &&
  schedule.everyMs >= 0 &&
  schedule.holdMs >= 0;

/**
 * One intended-start clock for the whole application. The owner calls `complete` when
 * the serial pulse operation has drained. A late completion schedules one trailing run
 * at once and then returns to a normal interval; it never replays every missed slot.
 */
export class SerialPulseScheduler {
  readonly #now: () => number;
  readonly #setTimeout: PulseSchedulerOptions["setTimeout"];
  readonly #clearTimeout: PulseSchedulerOptions["clearTimeout"];
  readonly #onDue: () => void;
  readonly #onError: (error: unknown) => void;
  #deadline: number | null = null;
  #inFlight = false;
  #schedule: PulseSchedule = OFF;
  #stopped = false;
  #trailingCycle = false;
  #timer: ScheduledTimer | null = null;

  constructor({ now, setTimeout, clearTimeout, onDue, onError }: PulseSchedulerOptions) {
    this.#now = now;
    this.#setTimeout = setTimeout;
    this.#clearTimeout = clearTimeout;
    this.#onDue = onDue;
    this.#onError = error => {
      try {
        onError?.(error);
      } catch {
        // A diagnostic callback cannot be allowed to wedge the schedule.
      }
    };
  }

  get inFlight(): boolean {
    return this.#inFlight;
  }

  get schedule(): PulseSchedule {
    return this.#schedule;
  }

  set(schedule: PulseSchedule): void {
    if (this.#stopped) {
      return;
    }
    if (!validSchedule(schedule)) {
      throw new RangeError("pulse schedule must contain finite non-negative durations");
    }
    const next = Object.freeze({
      everyMs: schedule.everyMs,
      holdMs: Math.min(schedule.holdMs, schedule.everyMs),
    });
    if (
      this.#schedule.everyMs === next.everyMs &&
      this.#schedule.holdMs === next.holdMs
    ) {
      return;
    }
    const wasEnabled = this.#schedule.everyMs > 0;
    this.#schedule = next;
    if (next.everyMs <= 0) {
      this.#deadline = null;
      this.#trailingCycle = false;
      this.#clearScheduledTimer();
      return;
    }
    if (!wasEnabled) {
      this.#deadline = this.#now() + next.everyMs;
      this.#arm();
      return;
    }
    if (!this.#inFlight) {
      // A setting edit before the next due point is a new intended deadline. When a
      // cycle is already running, its completion applies the new interval instead.
      this.#deadline = this.#now() + next.everyMs;
      this.#arm();
    }
  }

  complete(): void {
    if (!this.#inFlight) {
      return;
    }
    this.#inFlight = false;
    if (this.#stopped || this.#schedule.everyMs <= 0) {
      this.#deadline = null;
      this.#trailingCycle = false;
      this.#clearScheduledTimer();
      return;
    }
    const now = this.#now();
    if (this.#trailingCycle) {
      // The trailing cycle is the single fairness escape hatch. Even if it also
      // overruns, return to a normal interval instead of creating another catch-up.
      this.#trailingCycle = false;
      this.#deadline = now + this.#schedule.everyMs;
      this.#arm();
      return;
    }
    const intendedNext = (this.#deadline ?? now) + this.#schedule.everyMs;
    if (intendedNext > now) {
      this.#deadline = intendedNext;
    } else {
      // One and only one fair trailing cycle. Its completion establishes the next
      // normal interval, preventing an overload from producing a catch-up burst.
      this.#deadline = now;
      this.#trailingCycle = true;
    }
    this.#arm();
  }

  stop(): void {
    this.#stopped = true;
    this.#schedule = OFF;
    this.#deadline = null;
    this.#trailingCycle = false;
    this.#clearScheduledTimer();
  }

  #arm(): void {
    this.#clearScheduledTimer();
    if (this.#stopped || this.#schedule.everyMs <= 0 || this.#deadline === null) {
      return;
    }
    const token = Object.freeze({});
    const timer: ScheduledTimer = { handle: null, token };
    this.#timer = timer;
    try {
      timer.handle = this.#setTimeout(
        () => {
          if (this.#timer !== timer || this.#stopped || this.#schedule.everyMs <= 0) {
            return;
          }
          this.#timer = null;
          this.#inFlight = true;
          try {
            this.#onDue();
          } catch (error) {
            this.#onError(error);
            this.complete();
          }
        },
        Math.max(0, this.#deadline - this.#now()),
      );
    } catch (error) {
      if (this.#timer === timer) {
        this.#timer = null;
      }
      this.#onError(error);
    }
  }

  #clearScheduledTimer(): void {
    const timer = this.#timer;
    if (!timer) {
      return;
    }
    this.#timer = null;
    if (timer.handle === null) {
      return;
    }
    try {
      this.#clearTimeout(timer.handle);
    } catch (error) {
      this.#onError(error);
    }
  }
}
