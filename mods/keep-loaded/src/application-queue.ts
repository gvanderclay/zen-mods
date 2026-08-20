/** Owns every keyed sweep, pulse, and recovery record from request through completion. */

import type {
  ApplicationDisposeReason,
  WakeCandidate,
  WakeTransactionOptions,
  WorkContext,
  WorkReceipt,
  WorkResult,
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
import type { ApplicationWakeOwner } from "./application-wake.ts";

const canceledReceipt = (): WorkReceipt => {
  const receipt = createReceipt();
  receipt.settle("canceled");
  return receipt.public;
};

/** The coordinator supplies registration facts and callbacks, never queue writes. */
interface KeyedWorkPorts<Tab extends object, Evidence> {
  isRegistrationCurrent(record: RegistrationRecord<Tab, Evidence>): boolean;
  onDelegateError(record: RegistrationRecord<Tab, Evidence>, error: unknown): void;
  participants(): readonly RegistrationRecord<Tab, Evidence>[];
  readOnDemand(): boolean;
  reconcileOnDemand(record: RegistrationRecord<Tab, Evidence>, value: boolean): void;
  readonly wake: ApplicationWakeOwner<Tab, Evidence>;
}

interface KeyedWorkSnapshot {
  readonly activeCount: number;
  readonly activeKind: WorkRequest<never, never>["kind"] | null;
  readonly drainingCount: number;
  readonly keyRecords: number;
  readonly readyCount: number;
  readonly sweepRecords: number;
  readonly trailingCount: number;
}

export class KeyedWorkQueue<Tab extends object, Evidence> {
  readonly #ports: KeyedWorkPorts<Tab, Evidence>;
  readonly #records = new Map<
    typeof SWEEP_KEY | typeof PULSE_KEY | Tab,
    KeyRecord<Tab, Evidence>
  >();
  #active: ActiveRecord<Tab, Evidence> | null = null;

  constructor(ports: KeyedWorkPorts<Tab, Evidence>) {
    this.#ports = ports;
  }

  isBusy(): boolean {
    return this.#active !== null;
  }

  /** Finishes the active record whose wake transaction just released it. */
  releaseWakeHold(operationToken: object): void {
    const active = this.#active;
    if (active?.operationToken !== operationToken) {
      return;
    }
    const pendingResult = active.pendingResult;
    if (!pendingResult) {
      return;
    }
    active.pendingResult = null;
    this.#complete(active, pendingResult);
  }

  /** Cancels an in-flight pulse when its schedule is turned off. */
  cancelActivePulse(reason: ApplicationDisposeReason = "generation-ended"): void {
    if (this.#active?.request.kind === "pulse") {
      this.#cancelActive(this.#active, undefined, reason);
    }
  }

  /** Drops the application-wide sweep and pulse keys once no registration remains. */
  dropApplicationWork(reason: ApplicationDisposeReason): void {
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

  /** Drops one registration's keyed work, promoting an eligible trailing successor. */
  dropRegistrationWork(
    registration: RegistrationRecord<Tab, Evidence>,
    reason: ApplicationDisposeReason,
  ): void {
    for (const [key, queued] of [...this.#records]) {
      if (key === SWEEP_KEY || key === PULSE_KEY) {
        continue;
      }
      if (queued.state === "queued") {
        if (
          queued.request.kind === "recovery" &&
          queued.request.registration === registration
        ) {
          this.#records.delete(key);
          queued.request.receipt.settle("canceled");
        }
        continue;
      }
      if (
        queued.request.kind === "recovery" &&
        queued.request.registration === registration
      ) {
        const successor = this.#cancelActive(
          queued,
          request => request.kind === "recovery" && request.registration !== registration,
          reason,
        );
        if (successor) {
          this.#records.set(key, { request: successor, state: "queued" });
        }
      }
      if (
        queued.trailing?.kind === "recovery" &&
        queued.trailing.registration === registration
      ) {
        queued.trailing.receipt.settle("canceled");
        queued.trailing = null;
      }
    }

    const active = this.#active;
    if (active?.invocation?.registration === registration) {
      this.#cancelInvocation(active, active.invocation, reason);
    }
  }

  snapshot(): KeyedWorkSnapshot {
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
    return {
      activeCount: this.#active ? 1 : 0,
      activeKind: this.#active?.request.kind ?? null,
      drainingCount: this.#active?.draining ? 1 : 0,
      keyRecords: this.#records.size,
      readyCount,
      sweepRecords,
      trailingCount,
    };
  }

  requestSweep(record: RegistrationRecord<Tab, Evidence>): WorkReceipt {
    if (!this.#ports.isRegistrationCurrent(record)) {
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

  requestPulse(record: RegistrationRecord<Tab, Evidence>): WorkReceipt {
    if (!this.#ports.isRegistrationCurrent(record)) {
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

  requestRecovery(
    registration: RegistrationRecord<Tab, Evidence>,
    tab: Tab,
    evidence: Evidence,
  ): WorkReceipt {
    if (!this.#ports.isRegistrationCurrent(registration)) {
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

  cancelRecovery(registration: RegistrationRecord<Tab, Evidence>, tab: Tab): boolean {
    if (!this.#ports.isRegistrationCurrent(registration)) {
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
    this.#ports.wake.cancel(invocation, reason);
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
    const participants = this.#ports.participants();
    for (const participant of participants) {
      if (record.canceled) {
        break;
      }
      if (
        !this.#ports.isRegistrationCurrent(participant) ||
        !participant.delegate.pulse
      ) {
        continue;
      }
      const invocation = this.#beginInvocation(record, participant);
      const context = this.#contextFor(record, invocation);
      try {
        await participant.delegate.pulse(context);
      } catch (error) {
        record.failed = true;
        this.#ports.onDelegateError(participant, error);
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
    if (record.canceled || !this.#ports.isRegistrationCurrent(request.registration)) {
      return "canceled";
    }
    const invocation = this.#beginInvocation(record, request.registration);
    const context = this.#contextFor(record, invocation);
    try {
      await request.registration.delegate.recover(context, request.tab, request.evidence);
    } catch (error) {
      record.failed = true;
      this.#ports.onDelegateError(request.registration, error);
    } finally {
      this.#finishInvocation(record, invocation);
    }
    if (record.canceled || !this.#ports.isRegistrationCurrent(request.registration)) {
      return "canceled";
    }
    return record.failed ? "failed" : "completed";
  }

  async #executeSweep(record: ActiveRecord<Tab, Evidence>): Promise<WorkResult> {
    const participants = this.#ports.participants();
    for (const participant of participants) {
      if (record.canceled) {
        break;
      }
      if (!this.#ports.isRegistrationCurrent(participant)) {
        continue;
      }
      const invocation = this.#beginInvocation(record, participant);
      const context = this.#contextFor(record, invocation);
      try {
        await participant.delegate.sweep(context);
      } catch (error) {
        record.failed = true;
        this.#ports.onDelegateError(participant, error);
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
      this.#ports.isRegistrationCurrent(invocation.registration);

    return Object.freeze({
      signal: invocation.abort.signal,
      isCurrent,
      readOnDemand: () => this.#ports.readOnDemand(),
      reconcileOnDemand: (value: boolean) => {
        if (!isCurrent()) {
          return;
        }
        this.#ports.reconcileOnDemand(invocation.registration, value);
      },
      wakeCandidates: (
        candidates: readonly WakeCandidate[],
        options: WakeTransactionOptions,
      ) => {
        if (!isCurrent()) {
          return Promise.resolve("canceled" as const);
        }
        return this.#ports.wake.begin(
          record.operationToken,
          invocation,
          candidates,
          options,
        );
      },
    });
  }

  #complete(record: ActiveRecord<Tab, Evidence>, result: WorkResult): void {
    if (this.#active !== record) {
      return;
    }
    if (this.#ports.wake.holdsOperation(record.operationToken)) {
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
}
