// Generated from src/ by build.mjs — do not edit.

// src/application-coordinator.ts
var APPLICATION_COORDINATOR_PROTOCOL = 2;
var SWEEP_KEY = /* @__PURE__ */ Symbol("keep-loaded-sweep");
var createReceipt = () => {
  let resolve;
  let didSettle = false;
  const promise = new Promise((onResolve) => {
    resolve = onResolve;
  });
  return {
    promise,
    public: Object.freeze({ done: promise }),
    settle: (result) => {
      if (!didSettle) {
        didSettle = true;
        resolve(result);
      }
    },
    settled: () => didSettle
  };
};
var canceledReceipt = () => {
  const receipt = createReceipt();
  receipt.settle("canceled");
  return receipt.public;
};
var isThenable = (value) => (typeof value === "object" || typeof value === "function") && value !== null && "then" in value && typeof value.then === "function";
var KeepLoadedApplicationOwner = class {
  #applicationId;
  #preferences;
  #records = /* @__PURE__ */ new Map();
  #registrations = /* @__PURE__ */ new Map();
  #reportError;
  #active = null;
  #nextRegistration = 1;
  #restoreLease = null;
  constructor({ applicationId: applicationId2, preferences, reportError }) {
    this.#applicationId = applicationId2;
    this.#preferences = preferences;
    this.#reportError = (error) => {
      try {
        const result = reportError?.(error);
        if (isThenable(result)) {
          void Promise.resolve(result).catch(() => {
          });
        }
      } catch {
      }
    };
  }
  register(delegate) {
    const record = {
      active: true,
      delegate,
      id: `window-${this.#nextRegistration++}`,
      token: Object.freeze({})
    };
    this.#registrations.set(record.token, record);
    return Object.freeze({
      id: record.id,
      requestSweep: () => this.#requestSweep(record),
      requestRecovery: (tab, evidence) => this.#requestRecovery(record, tab, evidence),
      cancelRecovery: (tab) => this.#cancelRecovery(record, tab),
      isApplicationBusy: () => this.#active !== null,
      dispose: () => this.#disposeRegistration(record)
    });
  }
  snapshot() {
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
        [...this.#registrations.values()].map((record) => record.id)
      ),
      sweepRecords,
      trailingCount
    });
  }
  #requestSweep(record) {
    if (!this.#isRegistrationCurrent(record)) {
      return canceledReceipt();
    }
    const existing = this.#records.get(SWEEP_KEY);
    if (!existing) {
      const request = { kind: "sweep", receipt: createReceipt() };
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
  #requestRecovery(registration, tab, evidence) {
    if (!this.#isRegistrationCurrent(registration)) {
      return canceledReceipt();
    }
    const existing = this.#records.get(tab);
    if (!existing) {
      const request = {
        evidence,
        kind: "recovery",
        receipt: createReceipt(),
        registration,
        tab
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
        tab
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
  #cancelRecovery(registration, tab) {
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
  #disposeRegistration(record) {
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
        if (queued.request.kind === "recovery" && queued.request.registration === record) {
          this.#records.delete(key);
          queued.request.receipt.settle("canceled");
        }
        continue;
      }
      if (queued.request.kind === "recovery" && queued.request.registration === record) {
        const successor = this.#cancelActive(
          queued,
          (request) => request.kind === "recovery" && request.registration !== record
        );
        if (successor) {
          this.#records.set(key, { request: successor, state: "queued" });
        }
      }
      if (queued.trailing?.kind === "recovery" && queued.trailing.registration === record) {
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
  #cancelActive(record, preserveTrailing) {
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
  #cancelInvocation(record, invocation) {
    const lease = this.#restoreLease;
    invocation.abort.abort();
    record.draining = true;
    if (!lease || lease.invocationToken !== invocation.token) {
      return;
    }
    try {
      this.#releaseRestore(lease);
    } catch (error) {
      this.#reportError(error);
    }
  }
  #drain() {
    if (this.#active) {
      return;
    }
    for (const [key, record] of this.#records) {
      if (record.state !== "queued") {
        continue;
      }
      const active = {
        canceled: false,
        detached: false,
        draining: false,
        failed: false,
        invocation: null,
        key,
        operationToken: Object.freeze({}),
        request: record.request,
        state: "active",
        trailing: null
      };
      this.#records.set(key, active);
      this.#active = active;
      void this.#execute(active).then((result) => this.#complete(active, result));
      return;
    }
  }
  async #execute(record) {
    if (record.request.kind === "recovery") {
      return this.#executeRecovery(record, record.request);
    }
    return this.#executeSweep(record);
  }
  async #executeRecovery(record, request) {
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
  async #executeSweep(record) {
    const participants = [...this.#registrations.values()].filter(
      (participant) => this.#isRegistrationCurrent(participant)
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
  #beginInvocation(record, registration) {
    const invocation = {
      abort: new AbortController(),
      registration,
      token: Object.freeze({})
    };
    record.invocation = invocation;
    return invocation;
  }
  #finishInvocation(record, invocation) {
    if (record.invocation === invocation) {
      record.invocation = null;
      record.draining = false;
    }
  }
  #contextFor(record, invocation) {
    const isCurrent = () => this.#active === record && record.operationToken === this.#active.operationToken && record.invocation === invocation && !record.canceled && !invocation.abort.signal.aborted && this.#isRegistrationCurrent(invocation.registration);
    return Object.freeze({
      signal: invocation.abort.signal,
      isCurrent,
      readOnDemand: () => this.#preferences.readOnDemand(),
      reconcileOnDemand: (value) => {
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
      withOnDemandDisabled: async (work) => {
        if (!isCurrent()) {
          return;
        }
        if (this.#restoreLease) {
          throw new TypeError("application restore preference is already owned");
        }
        const lease = {
          invocationToken: invocation.token,
          previous: this.#preferences.readOnDemand()
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
      }
    });
  }
  #releaseRestore(lease) {
    if (this.#restoreLease !== lease) {
      return;
    }
    this.#preferences.writeOnDemand(lease.previous);
    this.#restoreLease = null;
  }
  #complete(record, result) {
    if (this.#active !== record) {
      return;
    }
    if (this.#restoreLease) {
      try {
        this.#releaseRestore(this.#restoreLease);
      } catch (error) {
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
  #isRegistrationOwned(record) {
    return this.#registrations.get(record.token) === record;
  }
  #isRegistrationCurrent(record) {
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
  #reportDelegateError(record, error) {
    try {
      const result = record.delegate.reportError(error);
      if (isThenable(result)) {
        void Promise.resolve(result).catch(this.#reportError);
      }
    } catch (reportingError) {
      this.#reportError(reportingError);
    }
  }
};

// src/application.ts
var PREF_ONDEMAND = "browser.sessionstore.restore_pinned_tabs_on_demand";
var owner = new KeepLoadedApplicationOwner({
  applicationId: Services.uuid.generateUUID().toString(),
  preferences: {
    readOnDemand: () => Services.prefs.getBoolPref(PREF_ONDEMAND, false),
    writeOnDemand: (value) => Services.prefs.setBoolPref(PREF_ONDEMAND, value)
  },
  reportError: (error) => {
    console.error("[keep-loaded] application owner failed", error);
  }
});
var protocol = APPLICATION_COORDINATOR_PROTOCOL;
var applicationId = owner.snapshot().applicationId;
var register = (delegate) => owner.register(delegate);
var snapshot = () => owner.snapshot();
export {
  applicationId,
  protocol,
  register,
  snapshot
};
