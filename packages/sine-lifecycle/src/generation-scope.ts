import { DisposableScope } from "./disposable-scope.js";
import { type ErrorReporter, safeReporter } from "./errors.js";

export interface TimerPort {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

export type WaitResult<T> = { kind: "ready"; value: T } | { kind: "stopped" };

export interface GenerationScopeOptions {
  timers: TimerPort;
  onDisposeError?: ErrorReporter;
}

/** Owns resources and asynchronous continuations for one terminal generation. */
export class GenerationScope {
  readonly #abort = new AbortController();
  readonly #cleanup: DisposableScope;
  readonly #report: (error: unknown) => void;
  readonly #stopSubscribers = new Set<() => void>();
  readonly #timers: TimerPort;
  readonly #timerCancels = new Set<() => void>();
  #live = true;

  constructor({ timers, onDisposeError }: GenerationScopeOptions) {
    this.#timers = timers;
    this.#report = safeReporter(onDisposeError);
    this.#cleanup = new DisposableScope({ onDisposeError: this.#report });
  }

  get signal(): AbortSignal {
    return this.#abort.signal;
  }

  isLive(): boolean {
    return this.#live;
  }

  get pendingTimers(): number {
    return this.#timerCancels.size;
  }

  get pendingWaits(): number {
    return this.#stopSubscribers.size;
  }

  defer(disposer: () => unknown): void {
    this.#cleanup.defer(disposer);
  }

  wait<T>(work: PromiseLike<T> | T): Promise<WaitResult<T>> {
    if (!this.#live) {
      void Promise.resolve(work).catch(this.#report);
      return Promise.resolve({ kind: "stopped" });
    }
    return new Promise<WaitResult<T>>((resolve, reject) => {
      let settled = false;
      const finish = (result: WaitResult<T>) => {
        if (settled) {
          return;
        }
        settled = true;
        this.#stopSubscribers.delete(onStop);
        resolve(result);
      };
      const onStop = () => finish({ kind: "stopped" });
      this.#stopSubscribers.add(onStop);
      void Promise.resolve(work).then(
        value => finish(this.#live ? { kind: "ready", value } : { kind: "stopped" }),
        error => {
          if (settled) {
            return;
          }
          settled = true;
          this.#stopSubscribers.delete(onStop);
          reject(error);
        },
      );
    });
  }

  sleep(delayMs: number): Promise<"elapsed" | "stopped"> {
    if (!this.#live) {
      return Promise.resolve("stopped");
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let cancel = () => {};
      const finish = (result: "elapsed" | "stopped") => {
        if (settled) {
          return;
        }
        settled = true;
        this.#stopSubscribers.delete(onStop);
        try {
          cancel();
        } catch (error) {
          this.#report(error);
        } finally {
          resolve(result);
        }
      };
      const onStop = () => finish("stopped");
      this.#stopSubscribers.add(onStop);
      try {
        cancel = this.schedule(delayMs, () => finish("elapsed"));
      } catch (error) {
        settled = true;
        this.#stopSubscribers.delete(onStop);
        reject(error);
      }
    });
  }

  schedule(delayMs: number, callback: () => void): () => void {
    if (!this.#live) {
      return () => {};
    }
    let active = true;
    let handle = 0;
    const cancel = () => {
      if (!active) {
        return;
      }
      active = false;
      this.#timerCancels.delete(cancel);
      this.#timers.clearTimeout(handle);
    };
    handle = this.#timers.setTimeout(() => {
      if (!active) {
        return;
      }
      active = false;
      this.#timerCancels.delete(cancel);
      if (this.#live) {
        callback();
      }
    }, delayMs);
    this.#timerCancels.add(cancel);
    return cancel;
  }

  stop(): boolean {
    if (!this.#live) {
      return false;
    }
    this.#live = false;
    for (const settle of [...this.#stopSubscribers]) {
      try {
        settle();
      } catch (error) {
        this.#report(error);
      }
    }
    this.#stopSubscribers.clear();
    for (const cancel of [...this.#timerCancels]) {
      try {
        cancel();
      } catch (error) {
        this.#report(error);
      }
    }
    try {
      this.#abort.abort();
    } catch (error) {
      this.#report(error);
    }
    this.#cleanup.stop();
    return true;
  }
}
