import { GenerationScope, type TimerPort, type WaitResult } from "./lifecycle.ts";

export interface KeepLoadedControllerOptions {
  timers: TimerPort;
  now?: () => number;
  onDisposeError?: (error: unknown) => unknown;
}

export type OperationToken = Readonly<{ ordinal: number }>;

export type OperationState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{
      kind: "sweep";
      token: OperationToken;
    }>
  | Readonly<{
      kind: "recovery";
      token: OperationToken;
      tab: BrowserTab;
    }>;

export type StopReason =
  | "manual"
  | "replacement"
  | "sine-unload"
  | "startup-failure"
  | "window-unload";

export type ControllerState =
  | Readonly<{ kind: "live"; operation: OperationState }>
  | Readonly<{ kind: "stopped"; reason: StopReason }>;

type OperationWork = (token: OperationToken) => Promise<void> | void;

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  "then" in value &&
  typeof value.then === "function";

/**
 * Owns the terminal state of one Keep Loaded module generation. Browser policy stays
 * in the runtime; this object makes its asynchronous effects exclusive to the exact
 * generation and local operation that began them. The application coordinator owns
 * cross-window work and the shared restore preference.
 */
export class KeepLoadedController {
  readonly #now: () => number;
  readonly #onDisposeError: (error: unknown) => void;
  readonly #scope: GenerationScope;
  #nextOperation = 1;
  #state: ControllerState = { kind: "live", operation: { kind: "idle" } };

  constructor({ timers, now = Date.now, onDisposeError }: KeepLoadedControllerOptions) {
    this.#now = now;
    this.#onDisposeError = error => {
      try {
        const result = onDisposeError?.(error);
        if (isThenable(result)) {
          void Promise.resolve(result).catch(() => {});
        }
      } catch {
        // Reporting must never interrupt the terminal cleanup it describes.
      }
    };
    this.#scope = new GenerationScope({
      timers,
      onDisposeError: this.#onDisposeError,
    });
  }

  get signal(): AbortSignal {
    return this.#scope.signal;
  }

  get state(): ControllerState {
    return this.#state;
  }

  get stopReason(): StopReason | null {
    return this.#state.kind === "stopped" ? this.#state.reason : null;
  }

  get pendingTimers(): number {
    return this.#scope.pendingTimers;
  }

  get pendingWaits(): number {
    return this.#scope.pendingWaits;
  }

  isLive(): boolean {
    return this.#state.kind === "live" && this.#scope.isLive();
  }

  isBusy(): boolean {
    return this.#state.kind === "live" && this.#state.operation.kind !== "idle";
  }

  isCurrentOperation(token: OperationToken): boolean {
    return (
      this.#state.kind === "live" &&
      this.#state.operation.kind !== "idle" &&
      this.#state.operation.token === token
    );
  }

  defer(disposer: () => unknown): void {
    this.#scope.defer(disposer);
  }

  wait<T>(work: PromiseLike<T> | T): Promise<WaitResult<T>> {
    return this.#scope.wait(work);
  }

  sleep(delayMs: number): Promise<"elapsed" | "stopped"> {
    return this.#scope.sleep(delayMs);
  }

  schedule(delayMs: number, callback: () => void): () => void {
    return this.#scope.schedule(delayMs, callback);
  }

  async runSweep(work: OperationWork): Promise<"completed" | "busy" | "stopped"> {
    const token = this.#beginOperation("sweep");
    if (token === "stopped" || token === "busy") {
      return token;
    }
    try {
      await work(token);
      return this.isCurrentOperation(token) ? "completed" : "stopped";
    } finally {
      this.#finishOperation(token);
    }
  }

  async runRecovery(
    tab: BrowserTab,
    { pollMs, timeoutMs }: { pollMs: number; timeoutMs: number },
    work: OperationWork,
  ): Promise<"completed" | "timed-out" | "stopped"> {
    const deadline = this.#now() + timeoutMs;
    while (this.isBusy() && this.#now() < deadline) {
      if ((await this.sleep(pollMs)) === "stopped") {
        return "stopped";
      }
    }
    if (!this.isLive()) {
      return "stopped";
    }
    if (this.isBusy()) {
      return "timed-out";
    }
    const token = this.#beginOperation("recovery", tab);
    if (token === "stopped" || token === "busy") {
      return token === "busy" ? "timed-out" : token;
    }
    try {
      await work(token);
      return this.isCurrentOperation(token) ? "completed" : "stopped";
    } finally {
      this.#finishOperation(token);
    }
  }

  /** Owns the continuation that platform panel code deliberately does not keep. */
  async settlePanel(
    work: PromiseLike<unknown> | unknown,
    onReady: () => void,
    onError: (error: unknown) => void,
  ): Promise<void> {
    try {
      await work;
      if (this.isLive()) {
        onReady();
      }
    } catch (error) {
      if (this.isLive()) {
        onError(error);
      }
    }
  }

  /** First signal wins; every later lifecycle signal reaches the same terminal no-op. */
  readonly stop = (reason: StopReason = "manual"): boolean => {
    if (this.#state.kind === "stopped") {
      return false;
    }
    this.#state = { kind: "stopped", reason };
    this.#scope.stop();
    return true;
  };

  #beginOperation(
    kind: "sweep" | "recovery",
    tab?: BrowserTab,
  ): OperationToken | "busy" | "stopped" {
    if (this.#state.kind === "stopped") {
      return "stopped";
    }
    if (this.#state.operation.kind !== "idle") {
      return "busy";
    }
    const token = Object.freeze({ ordinal: this.#nextOperation++ });
    this.#state = {
      kind: "live",
      operation:
        kind === "sweep" ? { kind, token } : { kind, token, tab: tab as BrowserTab },
    };
    return token;
  }

  #finishOperation(token: OperationToken): void {
    if (!this.isCurrentOperation(token)) {
      return;
    }
    this.#state = { kind: "live", operation: { kind: "idle" } };
  }
}
