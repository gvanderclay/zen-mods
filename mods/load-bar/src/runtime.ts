import {
  GenerationScope,
  type TimerPort,
} from "@zen-mods/sine-lifecycle/generation-scope";
import type { SineWindowGenerationStopReason } from "@zen-mods/sine-lifecycle/sine-window";
import {
  type ActivityState,
  IDLE_ACTIVITY,
  reduceActivity,
  type TerminalOutcome,
} from "./core/activity.ts";

export type LoadBarStopReason = SineWindowGenerationStopReason | "platform-failure";

export type BrowserProgressEvent<Browser extends object> =
  | { readonly kind: "begin"; readonly browser: Browser }
  | {
      readonly kind: "finish";
      readonly browser: Browser;
      readonly outcome: TerminalOutcome;
    };

export interface BrowserProgressSource<Browser extends object> {
  install(listener: (event: BrowserProgressEvent<Browser>) => void): () => unknown;
  currentLoadingBrowser(): Browser | null;
}

export interface ActivityView {
  render(state: ActivityState): void;
  dispose(): void;
}

export interface TerminalDelays {
  readonly success: number;
  readonly canceled: number;
  readonly "network-error": number;
}

export interface LoadBarControllerOptions<Browser extends object> {
  readonly createView: (browser: Browser) => ActivityView | null;
  readonly onError?: (error: unknown) => void;
  readonly progress: BrowserProgressSource<Browser>;
  readonly revealDelayMs: number;
  readonly terminalDelayMs: TerminalDelays;
  readonly timers: TimerPort;
}

export interface LoadBarControllerSnapshot {
  readonly activeRecords: number;
  readonly live: boolean;
  readonly pendingTimers: number;
  readonly pendingWaits: number;
  readonly started: boolean;
  readonly stopReason: LoadBarStopReason | null;
  readonly visibleRecords: number;
}

interface BrowserRecord {
  cancelReveal: (() => void) | null;
  cancelTerminal: (() => void) | null;
  state: ActivityState;
  readonly view: ActivityView;
}

export class LoadBarController<Browser extends object> {
  readonly #createView: (browser: Browser) => ActivityView | null;
  readonly #onError: (error: unknown) => void;
  readonly #progress: BrowserProgressSource<Browser>;
  readonly #records = new Map<Browser, BrowserRecord>();
  readonly #revealDelayMs: number;
  readonly #scope: GenerationScope;
  readonly #terminalDelayMs: TerminalDelays;
  #nextToken = 1;
  #started = false;
  #stopReason: LoadBarStopReason | null = null;

  constructor({
    createView,
    onError,
    progress,
    revealDelayMs,
    terminalDelayMs,
    timers,
  }: LoadBarControllerOptions<Browser>) {
    this.#createView = createView;
    this.#onError = error => {
      try {
        onError?.(error);
      } catch {}
    };
    this.#progress = progress;
    this.#revealDelayMs = revealDelayMs;
    this.#terminalDelayMs = terminalDelayMs;
    this.#scope = new GenerationScope({
      onDisposeError: this.#onError,
      timers,
    });
    this.#scope.defer(() => this.#disposeAllRecords());
  }

  get stopReason(): LoadBarStopReason | null {
    return this.#stopReason;
  }

  defer(disposer: () => unknown): void {
    this.#scope.defer(disposer);
  }

  isLive(): boolean {
    return this.#scope.isLive();
  }

  snapshot(): LoadBarControllerSnapshot {
    return {
      activeRecords: this.#records.size,
      live: this.isLive(),
      pendingTimers: this.#scope.pendingTimers,
      pendingWaits: this.#scope.pendingWaits,
      started: this.#started,
      stopReason: this.#stopReason,
      visibleRecords: [...this.#records.values()].filter(
        record => record.state.kind !== "waiting",
      ).length,
    };
  }

  start(): boolean {
    if (this.#started || !this.isLive()) {
      return false;
    }
    this.#started = true;
    const disposeProgress = this.#progress.install(event => this.#receive(event));
    this.#scope.defer(disposeProgress);
    const current = this.#progress.currentLoadingBrowser();
    if (current) {
      this.#receive({ kind: "begin", browser: current });
      if (!this.isLive()) {
        throw new Error("Load Bar platform startup failed");
      }
    }
    return true;
  }

  stop(reason: LoadBarStopReason = "manual"): boolean {
    if (!this.isLive()) {
      return false;
    }
    this.#stopReason = reason;
    return this.#scope.stop();
  }

  #begin(browser: Browser): void {
    let record = this.#records.get(browser);
    if (record?.state.kind === "waiting" || record?.state.kind === "visible") {
      return;
    }
    if (!record) {
      const view = this.#createView(browser);
      if (!view) {
        return;
      }
      record = {
        cancelReveal: null,
        cancelTerminal: null,
        state: IDLE_ACTIVITY,
        view,
      };
      this.#records.set(browser, record);
    }
    this.#cancelTimers(record);
    const token = this.#nextToken++;
    record.state = reduceActivity(record.state, { kind: "begin", token });
    record.view.render(record.state);
    record.cancelReveal = this.#scope.schedule(this.#revealDelayMs, () => {
      record.cancelReveal = null;
      const next = reduceActivity(record.state, { kind: "reveal", token });
      if (next !== record.state) {
        record.state = next;
        record.view.render(next);
      }
    });
  }

  #cancelTimers(record: BrowserRecord): void {
    for (const key of ["cancelReveal", "cancelTerminal"] as const) {
      const cancel = record[key];
      record[key] = null;
      if (!cancel) {
        continue;
      }
      try {
        cancel();
      } catch (error) {
        this.#onError(error);
      }
    }
  }

  #disposeAllRecords(): void {
    for (const browser of [...this.#records.keys()]) {
      this.#disposeRecord(browser);
    }
  }

  #disposeRecord(browser: Browser): void {
    const record = this.#records.get(browser);
    if (!record) {
      return;
    }
    this.#records.delete(browser);
    this.#cancelTimers(record);
    try {
      record.view.dispose();
    } catch (error) {
      this.#onError(error);
    }
  }

  #finish(browser: Browser, outcome: TerminalOutcome): void {
    const record = this.#records.get(browser);
    if (!record) {
      return;
    }
    if (record.cancelReveal) {
      const cancel = record.cancelReveal;
      record.cancelReveal = null;
      cancel();
    }
    if (record.state.kind === "idle") {
      this.#disposeRecord(browser);
      return;
    }
    const token = record.state.token;
    const next = reduceActivity(record.state, { kind: "finish", token, outcome });
    if (next === record.state) {
      return;
    }
    record.state = next;
    if (next.kind === "idle") {
      this.#disposeRecord(browser);
      return;
    }
    record.view.render(next);
    record.cancelTerminal = this.#scope.schedule(this.#terminalDelayMs[outcome], () => {
      record.cancelTerminal = null;
      const settled = reduceActivity(record.state, { kind: "settle", token });
      if (settled.kind === "idle") {
        this.#disposeRecord(browser);
      }
    });
  }

  #receive(event: BrowserProgressEvent<Browser>): void {
    if (!this.isLive()) {
      return;
    }
    try {
      if (event.kind === "begin") {
        this.#begin(event.browser);
      } else {
        this.#finish(event.browser, event.outcome);
      }
    } catch (error) {
      this.#onError(error);
      this.stop("platform-failure");
    }
  }
}
