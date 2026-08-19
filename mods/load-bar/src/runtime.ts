import { GenerationScope } from "@zen-mods/sine-lifecycle/generation-scope";
import type {
  ActivityView,
  BrowserProgressEvent,
  BrowserProgressSource,
  BrowserVisibilitySource,
  LoadBarControllerOptions,
  LoadBarControllerSnapshot,
  LoadBarStopReason,
  TerminalDelays,
} from "./contracts.ts";
import {
  type ActivityState,
  IDLE_ACTIVITY,
  reduceActivity,
  type TerminalOutcome,
} from "./core/activity.ts";
import type { LoadBarSettings } from "./core/settings.ts";

interface BrowserRecord {
  cancelReveal: (() => void) | null;
  cancelTerminal: (() => void) | null;
  state: ActivityState;
  view: ActivityView | null;
}

export class LoadBarController<Browser extends object> {
  readonly #createView: (browser: Browser, settings: LoadBarSettings) => ActivityView;
  readonly #isBrowserLive: (browser: Browser) => boolean;
  readonly #onError: (error: unknown) => void;
  readonly #progress: BrowserProgressSource<Browser>;
  readonly #records = new Map<Browser, BrowserRecord>();
  readonly #scope: GenerationScope;
  readonly #terminalDelayMs: TerminalDelays;
  readonly #visibility: BrowserVisibilitySource<Browser>;
  #visibleBrowsers = new Set<Browser>();
  #nextToken = 1;
  #settings: LoadBarSettings;
  #started = false;
  #stopReason: LoadBarStopReason | null = null;

  constructor({
    createView,
    isBrowserLive,
    onError,
    progress,
    settings,
    terminalDelayMs,
    timers,
    visibility,
  }: LoadBarControllerOptions<Browser>) {
    this.#createView = createView;
    this.#isBrowserLive = isBrowserLive;
    this.#onError = error => {
      try {
        onError?.(error);
      } catch {}
    };
    this.#progress = progress;
    this.#settings = settings;
    this.#terminalDelayMs = terminalDelayMs;
    this.#visibility = visibility;
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
      visibleRecords: [...this.#records.values()].filter(record => record.view).length,
    };
  }

  start(): boolean {
    if (this.#started || !this.isLive()) {
      return false;
    }
    this.#started = true;
    this.#visibleBrowsers = new Set(this.#visibility.currentBrowsers());
    const disposeVisibility = this.#visibility.install(browsers =>
      this.#receiveVisibility(browsers),
    );
    this.#scope.defer(disposeVisibility);
    const disposeProgress = this.#progress.install(event => this.#receive(event));
    this.#scope.defer(disposeProgress);
    for (const browser of this.#progress.currentLoadingBrowsers()) {
      this.#receive({ kind: "begin", browser });
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

  updateSettings(settings: LoadBarSettings): boolean {
    if (!this.isLive()) return false;
    this.#settings = settings;
    try {
      for (const record of this.#records.values()) {
        record.view?.updateSettings(settings);
      }
      return true;
    } catch (error) {
      this.#onError(error);
      this.stop("platform-failure");
      return false;
    }
  }

  #begin(browser: Browser): void {
    let record = this.#records.get(browser);
    if (record?.state.kind === "waiting" || record?.state.kind === "visible") {
      return;
    }
    if (!record) {
      record = {
        cancelReveal: null,
        cancelTerminal: null,
        state: IDLE_ACTIVITY,
        view: null,
      };
      this.#records.set(browser, record);
    }
    this.#cancelTimers(record);
    const token = this.#nextToken++;
    record.state = reduceActivity(record.state, { kind: "begin", token });
    this.#ensureView(browser, record);
    record.view?.render(record.state);
    record.cancelReveal = this.#scope.schedule(this.#settings.revealDelayMs, () => {
      record.cancelReveal = null;
      const next = reduceActivity(record.state, { kind: "reveal", token });
      if (next !== record.state) {
        record.state = next;
        record.view?.render(next);
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
    this.#disposeView(record);
  }

  #disposeView(record: BrowserRecord): void {
    const view = record.view;
    record.view = null;
    if (!view) {
      return;
    }
    try {
      view.dispose();
    } catch (error) {
      this.#onError(error);
    }
  }

  #ensureView(browser: Browser, record: BrowserRecord): void {
    if (record.view || !this.#visibleBrowsers.has(browser)) {
      return;
    }
    record.view = this.#createView(browser, this.#settings);
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
    record.view?.render(next);
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

  #receiveVisibility(browsers: readonly Browser[]): void {
    if (!this.isLive()) {
      return;
    }
    try {
      this.#visibleBrowsers = new Set(browsers);
      for (const [browser, record] of [...this.#records]) {
        if (!this.#isBrowserLive(browser)) {
          this.#disposeRecord(browser);
        } else if (this.#visibleBrowsers.has(browser)) {
          this.#ensureView(browser, record);
          record.view?.render(record.state);
        } else {
          this.#disposeView(record);
        }
      }
    } catch (error) {
      this.#onError(error);
      this.stop("platform-failure");
    }
  }
}
