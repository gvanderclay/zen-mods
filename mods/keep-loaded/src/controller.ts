import { GenerationScope, type TimerPort, type WaitResult } from "./lifecycle.ts";

export interface RestorePreferencesPort {
  readOnDemand(): boolean;
  writeOnDemand(value: boolean): void;
}

export interface KeepLoadedControllerOptions {
  timers: TimerPort;
  preferences: RestorePreferencesPort;
  now?: () => number;
  onDisposeError?: (error: unknown) => unknown;
}

export type OperationToken = Readonly<{ ordinal: number }>;

export type RestoreOwnership =
  | Readonly<{ kind: "unheld" }>
  | Readonly<{ kind: "held"; previous: boolean }>;

export type OperationState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{
      kind: "sweep";
      token: OperationToken;
      restore: RestoreOwnership;
    }>
  | Readonly<{
      kind: "recovery";
      token: OperationToken;
      tab: BrowserTab;
      restore: RestoreOwnership;
    }>;

export type StopReason =
  | "manual"
  | "preference-restore-failure"
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

interface RestoreLease {
  active: boolean;
  previous: boolean;
  token: OperationToken;
}

/**
 * Owns the terminal state of one Keep Loaded module generation. Browser policy stays
 * in the runtime; this object makes its asynchronous and global-pref effects exclusive
 * to the exact generation and operation that began them.
 */
export class KeepLoadedController {
  readonly #now: () => number;
  readonly #onDisposeError: (error: unknown) => void;
  readonly #preferences: RestorePreferencesPort;
  readonly #scope: GenerationScope;
  #nextOperation = 1;
  #restoreLease: RestoreLease | null = null;
  #state: ControllerState = { kind: "live", operation: { kind: "idle" } };

  constructor({
    timers,
    preferences,
    now = Date.now,
    onDisposeError,
  }: KeepLoadedControllerOptions) {
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
    this.#preferences = preferences;
    this.#scope = new GenerationScope({
      timers,
      onDisposeError: this.#onDisposeError,
    });
    // One permanent fallback, not one retained closure per wake. A normal release
    // removes its lease; stop retries any restore whose first write threw.
    this.#scope.defer(() => this.#releaseRestore());
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

  async withOnDemandDisabled(
    token: OperationToken,
    work: () => Promise<void> | void,
  ): Promise<void> {
    if (!this.isCurrentOperation(token)) {
      return;
    }
    if (this.#restoreLease?.active) {
      throw new TypeError("an operation cannot acquire the restore preference twice");
    }
    const previous = this.#preferences.readOnDemand();
    this.#restoreLease = { active: true, previous, token };
    this.#setRestore(token, { kind: "held", previous });
    try {
      this.#preferences.writeOnDemand(false);
      if (this.isCurrentOperation(token)) {
        await work();
      }
    } finally {
      try {
        this.#releaseRestore(token, true);
      } catch (error) {
        // A controller that cannot restore the global preference cannot safely take
        // more work. Stop terminally; stop retries the still-owned lease.
        this.#onDisposeError(error);
        this.stop("preference-restore-failure");
      }
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
    const operation = this.#state.operation;
    this.#state = { kind: "stopped", reason };
    if (operation.kind !== "idle") {
      try {
        this.#releaseRestore(operation.token);
      } catch (error) {
        this.#onDisposeError(error);
      }
    }
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
        kind === "sweep"
          ? { kind, token, restore: { kind: "unheld" } }
          : { kind, token, tab: tab as BrowserTab, restore: { kind: "unheld" } },
    };
    return token;
  }

  #finishOperation(token: OperationToken): void {
    if (!this.isCurrentOperation(token)) {
      return;
    }
    if (this.#restoreLease?.active && this.#restoreLease.token === token) {
      return;
    }
    this.#state = { kind: "live", operation: { kind: "idle" } };
  }

  #setRestore(token: OperationToken, restore: RestoreOwnership): void {
    if (
      this.#state.kind !== "live" ||
      this.#state.operation.kind === "idle" ||
      this.#state.operation.token !== token
    ) {
      return;
    }
    const operation = this.#state.operation;
    this.#state = {
      kind: "live",
      operation:
        operation.kind === "sweep"
          ? { ...operation, restore }
          : { ...operation, restore },
    };
  }

  #releaseRestore(token?: OperationToken, updateState = false): void {
    const lease = this.#restoreLease;
    if (!lease?.active || (token && lease.token !== token)) {
      return;
    }
    this.#preferences.writeOnDemand(lease.previous);
    lease.active = false;
    this.#restoreLease = null;
    if (updateState) {
      this.#setRestore(lease.token, { kind: "unheld" });
    }
  }
}
