export interface TimerPort {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

export type WaitResult<T> = { kind: "ready"; value: T } | { kind: "stopped" };

export interface GenerationScopeOptions {
  timers: TimerPort;
  onDisposeError?: (error: unknown) => unknown;
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  "then" in value &&
  typeof value.then === "function";

/**
 * Owns everything whose lifetime is exactly one cache-busted Sine generation.
 * Terminal means terminal: a replacement module gets a different scope and can
 * never make an old continuation live again.
 */
export class GenerationScope {
  readonly #abort = new AbortController();
  readonly #disposers = new DisposableStack();
  readonly #onDisposeError: (error: unknown) => void;
  readonly #stopSubscribers = new Set<() => void>();
  readonly #timers: TimerPort;
  readonly #timerCancels = new Set<() => void>();
  #live = true;

  constructor({ timers, onDisposeError = () => {} }: GenerationScopeOptions) {
    this.#timers = timers;
    this.#onDisposeError = error => {
      try {
        const result = onDisposeError(error);
        if (isThenable(result)) {
          void Promise.resolve(result).catch(() => {});
        }
      } catch {
        // Error reporting is not allowed to interrupt terminal cleanup.
      }
    };
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

  /** Adds synchronous cleanup in LIFO order. A late resource is closed immediately. */
  defer(disposer: () => unknown): void {
    const synchronous = () => {
      const result = disposer();
      if (!isThenable(result)) {
        return;
      }
      void Promise.resolve(result).catch(this.#onDisposeError);
      throw new TypeError("generation disposers must finish synchronously");
    };

    if (this.#live) {
      this.#disposers.defer(synchronous);
      return;
    }
    try {
      synchronous();
    } catch (error) {
      this.#onDisposeError(error);
    }
  }

  /** Races external work against terminal stop without abandoning its rejection. */
  wait<T>(work: PromiseLike<T> | T): Promise<WaitResult<T>> {
    if (!this.#live) {
      // The caller handed the work over even though this generation is terminal. It
      // cannot become current, but its rejection still needs an owner.
      void Promise.resolve(work).catch(this.#onDisposeError);
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
          this.#onDisposeError(error);
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

  /** Returns a repeat-safe cancellation function for one generation-owned timer. */
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

  /** Marks terminal before cancellation or cleanup and never throws through unload. */
  stop(): boolean {
    if (!this.#live) {
      return false;
    }
    this.#live = false;
    for (const settle of [...this.#stopSubscribers]) {
      try {
        settle();
      } catch (error) {
        this.#onDisposeError(error);
      }
    }
    this.#stopSubscribers.clear();
    for (const cancel of [...this.#timerCancels]) {
      try {
        cancel();
      } catch (error) {
        this.#onDisposeError(error);
      }
    }
    try {
      this.#abort.abort();
    } catch (error) {
      this.#onDisposeError(error);
    }
    try {
      this.#disposers.dispose();
    } catch (error) {
      this.#onDisposeError(error);
    }
    return true;
  }
}
