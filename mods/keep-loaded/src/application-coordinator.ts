/**
 * Application-global browser-work ownership. This module is pure: the generated
 * system-module entry supplies the privileged preference adapter, while tests supply
 * deterministic delegates.
 */

/**
 * Bump whenever the stable system-module owner's runtime contract or implementation
 * changes. Sine caches that URI for the Zen process while window bundles hot-reload;
 * a mismatch must stop the new window generation and require a restart.
 */
export const APPLICATION_COORDINATOR_PROTOCOL = 2 as const;

export type WorkResult = "canceled" | "completed" | "failed";

export interface WorkReceipt {
  readonly done: Promise<WorkResult>;
}

export interface ApplicationPreferencesPort {
  readOnDemand(): boolean;
  writeOnDemand(value: boolean): void;
}

export interface WorkContext {
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  readOnDemand(): boolean;
  reconcileOnDemand(value: boolean): void;
  withOnDemandDisabled(work: () => Promise<void> | void): Promise<void>;
}

export interface WindowWorkDelegate<Tab extends object, Evidence> {
  isLive(): boolean;
  sweep(context: WorkContext): Promise<void> | void;
  recover(context: WorkContext, tab: Tab, evidence: Evidence): Promise<void> | void;
  reportError(error: unknown): void;
}

export interface ApplicationRegistration<Tab extends object, Evidence> {
  readonly id: string;
  requestSweep(): WorkReceipt;
  requestRecovery(tab: Tab, evidence: Evidence): WorkReceipt;
  cancelRecovery(tab: Tab): boolean;
  isApplicationBusy(): boolean;
  dispose(): boolean;
}

export interface ApplicationOwnerSnapshot {
  readonly activeCount: number;
  readonly activeKind: "recovery" | "sweep" | null;
  readonly applicationId: string;
  readonly drainingCount: number;
  readonly keyRecords: number;
  readonly protocol: number;
  readonly readyCount: number;
  readonly registrationCount: number;
  readonly registrationIds: readonly string[];
  readonly sweepRecords: number;
  readonly trailingCount: number;
}

export interface ApplicationOwnerOptions {
  applicationId: string;
  preferences: ApplicationPreferencesPort;
  reportError?: (error: unknown) => unknown;
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

interface RecoveryRequest<Tab extends object, Evidence> {
  evidence: Evidence;
  readonly kind: "recovery";
  readonly receipt: DeferredReceipt;
  registration: RegistrationRecord<Tab, Evidence>;
  readonly tab: Tab;
}

type WorkRequest<Tab extends object, Evidence> =
  | RecoveryRequest<Tab, Evidence>
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
  readonly key: typeof SWEEP_KEY | Tab;
  readonly operationToken: object;
  readonly request: WorkRequest<Tab, Evidence>;
  readonly state: "active";
  trailing: WorkRequest<Tab, Evidence> | null;
}

type KeyRecord<Tab extends object, Evidence> =
  | ActiveRecord<Tab, Evidence>
  | QueuedRecord<Tab, Evidence>;

interface RestoreLease {
  readonly invocationToken: object;
  readonly previous: boolean;
}

const SWEEP_KEY = Symbol("keep-loaded-sweep");

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
  readonly #records = new Map<typeof SWEEP_KEY | Tab, KeyRecord<Tab, Evidence>>();
  readonly #registrations = new Map<object, RegistrationRecord<Tab, Evidence>>();
  readonly #reportError: (error: unknown) => void;
  #active: ActiveRecord<Tab, Evidence> | null = null;
  #nextRegistration = 1;
  #restoreLease: RestoreLease | null = null;

  constructor({ applicationId, preferences, reportError }: ApplicationOwnerOptions) {
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
      requestSweep: () => this.#requestSweep(record),
      requestRecovery: (tab: Tab, evidence: Evidence) =>
        this.#requestRecovery(record, tab, evidence),
      cancelRecovery: (tab: Tab) => this.#cancelRecovery(record, tab),
      isApplicationBusy: () => this.#active !== null,
      dispose: () => this.#disposeRegistration(record),
    });
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

  #disposeRegistration(record: RegistrationRecord<Tab, Evidence>): boolean {
    if (!this.#isRegistrationOwned(record)) {
      return false;
    }
    record.active = false;
    this.#registrations.delete(record.token);

    for (const [key, queued] of [...this.#records]) {
      if (key === SWEEP_KEY) {
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
      this.#cancelInvocation(active, active.invocation);
    }

    if (this.#registrations.size === 0) {
      const sweep = this.#records.get(SWEEP_KEY);
      if (sweep?.state === "queued") {
        this.#records.delete(SWEEP_KEY);
        sweep.request.receipt.settle("canceled");
      } else if (sweep?.state === "active") {
        this.#cancelActive(sweep);
      }
    }
    return true;
  }

  #cancelActive(
    record: ActiveRecord<Tab, Evidence>,
    preserveTrailing?: (request: WorkRequest<Tab, Evidence>) => boolean,
  ): WorkRequest<Tab, Evidence> | null {
    record.canceled = true;
    record.draining = true;
    if (record.invocation) {
      this.#cancelInvocation(record, record.invocation);
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
  ): void {
    const lease = this.#restoreLease;
    invocation.abort.abort();
    record.draining = true;
    if (!lease || lease.invocationToken !== invocation.token) {
      return;
    }
    try {
      this.#releaseRestore(lease);
    } catch (error) {
      // Window destruction cannot await this cleanup. Retain the lease and active slot
      // so completion can retry without letting another operation overlap the pref.
      this.#reportError(error);
    }
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
    if (record.request.kind === "recovery") {
      return this.#executeRecovery(record, record.request);
    }
    return this.#executeSweep(record);
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
      readOnDemand: () => this.#preferences.readOnDemand(),
      reconcileOnDemand: (value: boolean) => {
        if (!isCurrent()) {
          return;
        }
        if (this.#restoreLease) {
          throw new TypeError("persistent reconciliation cannot run inside a wake lease");
        }
        if (this.#preferences.readOnDemand() !== value) {
          this.#preferences.writeOnDemand(value);
        }
      },
      withOnDemandDisabled: async (work: () => Promise<void> | void) => {
        if (!isCurrent()) {
          return;
        }
        if (this.#restoreLease) {
          throw new TypeError("application restore preference is already owned");
        }
        const lease: RestoreLease = {
          invocationToken: invocation.token,
          previous: this.#preferences.readOnDemand(),
        };
        this.#restoreLease = lease;
        try {
          this.#preferences.writeOnDemand(false);
          if (isCurrent()) {
            await work();
          }
        } finally {
          this.#releaseRestore(lease);
        }
      },
    });
  }

  #releaseRestore(lease: RestoreLease): void {
    if (this.#restoreLease !== lease) {
      return;
    }
    this.#preferences.writeOnDemand(lease.previous);
    this.#restoreLease = null;
  }

  #complete(record: ActiveRecord<Tab, Evidence>, result: WorkResult): void {
    if (this.#active !== record) {
      return;
    }
    if (this.#restoreLease) {
      try {
        this.#releaseRestore(this.#restoreLease);
      } catch (error) {
        // Do not release the application slot over a preference we failed to restore.
        // M12.C02 adds the explicit retry/rollback phases; C01 fails closed.
        this.#reportError(error);
        return;
      }
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
