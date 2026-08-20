/**
 * Application-global browser-work ownership. This module is pure: the generated
 * system-module entry supplies the privileged preference adapter, while tests supply
 * deterministic delegates.
 */

import type {
  ApplicationOwnerOptions,
  ApplicationOwnerSnapshot,
  ApplicationPreferencesPort,
} from "./application-owner-contracts.ts";
import {
  APPLICATION_COORDINATOR_PROTOCOL,
  type ApplicationDisposeReason,
  type ApplicationRegistration,
  type WakeCandidate,
  type WakeTransactionOptions,
  type WindowWorkDelegate,
  type WorkContext,
  type WorkReceipt,
  type WorkResult,
} from "./application-protocol.ts";
import {
  type ActiveInvocation,
  type ActiveRecord,
  createReceipt,
  type KeyRecord,
  PULSE_KEY,
  type PulseRequest,
  type RecoveryRequest,
  type RegistrationRecord,
  SWEEP_KEY,
  type SweepRequest,
  type WorkRequest,
} from "./application-state.ts";
import { ApplicationWakeOwner } from "./application-wake.ts";
import { type PulseSchedule, SerialPulseScheduler } from "./core/pulse-scheduler.ts";
import { RecoveryAttemptLedger } from "./core/recovery-ledger.ts";
import type { StatusWidgetHost, StatusWidgetLease } from "./status-widget-contracts.ts";
import { StatusWidgetLeases } from "./status-widget-leases.ts";

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
  readonly #pulseScheduler: SerialPulseScheduler;
  readonly #wake: ApplicationWakeOwner<Tab, Evidence>;
  #active: ActiveRecord<Tab, Evidence> | null = null;
  #desiredOnDemand: boolean | null = null;
  #nextRegistration = 1;
  readonly #statusWidget = new StatusWidgetLeases<RegistrationRecord<Tab, Evidence>>({
    isCurrent: record => this.#isRegistrationCurrent(record),
    isOwned: record => this.#isRegistrationOwned(record),
    onError: error => this.#reportError(error),
  });

  constructor({
    applicationId,
    preferences,
    reportError,
    timers,
  }: ApplicationOwnerOptions) {
    this.#applicationId = applicationId;
    this.#preferences = preferences;
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
    this.#wake = new ApplicationWakeOwner<Tab, Evidence>({
      onComplete: (record, result) => this.#complete(record, result),
      onDelegateError: (record, error) => this.#reportDelegateError(record, error),
      onError: error => this.#reportError(error),
      preferences,
      readDesiredOnDemand: () => this.#desiredOnDemand,
      timers,
    });
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
      acquireStatusWidget: (host: StatusWidgetHost): StatusWidgetLease =>
        this.#statusWidget.acquire(record, host),
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
      hasRecoveryAttempts: () =>
        this.#isRegistrationCurrent(record) && this.#recoveryAttempts.hasAttempts,
      resetRecoveryAttempts: () => this.#resetRecoveryAttempts(record),
      cancelRecovery: (tab: Tab) => this.#cancelRecovery(record, tab),
      invalidateTab: (tab: Tab) => this.#invalidateTab(record, tab),
      reconcileOnDemand: (value: boolean) => this.#reconcileOnDemand(record, value),
      isApplicationBusy: () => this.#active !== null,
      dispose: (reason: ApplicationDisposeReason = "generation-ended") =>
        this.#disposeRegistration(record, reason),
    });
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
    const attempts = Object.freeze(this.#recoveryAttempts.charge(tab, at, windowMs));
    this.#refreshStatusPanels();
    return attempts;
  }

  #resetRecoveryAttempts(registration: RegistrationRecord<Tab, Evidence>): boolean {
    if (!this.#isRegistrationCurrent(registration)) {
      return false;
    }
    if (this.#recoveryAttempts.reset() === 0) {
      return false;
    }
    this.#refreshStatusPanels();
    return true;
  }

  #refreshStatusPanels(): void {
    for (const record of this.#registrations.values()) {
      if (!this.#isRegistrationCurrent(record)) {
        continue;
      }
      try {
        record.delegate.refreshStatusPanel?.();
      } catch (error) {
        this.#reportError(error);
      }
    }
  }

  snapshot(): ApplicationOwnerSnapshot {
    let readyCount = 0;
    let sweepRecords = 0;
    let trailingCount = 0;
    const statusWidget = this.#statusWidget.snapshot();
    const wake = this.#wake.snapshot();
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
      recoveryAttempts: this.#recoveryAttempts.attemptCount,
      registrationCount: this.#registrations.size,
      registrationIds: Object.freeze(
        [...this.#registrations.values()].map(record => record.id),
      ),
      statusWidgetLeaseIds: statusWidget.leaseIds,
      statusWidgetLeases: statusWidget.leases,
      statusWidgetPhase: statusWidget.phase,
      sweepRecords,
      trailingCount,
      desiredOnDemand: this.#desiredOnDemand,
      wakeAttempt: wake.attempt,
      wakeCandidates: wake.candidates,
      wakeRetryScheduled: wake.retryScheduled,
      wakePhase: wake.phase,
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
    const wasCandidate = this.#wake.invalidateCandidate(tab);
    // A pulse is application-wide, while invalidation names one tab. The window
    // delegate releases that tab's local claim immediately and revalidates every
    // later candidate. Canceling the whole pulse here aborts an unrelated held tab
    // and can also discard the scheduler's remaining participant work.
    return this.#cancelRecovery(registration, tab) || wasCandidate;
  }

  #reconcileOnDemand(
    registration: RegistrationRecord<Tab, Evidence>,
    value: boolean,
  ): boolean {
    if (!this.#isRegistrationCurrent(registration)) {
      return false;
    }
    this.#desiredOnDemand = value;
    if (this.#wake.isActive()) {
      return true;
    }
    return this.#wake.writeDesiredPreference(value);
  }

  #disposeRegistration(
    record: RegistrationRecord<Tab, Evidence>,
    reason: ApplicationDisposeReason,
  ): boolean {
    if (!this.#isRegistrationOwned(record)) {
      return false;
    }
    // Fence public work requests before an adapter can synchronously reenter during
    // final widget destruction. The exact record remains available to the private
    // cleanup below, but it is no longer a live application participant.
    record.active = false;
    this.#registrations.delete(record.token);
    // A caller normally releases its panel lease from the generation disposer
    // before this registration reaches us. Keep the owner fail-safe for startup
    // failures and direct disposal too: the last live registration still owns the
    // application widget edge even when its window adapter was not reached.
    this.#statusWidget.release(record);

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
    this.#wake.cancel(invocation, reason);
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
        return this.#wake.begin(record, invocation, candidates, options);
      },
    });
  }

  #complete(record: ActiveRecord<Tab, Evidence>, result: WorkResult): void {
    if (this.#active !== record) {
      return;
    }
    if (this.#wake.holdsOperation(record)) {
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
