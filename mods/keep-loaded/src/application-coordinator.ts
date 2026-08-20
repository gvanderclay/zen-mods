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
  type WindowWorkDelegate,
} from "./application-protocol.ts";
import { KeyedWorkQueue } from "./application-queue.ts";
import type { RegistrationRecord } from "./application-state.ts";
import { ApplicationWakeOwner } from "./application-wake.ts";
import { type PulseSchedule, SerialPulseScheduler } from "./core/pulse-scheduler.ts";
import { RecoveryAttemptLedger } from "./core/recovery-ledger.ts";
import type { StatusWidgetHost, StatusWidgetLease } from "./status-widget-contracts.ts";
import { StatusWidgetLeases } from "./status-widget-leases.ts";

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
  readonly #registrations = new Map<object, RegistrationRecord<Tab, Evidence>>();
  readonly #reportError: (error: unknown) => void;
  readonly #recoveryAttempts = new RecoveryAttemptLedger<Tab>();
  readonly #pulseScheduler: SerialPulseScheduler;
  readonly #wake: ApplicationWakeOwner<Tab, Evidence>;
  readonly #queue: KeyedWorkQueue<Tab, Evidence>;
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
      onRelease: operationToken => this.#queue.releaseWakeHold(operationToken),
      onDelegateError: (record, error) => this.#reportDelegateError(record, error),
      onError: error => this.#reportError(error),
      preferences,
      readDesiredOnDemand: () => this.#desiredOnDemand,
      timers,
    });
    this.#queue = new KeyedWorkQueue<Tab, Evidence>({
      isRegistrationCurrent: record => this.#isRegistrationCurrent(record),
      onDelegateError: (record, error) => this.#reportDelegateError(record, error),
      participants: () =>
        [...this.#registrations.values()].filter(participant =>
          this.#isRegistrationCurrent(participant),
        ),
      readOnDemand: () => this.#desiredOnDemand ?? this.#preferences.readOnDemand(),
      reconcileOnDemand: (record, value) => {
        this.#reconcileOnDemand(record, value);
      },
      wake: this.#wake,
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
      requestSweep: () => this.#queue.requestSweep(record),
      requestPulse: () => this.#queue.requestPulse(record),
      setPulseSchedule: (schedule: PulseSchedule) =>
        this.#setPulseSchedule(record, schedule),
      requestRecovery: (tab: Tab, evidence: Evidence) =>
        this.#queue.requestRecovery(record, tab, evidence),
      recentRecoveryAttempts: (tab: Tab, now: number, windowMs: number) =>
        this.#recentRecoveryAttempts(record, tab, now, windowMs),
      chargeRecoveryAttempt: (tab: Tab, at: number, windowMs: number) =>
        this.#chargeRecoveryAttempt(record, tab, at, windowMs),
      hasRecoveryAttempts: () =>
        this.#isRegistrationCurrent(record) && this.#recoveryAttempts.hasAttempts,
      resetRecoveryAttempts: () => this.#resetRecoveryAttempts(record),
      cancelRecovery: (tab: Tab) => this.#queue.cancelRecovery(record, tab),
      invalidateTab: (tab: Tab) => this.#invalidateTab(record, tab),
      reconcileOnDemand: (value: boolean) => this.#reconcileOnDemand(record, value),
      isApplicationBusy: () => this.#queue.isBusy(),
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
    const statusWidget = this.#statusWidget.snapshot();
    const wake = this.#wake.snapshot();
    const queue = this.#queue.snapshot();
    return Object.freeze({
      activeCount: queue.activeCount,
      activeKind: queue.activeKind,
      applicationId: this.#applicationId,
      drainingCount: queue.drainingCount,
      keyRecords: queue.keyRecords,
      protocol: APPLICATION_COORDINATOR_PROTOCOL,
      readyCount: queue.readyCount,
      recoveryAttempts: this.#recoveryAttempts.attemptCount,
      registrationCount: this.#registrations.size,
      registrationIds: Object.freeze(
        [...this.#registrations.values()].map(record => record.id),
      ),
      statusWidgetLeaseIds: statusWidget.leaseIds,
      statusWidgetLeases: statusWidget.leases,
      statusWidgetPhase: statusWidget.phase,
      sweepRecords: queue.sweepRecords,
      trailingCount: queue.trailingCount,
      desiredOnDemand: this.#desiredOnDemand,
      wakeAttempt: wake.attempt,
      wakeCandidates: wake.candidates,
      wakeRetryScheduled: wake.retryScheduled,
      wakePhase: wake.phase,
    });
  }

  #setPulseSchedule(
    record: RegistrationRecord<Tab, Evidence>,
    schedule: PulseSchedule,
  ): void {
    if (!this.#isRegistrationCurrent(record)) {
      return;
    }
    this.#pulseScheduler.set(schedule);
    if (schedule.everyMs <= 0) {
      this.#queue.cancelActivePulse();
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
    const receipt = this.#queue.requestPulse(participant);
    void receipt.done.then(() => this.#pulseScheduler.complete());
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
    return this.#queue.cancelRecovery(registration, tab) || wasCandidate;
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

    this.#queue.dropRegistrationWork(record, reason);

    if (this.#registrations.size === 0) {
      this.#pulseScheduler.set({ everyMs: 0, holdMs: 0 });
      this.#queue.dropApplicationWork(reason);
    }
    return true;
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
