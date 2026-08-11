import { type ErrorReporter, safeReporter, synchronousDisposer } from "./errors.js";

export interface DisposableScopeOptions {
  onDisposeError?: ErrorReporter;
}

/** Owns synchronous resources until one terminal, failure-isolated LIFO drain. */
export class DisposableScope {
  readonly #disposers: DisposableStack;
  readonly #report: (error: unknown) => void;
  #live = true;

  constructor({ onDisposeError }: DisposableScopeOptions = {}) {
    if (typeof DisposableStack !== "function") {
      throw new Error("@zen-mods/sine-lifecycle requires DisposableStack");
    }
    this.#disposers = new DisposableStack();
    this.#report = safeReporter(onDisposeError);
  }

  isLive(): boolean {
    return this.#live;
  }

  defer(disposer: () => unknown): void {
    const synchronous = synchronousDisposer(disposer, this.#report);
    if (this.#live) {
      this.#disposers.defer(synchronous);
      return;
    }
    try {
      synchronous();
    } catch (error) {
      this.#report(error);
    }
  }

  stop(): boolean {
    if (!this.#live) {
      return false;
    }
    this.#live = false;
    try {
      this.#disposers.dispose();
    } catch (error) {
      this.#report(error);
    }
    return true;
  }
}
