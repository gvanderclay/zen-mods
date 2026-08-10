/**
 * Application-global browser-work ownership. This module is pure: the generated
 * system-module entry supplies the privileged preference adapter, while tests supply
 * deterministic delegates.
 */

import { type PulseSchedule, SerialPulseScheduler } from "./core/pulse-scheduler.ts";
import { RecoveryAttemptLedger } from "./core/recovery-ledger.ts";

/**
 * Bump whenever the stable system-module owner's runtime contract or implementation
 * changes. Sine caches that URI for the Zen process while window bundles hot-reload;
 * a mismatch must stop the new window generation and require a restart.
 */
export const APPLICATION_COORDINATOR_PROTOCOL = 6 as const;

export type WorkResult = "canceled" | "completed" | "failed";

export interface WorkReceipt {
  readonly done: Promise<WorkResult>;
}

export interface ApplicationPreferencesPort {
  readOnDemand(): boolean;
  writeOnDemand(value: boolean): void;
}

export interface ApplicationTimerPort {
  clearTimeout(handle: unknown): void;
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
}

export type WakeCandidateState = "gone" | "inserted-pending" | "lazy" | "started";

export interface WakeCandidate {
  readonly key: object;
  insert(): void;
  rollback(): boolean;
  state(): WakeCandidateState;
}

export interface WakeTransactionOptions {
  readonly pollMs: number;
  readonly retryLimit: number;
  readonly timeoutMs: number;
}

export type ApplicationDisposeReason = "generation-ended" | "window-closed";

export interface WorkContext {
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  readOnDemand(): boolean;
  reconcileOnDemand(value: boolean): void;
  wakeCandidates(
    candidates: readonly WakeCandidate[],
    options: WakeTransactionOptions,
  ): Promise<WorkResult>;
}

export interface WindowWorkDelegate<Tab extends object, Evidence> {
  isLive(): boolean;
  sweep(context: WorkContext): Promise<void> | void;
  pulse?(context: WorkContext): Promise<void> | void;
  recover(context: WorkContext, tab: Tab, evidence: Evidence): Promise<void> | void;
  reportError(error: unknown): void;
}

export interface ApplicationRegistration<Tab extends object, Evidence> {
  readonly id: string;
  acquireStatusWidget(host: StatusWidgetHost): StatusWidgetLease;
  requestSweep(): WorkReceipt;
  requestPulse(): WorkReceipt;
  setPulseSchedule(schedule: PulseSchedule): void;
  requestRecovery(tab: Tab, evidence: Evidence): WorkReceipt;
  /** The stable, Keep Loaded-only crash budget for this exact tab identity. */
  recentRecoveryAttempts(tab: Tab, now: number, windowMs: number): readonly number[];
  chargeRecoveryAttempt(
    tab: Tab,
    at: number,
    windowMs: number,
  ): readonly number[] | false;
  cancelRecovery(tab: Tab): boolean;
  invalidateTab(tab: Tab): boolean;
  reconcileOnDemand(value: boolean): boolean;
  isApplicationBusy(): boolean;
  dispose(reason?: ApplicationDisposeReason): boolean;
}

/**
 * A per-window adapter for the application-global status widget. The stable owner
 * decides whether this window is first/last; the adapter is only invoked on those
 * edges. Keeping the callbacks on live registration records lets the owner re-home
 * destruction when the window that created the widget closes first.
 */
export interface StatusWidgetHost {
  create(): void;
  destroy(): void;
}

export interface StatusWidgetLease {
  release(): boolean;
}

export interface ApplicationOwnerSnapshot {
  readonly activeCount: number;
  readonly activeKind: "pulse" | "recovery" | "sweep" | null;
  readonly applicationId: string;
  readonly drainingCount: number;
  readonly keyRecords: number;
  readonly protocol: number;
  readonly readyCount: number;
  readonly registrationCount: number;
  readonly registrationIds: readonly string[];
  readonly sweepRecords: number;
  readonly trailingCount: number;
  readonly desiredOnDemand: boolean | null;
  readonly wakeAttempt: number | null;
  readonly wakeCandidates: number;
  readonly wakePhase:
    | "acquiring"
    | "blocked"
    | "idle"
    | "inserting"
    | "restoring-preference"
    | "retrying"
    | "rolling-back"
    | "waiting";
}

export interface ApplicationOwnerOptions {
  applicationId: string;
  preferences: ApplicationPreferencesPort;
  reportError?: (error: unknown) => unknown;
  timers: ApplicationTimerPort;
}

export interface ApplicationOwnerApi<Tab extends object, Evidence> {
  register(
    delegate: WindowWorkDelegate<Tab, Evidence>,
  ): ApplicationRegistration<Tab, Evidence>;
  snapshot(): ApplicationOwnerSnapshot;
}

interface DeferredReceipt {
  readonly public: WorkReceipt;
  readonly promise: Promise<WorkResult>;
  readonly settle: (result: WorkResult) => void;
  readonly settled: () => boolean;
}

interface RegistrationRecord<Tab extends object, Evidence> {
  active: boolean;
  readonly delegate: WindowWorkDelegate<Tab, Evidence>;
  readonly id: string;
  readonly token: object;
}

interface SweepRequest {
  readonly kind: "sweep";
  readonly receipt: DeferredReceipt;
}

interface PulseRequest {
  readonly kind: "pulse";
  readonly receipt: DeferredReceipt;
}

interface RecoveryRequest<Tab extends object, Evidence> {
  evidence: Evidence;
  readonly kind: "recovery";
  readonly receipt: DeferredReceipt;
  registration: RegistrationRecord<Tab, Evidence>;
  readonly tab: Tab;
}

type WorkRequest<Tab extends object, Evidence> =
  | RecoveryRequest<Tab, Evidence>
  | PulseRequest
  | SweepRequest;

interface QueuedRecord<Tab extends object, Evidence> {
  request: WorkRequest<Tab, Evidence>;
  readonly state: "queued";
}

interface ActiveInvocation<Tab extends object, Evidence> {
  readonly abort: AbortController;
  readonly registration: RegistrationRecord<Tab, Evidence>;
  readonly token: object;
}

interface ActiveRecord<Tab extends object, Evidence> {
  canceled: boolean;
  detached: boolean;
  draining: boolean;
  failed: boolean;
  invocation: ActiveInvocation<Tab, Evidence> | null;
  readonly key: typeof SWEEP_KEY | typeof PULSE_KEY | Tab;
  readonly operationToken: object;
  readonly request: WorkRequest<Tab, Evidence>;
  readonly state: "active";
  pendingResult: WorkResult | null;
  trailing: WorkRequest<Tab, Evidence> | null;
}

type KeyRecord<Tab extends object, Evidence> =
  | ActiveRecord<Tab, Evidence>
  | QueuedRecord<Tab, Evidence>;

type WakePhase =
  | Readonly<{ kind: "acquiring" }>
  | Readonly<{
      kind: "blocked";
      resume: "restoring-preference" | "rolling-back";
    }>
  | Readonly<{ kind: "inserting" }>
  | Readonly<{ kind: "restoring-preference" }>
  | Readonly<{ kind: "retrying" }>
  | Readonly<{ kind: "rolling-back" }>
  | Readonly<{ kind: "waiting" }>;

interface OwnedWakeCandidate {
  readonly candidate: WakeCandidate;
  invalidated: boolean;
}

interface WakeTimer {
  handle: unknown;
  readonly token: object;
}

interface WakeTransaction<Tab extends object, Evidence> {
  advancing: boolean;
  attempt: number;
  attemptFailed: boolean;
  canceled: boolean;
  closed: boolean;
  deadline: number;
  failed: boolean;
  needsAdvance: boolean;
  readonly invocation: ActiveInvocation<Tab, Evidence>;
  readonly operation: ActiveRecord<Tab, Evidence>;
  readonly options: WakeTransactionOptions;
  readonly original: boolean;
  readonly owned: Map<object, OwnedWakeCandidate>;
  phase: WakePhase;
  readonly receipt: DeferredReceipt;
  readonly remaining: Map<object, WakeCandidate>;
  timer: WakeTimer | null;
}

const SWEEP_KEY = Symbol("keep-loaded-sweep");
const PULSE_KEY = Symbol("keep-loaded-pulse");

const createReceipt = (): DeferredReceipt => {
  let resolve!: (result: WorkResult) => void;
  let didSettle = false;
  const promise = new Promise<WorkResult>(onResolve => {
    resolve = onResolve;
  });
  return {
    promise,
    public: Object.freeze({ done: promise }),
    settle: result => {
      if (!didSettle) {
        didSettle = true;
        resolve(result);
      }
    },
    settled: () => didSettle,
  };
};

const canceledReceipt = (): WorkReceipt => {
  const receipt = createReceipt();
  receipt.settle("canceled");
  return receipt.public;
};

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  "then" in value &&
  typeof value.then === "function";

/**
 * One fair keyed queue for every live Keep Loaded browser window in this process.
 * Semantic methods deliberately hide the Map: callers can request only the single
 * sweep key or one recovery key per exact tab identity.
 */
export class KeepLoadedApplicationOwner<Tab extends object, Evidence> {
  readonly #applicationId: string;
  readonly #preferences: ApplicationPreferencesPort;
  readonly #records = new Map<
    typeof SWEEP_KEY | typeof PULSE_KEY | Tab,
    KeyRecord<Tab, Evidence>
  >();
  readonly #registrations = new Map<object, RegistrationRecord<Tab, Evidence>>();
  readonly #reportError: (error: unknown) => void;
  readonly #recoveryAttempts = new RecoveryAttemptLedger<Tab>();
  readonly #timers: ApplicationTimerPort;
  readonly #pulseScheduler: SerialPulseScheduler;
  #active: ActiveRecord<Tab, Evidence> | null = null;
  #desiredOnDemand: boolean | null = null;
  #nextRegistration = 1;
  readonly #statusWidgetHosts = new Map<
    RegistrationRecord<Tab, Evidence>,
    StatusWidgetHost
  >();
  #wakeTransaction: WakeTransaction<Tab, Evidence> | null = null;

  constructor({
    applicationId,
    preferences,
    reportError,
    timers,
  }: ApplicationOwnerOptions) {
    this.#applicationId = applicationId;
    this.#preferences = preferences;
    this.#timers = timers;
    this.#reportError = error => {
      try {
        const result = reportError?.(error);
        if (isThenable(result)) {
          void Promise.resolve(result).catch(() => {});
        }
      } catch {
        // Diagnostics cannot be allowed to wedge the owner they describe.
      }
    };
    this.#pulseScheduler = new SerialPulseScheduler({
      now: timers.now,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      onDue: () => this.#pulseDue(),
      onError: error => this.#reportError(error),
    });
  }

  register(
    delegate: WindowWorkDelegate<Tab, Evidence>,
  ): ApplicationRegistration<Tab, Evidence> {
    const record: RegistrationRecord<Tab, Evidence> = {
      active: true,
      delegate,
      id: `window-${this.#nextRegistration++}`,
      token: Object.freeze({}),
    };
    this.#registrations.set(record.token, record);

    return Object.freeze({
      id: record.id,
      acquireStatusWidget: (host: StatusWidgetHost) =>
        this.#acquireStatusWidget(record, host),
      requestSweep: () => this.#requestSweep(record),
      requestPulse: () => this.#requestPulse(record),
      setPulseSchedule: (schedule: PulseSchedule) =>
        this.#setPulseSchedule(record, schedule),
      requestRecovery: (tab: Tab, evidence: Evidence) =>
        this.#requestRecovery(record, tab, evidence),
      recentRecoveryAttempts: (tab: Tab, now: number, windowMs: number) =>
        this.#recentRecoveryAttempts(record, tab, now, windowMs),
      chargeRecoveryAttempt: (tab: Tab, at: number, windowMs: number) =>
        this.#chargeRecoveryAttempt(record, tab, at, windowMs),
      cancelRecovery: (tab: Tab) => this.#cancelRecovery(record, tab),
      invalidateTab: (tab: Tab) => this.#invalidateTab(record, tab),
      reconcileOnDemand: (value: boolean) => this.#reconcileOnDemand(record, value),
      isApplicationBusy: () => this.#active !== null,
      dispose: (reason: ApplicationDisposeReason = "generation-ended") =>
        this.#disposeRegistration(record, reason),
    });
  }

  #acquireStatusWidget(
    registration: RegistrationRecord<Tab, Evidence>,
    host: StatusWidgetHost,
  ): StatusWidgetLease {
    if (!this.#isRegistrationOwned(registration)) {
      return Object.freeze({ release: () => false });
    }
    if (this.#statusWidgetHosts.has(registration)) {
      throw new TypeError("a registration can own only one status widget lease");
    }

    // Record ownership before the edge callback. If create() throws after touching
    // CustomizableUI, the catch path can still remove the partial widget without
    // leaving the application owner believing a live window owns it.
    this.#statusWidgetHosts.set(registration, host);
    try {
      if (this.#statusWidgetHosts.size === 1) {
        host.create();
      }
    } catch (error) {
      this.#statusWidgetHosts.delete(registration);
      try {
        host.destroy();
      } catch (destroyError) {
        this.#reportError(destroyError);
      }
      throw error;
    }

    let released = false;
    return Object.freeze({
      release: () => {
        if (released) {
          return false;
        }
        released = true;
        return this.#releaseStatusWidget(registration);
      },
    });
  }

  #releaseStatusWidget(registration: RegistrationRecord<Tab, Evidence>): boolean {
    const host = this.#statusWidgetHosts.get(registration);
    if (!host) {
      return false;
    }
    this.#statusWidgetHosts.delete(registration);
    if (this.#statusWidgetHosts.size === 0) {
      try {
        host.destroy();
      } catch (error) {
        this.#reportError(error);
      }
    }
    return true;
  }

  #recentRecoveryAttempts(
    registration: RegistrationRecord<Tab, Evidence>,
    tab: Tab,
    now: number,
    windowMs: number,
  ): readonly number[] {
    if (!this.#isRegistrationCurrent(registration)) {
      return [];
    }
    return Object.freeze(this.#recoveryAttempts.recent(tab, now, windowMs));
  }

  #chargeRecoveryAttempt(
    registration: RegistrationRecord<Tab, Evidence>,
    tab: Tab,
    at: number,
    windowMs: number,
  ): readonly number[] | false {
    if (!this.#isRegistrationCurrent(registration)) {
      return false;
    }
    return Object.freeze(this.#recoveryAttempts.charge(tab, at, windowMs));
  }

  snapshot(): ApplicationOwnerSnapshot {
    let readyCount = 0;
    let sweepRecords = 0;
    let trailingCount = 0;
    for (const [key, record] of this.#records) {
      if (key === SWEEP_KEY) {
        sweepRecords += 1;
      }
      if (record.state === "queued") {
        readyCount += 1;
      } else if (record.trailing) {
        trailingCount += 1;
      }
    }
    return Object.freeze({
      activeCount: this.#active ? 1 : 0,
      activeKind: this.#active?.request.kind ?? null,
      applicationId: this.#applicationId,
      drainingCount: this.#active?.draining ? 1 : 0,
      keyRecords: this.#records.size,
      protocol: APPLICATION_COORDINATOR_PROTOCOL,
      readyCount,
      registrationCount: this.#registrations.size,
      registrationIds: Object.freeze(
        [...this.#registrations.values()].map(record => record.id),
      ),
      sweepRecords,
      trailingCount,
      desiredOnDemand: this.#desiredOnDemand,
      wakeAttempt: this.#wakeTransaction?.attempt ?? null,
      wakeCandidates: this.#wakeTransaction?.owned.size ?? 0,
      wakePhase: this.#wakeTransaction?.phase.kind ?? "idle",
    });
  }

  #requestSweep(record: RegistrationRecord<Tab, Evidence>): WorkReceipt {
    if (!this.#isRegistrationCurrent(record)) {
      return canceledReceipt();
    }
    const existing = this.#records.get(SWEEP_KEY);
    if (!existing) {
      const request: SweepRequest = { kind: "sweep", receipt: createReceipt() };
      this.#records.set(SWEEP_KEY, { request, state: "queued" });
      this.#drain();
      return request.receipt.public;
    }
    if (existing.state === "queued") {
      return existing.request.receipt.public;
    }
    if (!existing.trailing) {
      existing.trailing = { kind: "sweep", receipt: createReceipt() };
    }
    return existing.trailing.receipt.public;
  }

  #requestPulse(record: RegistrationRecord<Tab, Evidence>): WorkReceipt {
    if (!this.#isRegistrationCurrent(record)) {
      return canceledReceipt();
    }
    const existing = this.#records.get(PULSE_KEY);
    if (!existing) {
      const request: PulseRequest = { kind: "pulse", receipt: createReceipt() };
      this.#records.set(PULSE_KEY, { request, state: "queued" });
      this.#drain();
      return request.receipt.public;
    }
    if (existing.state === "queued") {
      return existing.request.receipt.public;
    }
    if (!existing.trailing) {
      existing.trailing = { kind: "pulse", receipt: createReceipt() };
    }
    return existing.trailing.receipt.public;
  }

  #setPulseSchedule(
    record: RegistrationRecord<Tab, Evidence>,
    schedule: PulseSchedule,
  ): void {
    if (!this.#isRegistrationCurrent(record)) {
      return;
    }
    this.#pulseScheduler.set(schedule);
    if (schedule.everyMs <= 0 && this.#active?.request.kind === "pulse") {
      this.#cancelActive(this.#active, undefined, "generation-ended");
    }
  }

  #pulseDue(): void {
    const participant = [...this.#registrations.values()].find(record =>
      this.#isRegistrationCurrent(record),
    );
    if (!participant) {
      this.#pulseScheduler.set({ everyMs: 0, holdMs: 0 });
      // The timer callback marked the scheduler in-flight before asking the
      // owner to find a participant.  Complete that empty cycle explicitly;
      // otherwise a later registration would inherit a phantom in-flight
      // state and the scheduler could no longer model its first real cycle.
      this.#pulseScheduler.complete();
      return;
    }
    const receipt = this.#requestPulse(participant);
    void receipt.done.then(() => this.#pulseScheduler.complete());
  }

  #requestRecovery(
    registration: RegistrationRecord<Tab, Evidence>,
    tab: Tab,
    evidence: Evidence,
  ): WorkReceipt {
    if (!this.#isRegistrationCurrent(registration)) {
      return canceledReceipt();
    }
    const existing = this.#records.get(tab);
    if (!existing) {
      const request: RecoveryRequest<Tab, Evidence> = {
        evidence,
        kind: "recovery",
        receipt: createReceipt(),
        registration,
        tab,
      };
      this.#records.set(tab, { request, state: "queued" });
      this.#drain();
      return request.receipt.public;
    }
    if (existing.state === "queued") {
      if (existing.request.kind !== "recovery") {
        throw new TypeError("a recovery tab collided with the sweep key");
      }
      existing.request.evidence = evidence;
      existing.request.registration = registration;
      return existing.request.receipt.public;
    }
    if (!existing.trailing) {
      existing.trailing = {
        evidence,
        kind: "recovery",
        receipt: createReceipt(),
        registration,
        tab,
      };
    } else {
      if (existing.trailing.kind !== "recovery") {
        throw new TypeError("a recovery tab collided with the sweep key");
      }
      existing.trailing.evidence = evidence;
      existing.trailing.registration = registration;
    }
    return existing.trailing.receipt.public;
  }

  #cancelRecovery(registration: RegistrationRecord<Tab, Evidence>, tab: Tab): boolean {
    if (!this.#isRegistrationCurrent(registration)) {
      return false;
    }
    const record = this.#records.get(tab);
    if (!record) {
      return false;
    }
    if (record.state === "queued") {
      if (record.request.kind !== "recovery") {
        throw new TypeError("a recovery tab collided with the sweep key");
      }
      this.#records.delete(tab);
      record.request.receipt.settle("canceled");
      return true;
    }
    this.#cancelActive(record);
    return true;
  }

  #invalidateTab(registration: RegistrationRecord<Tab, Evidence>, tab: Tab): boolean {
    if (!this.#isRegistrationCurrent(registration)) {
      return false;
    }
    const transaction = this.#wakeTransaction;
    const owned = transaction?.owned.get(tab);
    const wasCandidate = transaction?.remaining.has(tab) === true || !!owned;
    if (transaction && wasCandidate) {
      transaction.remaining.delete(tab);
      if (owned) {
        owned.invalidated = true;
        transaction.failed = true;
        this.#clearWakeTimer(transaction);
        transaction.phase = { kind: "rolling-back" };
        this.#advanceWake(transaction);
      }
    }
    let canceledPulse = false;
    if (this.#active?.request.kind === "pulse") {
      this.#cancelActive(this.#active, undefined, "generation-ended");
      canceledPulse = true;
    }
    return this.#cancelRecovery(registration, tab) || wasCandidate || canceledPulse;
  }

  #reconcileOnDemand(
    registration: RegistrationRecord<Tab, Evidence>,
    value: boolean,
  ): boolean {
    if (!this.#isRegistrationCurrent(registration)) {
      return false;
    }
    this.#desiredOnDemand = value;
    if (this.#wakeTransaction) {
      return true;
    }
    return this.#writeDesiredPreference(value);
  }

  #disposeRegistration(
    record: RegistrationRecord<Tab, Evidence>,
    reason: ApplicationDisposeReason,
  ): boolean {
    if (!this.#isRegistrationOwned(record)) {
      return false;
    }
    // A caller normally releases its panel lease from the generation disposer
    // before this registration reaches us. Keep the owner fail-safe for startup
    // failures and direct disposal too: the last live registration still owns the
    // application widget edge even when its window adapter was not reached.
    this.#releaseStatusWidget(record);
    record.active = false;
    this.#registrations.delete(record.token);

    for (const [key, queued] of [...this.#records]) {
      if (key === SWEEP_KEY || key === PULSE_KEY) {
        continue;
      }
      if (queued.state === "queued") {
        if (
          queued.request.kind === "recovery" &&
          queued.request.registration === record
        ) {
          this.#records.delete(key);
          queued.request.receipt.settle("canceled");
        }
        continue;
      }
      if (queued.request.kind === "recovery" && queued.request.registration === record) {
        const successor = this.#cancelActive(
          queued,
          request => request.kind === "recovery" && request.registration !== record,
          reason,
        );
        if (successor) {
          this.#records.set(key, { request: successor, state: "queued" });
        }
      }
      if (
        queued.trailing?.kind === "recovery" &&
        queued.trailing.registration === record
      ) {
        queued.trailing.receipt.settle("canceled");
        queued.trailing = null;
      }
    }

    const active = this.#active;
    if (active?.invocation?.registration === record) {
      this.#cancelInvocation(active, active.invocation, reason);
    }

    if (this.#registrations.size === 0) {
      this.#pulseScheduler.set({ everyMs: 0, holdMs: 0 });
      const sweep = this.#records.get(SWEEP_KEY);
      if (sweep?.state === "queued") {
        this.#records.delete(SWEEP_KEY);
        sweep.request.receipt.settle("canceled");
      } else if (sweep?.state === "active") {
        this.#cancelActive(sweep, undefined, reason);
      }
      const pulse = this.#records.get(PULSE_KEY);
      if (pulse?.state === "queued") {
        this.#records.delete(PULSE_KEY);
        pulse.request.receipt.settle("canceled");
      } else if (pulse?.state === "active") {
        this.#cancelActive(pulse, undefined, reason);
      }
    }
    return true;
  }

  #cancelActive(
    record: ActiveRecord<Tab, Evidence>,
    preserveTrailing?: (request: WorkRequest<Tab, Evidence>) => boolean,
    reason: ApplicationDisposeReason = "generation-ended",
  ): WorkRequest<Tab, Evidence> | null {
    record.canceled = true;
    record.draining = true;
    if (record.invocation) {
      this.#cancelInvocation(record, record.invocation, reason);
    }
    const trailing = record.trailing;
    record.trailing = null;
    const successor = trailing && preserveTrailing?.(trailing) ? trailing : null;
    if (trailing && !successor) {
      trailing.receipt.settle("canceled");
    }
    if (!record.detached && this.#records.get(record.key) === record) {
      this.#records.delete(record.key);
      record.detached = true;
    }
    return successor;
  }

  #cancelInvocation(
    record: ActiveRecord<Tab, Evidence>,
    invocation: ActiveInvocation<Tab, Evidence>,
    reason: ApplicationDisposeReason = "generation-ended",
  ): void {
    invocation.abort.abort();
    record.draining = true;
    this.#cancelWakeTransaction(invocation, reason);
  }

  #drain(): void {
    if (this.#active) {
      return;
    }
    for (const [key, record] of this.#records) {
      if (record.state !== "queued") {
        continue;
      }
      const active: ActiveRecord<Tab, Evidence> = {
        canceled: false,
        detached: false,
        draining: false,
        failed: false,
        invocation: null,
        key,
        operationToken: Object.freeze({}),
        pendingResult: null,
        request: record.request,
        state: "active",
        trailing: null,
      };
      this.#records.set(key, active);
      this.#active = active;
      void this.#execute(active).then(result => this.#complete(active, result));
      return;
    }
  }

  async #execute(record: ActiveRecord<Tab, Evidence>): Promise<WorkResult> {
    if (record.request.kind === "pulse") {
      return this.#executePulse(record);
    }
    if (record.request.kind === "recovery") {
      return this.#executeRecovery(record, record.request);
    }
    return this.#executeSweep(record);
  }

  async #executePulse(record: ActiveRecord<Tab, Evidence>): Promise<WorkResult> {
    const participants = [...this.#registrations.values()].filter(participant =>
      this.#isRegistrationCurrent(participant),
    );
    for (const participant of participants) {
      if (record.canceled) {
        break;
      }
      if (!this.#isRegistrationCurrent(participant) || !participant.delegate.pulse) {
        continue;
      }
      const invocation = this.#beginInvocation(record, participant);
      const context = this.#contextFor(record, invocation);
      try {
        await participant.delegate.pulse(context);
      } catch (error) {
        record.failed = true;
        this.#reportDelegateError(participant, error);
      } finally {
        this.#finishInvocation(record, invocation);
      }
    }
    if (record.canceled) {
      return "canceled";
    }
    return record.failed ? "failed" : "completed";
  }

  async #executeRecovery(
    record: ActiveRecord<Tab, Evidence>,
    request: RecoveryRequest<Tab, Evidence>,
  ): Promise<WorkResult> {
    if (record.canceled || !this.#isRegistrationCurrent(request.registration)) {
      return "canceled";
    }
    const invocation = this.#beginInvocation(record, request.registration);
    const context = this.#contextFor(record, invocation);
    try {
      await request.registration.delegate.recover(context, request.tab, request.evidence);
    } catch (error) {
      record.failed = true;
      this.#reportDelegateError(request.registration, error);
    } finally {
      this.#finishInvocation(record, invocation);
    }
    if (record.canceled || !this.#isRegistrationCurrent(request.registration)) {
      return "canceled";
    }
    return record.failed ? "failed" : "completed";
  }

  async #executeSweep(record: ActiveRecord<Tab, Evidence>): Promise<WorkResult> {
    const participants = [...this.#registrations.values()].filter(participant =>
      this.#isRegistrationCurrent(participant),
    );
    for (const participant of participants) {
      if (record.canceled) {
        break;
      }
      if (!this.#isRegistrationCurrent(participant)) {
        continue;
      }
      const invocation = this.#beginInvocation(record, participant);
      const context = this.#contextFor(record, invocation);
      try {
        await participant.delegate.sweep(context);
      } catch (error) {
        record.failed = true;
        this.#reportDelegateError(participant, error);
      } finally {
        this.#finishInvocation(record, invocation);
      }
    }
    if (record.canceled) {
      return "canceled";
    }
    return record.failed ? "failed" : "completed";
  }

  #beginInvocation(
    record: ActiveRecord<Tab, Evidence>,
    registration: RegistrationRecord<Tab, Evidence>,
  ): ActiveInvocation<Tab, Evidence> {
    const invocation = {
      abort: new AbortController(),
      registration,
      token: Object.freeze({}),
    };
    record.invocation = invocation;
    return invocation;
  }

  #finishInvocation(
    record: ActiveRecord<Tab, Evidence>,
    invocation: ActiveInvocation<Tab, Evidence>,
  ): void {
    if (record.invocation === invocation) {
      record.invocation = null;
      record.draining = false;
    }
  }

  #contextFor(
    record: ActiveRecord<Tab, Evidence>,
    invocation: ActiveInvocation<Tab, Evidence>,
  ): WorkContext {
    const isCurrent = () =>
      this.#active === record &&
      record.operationToken === this.#active.operationToken &&
      record.invocation === invocation &&
      !record.canceled &&
      !invocation.abort.signal.aborted &&
      this.#isRegistrationCurrent(invocation.registration);

    return Object.freeze({
      signal: invocation.abort.signal,
      isCurrent,
      readOnDemand: () => this.#desiredOnDemand ?? this.#preferences.readOnDemand(),
      reconcileOnDemand: (value: boolean) => {
        if (!isCurrent()) {
          return;
        }
        this.#reconcileOnDemand(invocation.registration, value);
      },
      wakeCandidates: (
        candidates: readonly WakeCandidate[],
        options: WakeTransactionOptions,
      ) => {
        if (!isCurrent()) {
          return Promise.resolve("canceled" as const);
        }
        return this.#beginWakeTransaction(record, invocation, candidates, options);
      },
    });
  }

  #beginWakeTransaction(
    operation: ActiveRecord<Tab, Evidence>,
    invocation: ActiveInvocation<Tab, Evidence>,
    candidates: readonly WakeCandidate[],
    options: WakeTransactionOptions,
  ): Promise<WorkResult> {
    if (this.#wakeTransaction) {
      throw new TypeError("application wake preference is already owned");
    }
    if (
      !Number.isFinite(options.pollMs) ||
      options.pollMs <= 0 ||
      !Number.isFinite(options.timeoutMs) ||
      options.timeoutMs <= 0 ||
      !Number.isSafeInteger(options.retryLimit) ||
      options.retryLimit < 0
    ) {
      throw new RangeError("wake timings and retry limit must be finite and positive");
    }

    const remaining = new Map<object, WakeCandidate>();
    let invalidCandidate = false;
    for (const candidate of candidates) {
      if (remaining.has(candidate.key)) {
        throw new TypeError("wake candidates must have unique keys");
      }
      let state: WakeCandidateState;
      try {
        state = candidate.state();
      } catch (error) {
        this.#reportDelegateError(invocation.registration, error);
        invalidCandidate = true;
        continue;
      }
      if (state === "lazy") {
        remaining.set(candidate.key, candidate);
      } else if (state === "inserted-pending") {
        this.#reportDelegateError(
          invocation.registration,
          new TypeError("refusing to claim a wake candidate inserted by another owner"),
        );
        invalidCandidate = true;
      }
    }
    if (invalidCandidate || remaining.size === 0) {
      return Promise.resolve(invalidCandidate ? "failed" : "completed");
    }

    let original: boolean;
    try {
      original = this.#preferences.readOnDemand();
    } catch (error) {
      this.#reportError(error);
      return Promise.resolve("failed");
    }
    const receipt = createReceipt();
    const transaction: WakeTransaction<Tab, Evidence> = {
      advancing: false,
      attempt: 0,
      attemptFailed: false,
      canceled: false,
      closed: false,
      deadline: 0,
      failed: false,
      invocation,
      needsAdvance: false,
      operation,
      options: Object.freeze({ ...options }),
      original,
      owned: new Map(),
      phase: { kind: "acquiring" },
      receipt,
      remaining,
      timer: null,
    };
    this.#wakeTransaction = transaction;
    this.#advanceWake(transaction);
    return receipt.promise;
  }

  #advanceWake(transaction: WakeTransaction<Tab, Evidence>): void {
    if (this.#wakeTransaction !== transaction) {
      return;
    }
    if (transaction.advancing) {
      transaction.needsAdvance = true;
      return;
    }
    transaction.advancing = true;
    try {
      for (;;) {
        transaction.needsAdvance = false;
        if (this.#wakeTransaction !== transaction) {
          return;
        }
        if (transaction.closed) {
          transaction.remaining.clear();
          transaction.owned.clear();
          transaction.phase = { kind: "restoring-preference" };
        }

        switch (transaction.phase.kind) {
          case "acquiring":
            if (!this.#ensurePreference(transaction, false)) {
              transaction.failed = true;
              this.#writeDesiredPreference(this.#desiredOnDemand ?? transaction.original);
              this.#finishWakeTransaction(transaction, "failed");
              return;
            }
            transaction.phase = { kind: "inserting" };
            continue;
          case "inserting":
            this.#insertWakeCandidates(transaction);
            continue;
          case "waiting":
            if (this.#inspectWaitingCandidates(transaction)) {
              continue;
            }
            if (!this.#scheduleWake(transaction, transaction.options.pollMs)) {
              transaction.attemptFailed = true;
              transaction.phase = { kind: "rolling-back" };
              continue;
            }
            return;
          case "rolling-back":
            if (!this.#rollbackWakeCandidates(transaction)) {
              this.#blockWake(transaction, "rolling-back");
              return;
            }
            if (
              !transaction.canceled &&
              transaction.attemptFailed &&
              transaction.attempt < transaction.options.retryLimit &&
              transaction.remaining.size > 0
            ) {
              transaction.attempt += 1;
              transaction.attemptFailed = false;
              transaction.phase = { kind: "retrying" };
              if (
                !this.#scheduleWake(transaction, transaction.options.pollMs, {
                  kind: "inserting",
                })
              ) {
                transaction.phase = { kind: "restoring-preference" };
                continue;
              }
              return;
            }
            transaction.phase = { kind: "restoring-preference" };
            continue;
          case "restoring-preference": {
            if (transaction.owned.size > 0) {
              throw new TypeError(
                "cannot restore a preference over owned wake candidates",
              );
            }
            const target = this.#desiredOnDemand ?? transaction.original;
            if (!this.#ensurePreference(transaction, target)) {
              transaction.failed = true;
              this.#blockWake(transaction, "restoring-preference");
              return;
            }
            if ((this.#desiredOnDemand ?? transaction.original) !== target) {
              continue;
            }
            this.#finishWakeTransaction(
              transaction,
              transaction.canceled
                ? "canceled"
                : transaction.failed
                  ? "failed"
                  : "completed",
            );
            return;
          }
          case "blocked":
          case "retrying":
            return;
          default:
            transaction.phase satisfies never;
        }
      }
    } finally {
      transaction.advancing = false;
      if (
        transaction.needsAdvance &&
        this.#wakeTransaction === transaction &&
        !transaction.timer
      ) {
        transaction.needsAdvance = false;
        this.#advanceWake(transaction);
      }
    }
  }

  #insertWakeCandidates(transaction: WakeTransaction<Tab, Evidence>): void {
    transaction.deadline = this.#timers.now() + transaction.options.timeoutMs;
    for (const candidate of [...transaction.remaining.values()]) {
      if (transaction.canceled || transaction.closed) {
        transaction.phase = { kind: "rolling-back" };
        return;
      }
      const before = this.#readCandidateState(transaction, candidate);
      if (before === "started" || before === "gone") {
        transaction.remaining.delete(candidate.key);
        continue;
      }
      if (before === "inserted-pending") {
        transaction.failed = true;
        transaction.attemptFailed = true;
        transaction.remaining.delete(candidate.key);
        this.#reportDelegateError(
          transaction.invocation.registration,
          new TypeError("wake candidate became owned by another insertion"),
        );
        continue;
      }
      if (before !== "lazy") {
        transaction.failed = true;
        transaction.attemptFailed = true;
        transaction.remaining.delete(candidate.key);
        continue;
      }

      const owned: OwnedWakeCandidate = {
        candidate,
        invalidated: false,
      };
      transaction.owned.set(candidate.key, owned);
      let insertionError: unknown = null;
      try {
        candidate.insert();
      } catch (error) {
        insertionError = error;
        transaction.failed = true;
        transaction.attemptFailed = true;
        this.#reportDelegateError(transaction.invocation.registration, error);
      }
      const after = this.#readCandidateState(transaction, candidate);
      if (after === "started" || after === "gone") {
        transaction.owned.delete(candidate.key);
        transaction.remaining.delete(candidate.key);
      } else if (after === "lazy") {
        transaction.owned.delete(candidate.key);
        transaction.failed = true;
        transaction.attemptFailed = true;
      }
      if (insertionError || owned.invalidated) {
        transaction.phase = { kind: "rolling-back" };
        return;
      }
    }

    if (transaction.canceled || transaction.attemptFailed) {
      transaction.phase = { kind: "rolling-back" };
    } else if (transaction.owned.size === 0) {
      transaction.phase = { kind: "restoring-preference" };
    } else {
      transaction.phase = { kind: "waiting" };
    }
  }

  #inspectWaitingCandidates(transaction: WakeTransaction<Tab, Evidence>): boolean {
    for (const [key, owned] of [...transaction.owned]) {
      const state = this.#readCandidateState(transaction, owned.candidate);
      if (state === "started" || state === "gone") {
        transaction.owned.delete(key);
        transaction.remaining.delete(key);
      } else if (state === "lazy") {
        transaction.owned.delete(key);
        transaction.failed = true;
        transaction.attemptFailed = true;
      }
    }
    if (transaction.canceled || transaction.attemptFailed) {
      transaction.phase = { kind: "rolling-back" };
      return true;
    }
    if (transaction.owned.size === 0) {
      transaction.phase = { kind: "restoring-preference" };
      return true;
    }
    if (this.#timers.now() >= transaction.deadline) {
      transaction.failed = true;
      transaction.attemptFailed = true;
      transaction.phase = { kind: "rolling-back" };
      return true;
    }
    return false;
  }

  #rollbackWakeCandidates(transaction: WakeTransaction<Tab, Evidence>): boolean {
    for (const [key, owned] of [...transaction.owned]) {
      const state = this.#readCandidateState(transaction, owned.candidate);
      if (state === "started" || state === "gone") {
        transaction.owned.delete(key);
        transaction.remaining.delete(key);
        continue;
      }
      if (state === "lazy") {
        transaction.owned.delete(key);
        continue;
      }
      if (state !== "inserted-pending") {
        continue;
      }
      try {
        const accepted = owned.candidate.rollback();
        const after = this.#readCandidateState(transaction, owned.candidate);
        if (after === "started" || after === "gone") {
          transaction.owned.delete(key);
          transaction.remaining.delete(key);
        } else if (after === "lazy") {
          transaction.owned.delete(key);
        } else if (!accepted) {
          transaction.failed = true;
        }
      } catch (error) {
        transaction.failed = true;
        this.#reportDelegateError(transaction.invocation.registration, error);
        const after = this.#readCandidateState(transaction, owned.candidate);
        if (after === "started" || after === "gone") {
          transaction.owned.delete(key);
          transaction.remaining.delete(key);
        } else if (after === "lazy") {
          transaction.owned.delete(key);
        }
      }
    }
    return transaction.owned.size === 0;
  }

  #readCandidateState(
    transaction: WakeTransaction<Tab, Evidence>,
    candidate: WakeCandidate,
  ): WakeCandidateState | null {
    try {
      return candidate.state();
    } catch (error) {
      transaction.failed = true;
      transaction.attemptFailed = true;
      this.#reportDelegateError(transaction.invocation.registration, error);
      return null;
    }
  }

  #ensurePreference(
    transaction: WakeTransaction<Tab, Evidence>,
    target: boolean,
  ): boolean {
    let current: boolean;
    try {
      current = this.#preferences.readOnDemand();
    } catch (error) {
      this.#reportError(error);
      return false;
    }
    if (current === target) {
      return true;
    }
    try {
      this.#preferences.writeOnDemand(target);
      if (this.#preferences.readOnDemand() === target) {
        return true;
      }
      this.#reportError(
        new TypeError("wake preference changed before the owner could verify its write"),
      );
      return false;
    } catch (error) {
      transaction.failed = true;
      this.#reportError(error);
      try {
        return this.#preferences.readOnDemand() === target;
      } catch (verificationError) {
        this.#reportError(verificationError);
        return false;
      }
    }
  }

  #writeDesiredPreference(target: boolean): boolean {
    try {
      if (this.#preferences.readOnDemand() === target) {
        return true;
      }
      this.#preferences.writeOnDemand(target);
      if (this.#preferences.readOnDemand() === target) {
        return true;
      }
      this.#reportError(
        new TypeError("desired wake preference changed before verification"),
      );
      return false;
    } catch (error) {
      this.#reportError(error);
      try {
        return this.#preferences.readOnDemand() === target;
      } catch (verificationError) {
        this.#reportError(verificationError);
        return false;
      }
    }
  }

  #blockWake(
    transaction: WakeTransaction<Tab, Evidence>,
    resume: "restoring-preference" | "rolling-back",
  ): void {
    transaction.phase = { kind: "blocked", resume };
    this.#scheduleWake(transaction, transaction.options.pollMs, { kind: resume });
  }

  #scheduleWake(
    transaction: WakeTransaction<Tab, Evidence>,
    delayMs: number,
    resume?: WakePhase,
  ): boolean {
    this.#clearWakeTimer(transaction);
    const token = Object.freeze({});
    const timer: WakeTimer = { handle: null, token };
    transaction.timer = timer;
    try {
      const handle = this.#timers.setTimeout(() => {
        if (this.#wakeTransaction !== transaction || transaction.timer?.token !== token) {
          return;
        }
        transaction.timer = null;
        if (resume) {
          transaction.phase = resume;
        }
        this.#advanceWake(transaction);
      }, delayMs);
      timer.handle = handle;
      if (transaction.timer !== timer) {
        try {
          this.#timers.clearTimeout(handle);
        } catch (error) {
          this.#reportError(error);
        }
      }
      return true;
    } catch (error) {
      transaction.failed = true;
      transaction.timer = null;
      this.#reportError(error);
      return false;
    }
  }

  #clearWakeTimer(transaction: WakeTransaction<Tab, Evidence>): void {
    const timer = transaction.timer;
    if (!timer) {
      return;
    }
    transaction.timer = null;
    if (timer.handle === null) {
      return;
    }
    try {
      this.#timers.clearTimeout(timer.handle);
    } catch (error) {
      this.#reportError(error);
    }
  }

  #cancelWakeTransaction(
    invocation: ActiveInvocation<Tab, Evidence>,
    reason: ApplicationDisposeReason,
  ): void {
    const transaction = this.#wakeTransaction;
    if (!transaction || transaction.invocation.token !== invocation.token) {
      return;
    }
    transaction.canceled = true;
    transaction.closed = reason === "window-closed";
    this.#clearWakeTimer(transaction);
    transaction.phase = transaction.closed
      ? { kind: "restoring-preference" }
      : { kind: "rolling-back" };
    this.#advanceWake(transaction);
  }

  #finishWakeTransaction(
    transaction: WakeTransaction<Tab, Evidence>,
    result: WorkResult,
  ): void {
    if (this.#wakeTransaction !== transaction) {
      return;
    }
    this.#clearWakeTimer(transaction);
    this.#wakeTransaction = null;
    transaction.receipt.settle(result);
    const pendingResult = transaction.operation.pendingResult;
    if (pendingResult) {
      transaction.operation.pendingResult = null;
      this.#complete(transaction.operation, pendingResult);
    }
  }

  #complete(record: ActiveRecord<Tab, Evidence>, result: WorkResult): void {
    if (this.#active !== record) {
      return;
    }
    if (this.#wakeTransaction?.operation === record) {
      record.pendingResult = result;
      return;
    }

    record.request.receipt.settle(record.canceled ? "canceled" : result);
    if (!record.detached && this.#records.get(record.key) === record) {
      this.#records.delete(record.key);
      if (record.trailing) {
        this.#records.set(record.key, { request: record.trailing, state: "queued" });
      }
    }
    this.#active = null;
    this.#drain();
  }

  #isRegistrationOwned(record: RegistrationRecord<Tab, Evidence>): boolean {
    return this.#registrations.get(record.token) === record;
  }

  #isRegistrationCurrent(record: RegistrationRecord<Tab, Evidence>): boolean {
    if (!record.active || !this.#isRegistrationOwned(record)) {
      return false;
    }
    try {
      return record.delegate.isLive();
    } catch (error) {
      this.#reportDelegateError(record, error);
      return false;
    }
  }

  #reportDelegateError(record: RegistrationRecord<Tab, Evidence>, error: unknown): void {
    try {
      const result = record.delegate.reportError(error);
      if (isThenable(result)) {
        void Promise.resolve(result).catch(this.#reportError);
      }
    } catch (reportingError) {
      this.#reportError(reportingError);
    }
  }
}
