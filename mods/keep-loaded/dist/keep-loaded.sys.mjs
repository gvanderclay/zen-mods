// Generated from src/ by build.mjs — do not edit.

// src/core/pulse-scheduler.ts
var OFF = Object.freeze({ everyMs: 0, holdMs: 0 });
var validSchedule = (schedule) => Number.isFinite(schedule.everyMs) && Number.isFinite(schedule.holdMs) && schedule.everyMs >= 0 && schedule.holdMs >= 0;
var SerialPulseScheduler = class {
  #now;
  #setTimeout;
  #clearTimeout;
  #onDue;
  #onError;
  #deadline = null;
  #inFlight = false;
  #schedule = OFF;
  #stopped = false;
  #trailingCycle = false;
  #timer = null;
  constructor({ now, setTimeout, clearTimeout, onDue, onError }) {
    this.#now = now;
    this.#setTimeout = setTimeout;
    this.#clearTimeout = clearTimeout;
    this.#onDue = onDue;
    this.#onError = (error) => {
      try {
        onError?.(error);
      } catch {
      }
    };
  }
  get inFlight() {
    return this.#inFlight;
  }
  get schedule() {
    return this.#schedule;
  }
  set(schedule) {
    if (this.#stopped) {
      return;
    }
    if (!validSchedule(schedule)) {
      throw new RangeError("pulse schedule must contain finite non-negative durations");
    }
    const next = Object.freeze({
      everyMs: schedule.everyMs,
      holdMs: Math.min(schedule.holdMs, schedule.everyMs)
    });
    if (this.#schedule.everyMs === next.everyMs && this.#schedule.holdMs === next.holdMs) {
      return;
    }
    const wasEnabled = this.#schedule.everyMs > 0;
    this.#schedule = next;
    if (next.everyMs <= 0) {
      this.#deadline = null;
      this.#trailingCycle = false;
      this.#clearScheduledTimer();
      return;
    }
    if (!wasEnabled) {
      this.#deadline = this.#now() + next.everyMs;
      this.#arm();
      return;
    }
    if (!this.#inFlight) {
      this.#deadline = this.#now() + next.everyMs;
      this.#arm();
    }
  }
  complete() {
    if (!this.#inFlight) {
      return;
    }
    this.#inFlight = false;
    if (this.#stopped || this.#schedule.everyMs <= 0) {
      this.#deadline = null;
      this.#trailingCycle = false;
      this.#clearScheduledTimer();
      return;
    }
    const now = this.#now();
    if (this.#trailingCycle) {
      this.#trailingCycle = false;
      this.#deadline = now + this.#schedule.everyMs;
      this.#arm();
      return;
    }
    const intendedNext = (this.#deadline ?? now) + this.#schedule.everyMs;
    if (intendedNext > now) {
      this.#deadline = intendedNext;
    } else {
      this.#deadline = now;
      this.#trailingCycle = true;
    }
    this.#arm();
  }
  stop() {
    this.#stopped = true;
    this.#schedule = OFF;
    this.#deadline = null;
    this.#trailingCycle = false;
    this.#clearScheduledTimer();
  }
  #arm() {
    this.#clearScheduledTimer();
    if (this.#stopped || this.#schedule.everyMs <= 0 || this.#deadline === null) {
      return;
    }
    const token = Object.freeze({});
    const timer = { handle: null, token };
    this.#timer = timer;
    try {
      timer.handle = this.#setTimeout(
        () => {
          if (this.#timer !== timer || this.#stopped || this.#schedule.everyMs <= 0) {
            return;
          }
          this.#timer = null;
          this.#inFlight = true;
          try {
            this.#onDue();
          } catch (error) {
            this.#onError(error);
            this.complete();
          }
        },
        Math.max(0, this.#deadline - this.#now())
      );
    } catch (error) {
      if (this.#timer === timer) {
        this.#timer = null;
      }
      this.#onError(error);
    }
  }
  #clearScheduledTimer() {
    const timer = this.#timer;
    if (!timer) {
      return;
    }
    this.#timer = null;
    if (timer.handle === null) {
      return;
    }
    try {
      this.#clearTimeout(timer.handle);
    } catch (error) {
      this.#onError(error);
    }
  }
};

// src/core/defaults.ts
var DEFAULT_CRASH_ATTEMPTS = "3";
var DEFAULT_CRASH_WINDOW = "60";

// src/core/recovery.ts
var DEFAULT_MAX_ATTEMPTS = Number(DEFAULT_CRASH_ATTEMPTS);
var DEFAULT_WINDOW_MINUTES = Number(DEFAULT_CRASH_WINDOW);
function recentAttempts(attempts, now, windowMs) {
  return attempts.filter((at) => at > now - windowMs && at <= now);
}

// src/core/recovery-ledger.ts
var RecoveryAttemptLedger = class {
  #attempts = /* @__PURE__ */ new WeakMap();
  recent(tab, now, windowMs) {
    const retained = recentAttempts(this.#attempts.get(tab) ?? [], now, windowMs);
    if (retained.length === 0) {
      this.#attempts.delete(tab);
    } else {
      this.#attempts.set(tab, retained);
    }
    return [...retained];
  }
  charge(tab, at, windowMs) {
    const retained = this.recent(tab, at, windowMs);
    const charged = [...retained, at];
    this.#attempts.set(tab, charged);
    return [...charged];
  }
  clear(tab) {
    this.#attempts.delete(tab);
  }
};

// src/application-coordinator.ts
var APPLICATION_COORDINATOR_PROTOCOL = 6;
var SWEEP_KEY = /* @__PURE__ */ Symbol("keep-loaded-sweep");
var PULSE_KEY = /* @__PURE__ */ Symbol("keep-loaded-pulse");
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
  #recoveryAttempts = new RecoveryAttemptLedger();
  #timers;
  #pulseScheduler;
  #active = null;
  #desiredOnDemand = null;
  #nextRegistration = 1;
  #statusWidgetHosts = /* @__PURE__ */ new Map();
  #wakeTransaction = null;
  constructor({
    applicationId: applicationId2,
    preferences,
    reportError,
    timers
  }) {
    this.#applicationId = applicationId2;
    this.#preferences = preferences;
    this.#timers = timers;
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
    this.#pulseScheduler = new SerialPulseScheduler({
      now: timers.now,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      onDue: () => this.#pulseDue(),
      onError: (error) => this.#reportError(error)
    });
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
      acquireStatusWidget: (host) => this.#acquireStatusWidget(record, host),
      requestSweep: () => this.#requestSweep(record),
      requestPulse: () => this.#requestPulse(record),
      setPulseSchedule: (schedule) => this.#setPulseSchedule(record, schedule),
      requestRecovery: (tab, evidence) => this.#requestRecovery(record, tab, evidence),
      recentRecoveryAttempts: (tab, now, windowMs) => this.#recentRecoveryAttempts(record, tab, now, windowMs),
      chargeRecoveryAttempt: (tab, at, windowMs) => this.#chargeRecoveryAttempt(record, tab, at, windowMs),
      cancelRecovery: (tab) => this.#cancelRecovery(record, tab),
      invalidateTab: (tab) => this.#invalidateTab(record, tab),
      reconcileOnDemand: (value) => this.#reconcileOnDemand(record, value),
      isApplicationBusy: () => this.#active !== null,
      dispose: (reason = "generation-ended") => this.#disposeRegistration(record, reason)
    });
  }
  #acquireStatusWidget(registration, host) {
    if (!this.#isRegistrationOwned(registration)) {
      return Object.freeze({ release: () => false });
    }
    if (this.#statusWidgetHosts.has(registration)) {
      throw new TypeError("a registration can own only one status widget lease");
    }
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
      }
    });
  }
  #releaseStatusWidget(registration) {
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
  #recentRecoveryAttempts(registration, tab, now, windowMs) {
    if (!this.#isRegistrationCurrent(registration)) {
      return [];
    }
    return Object.freeze(this.#recoveryAttempts.recent(tab, now, windowMs));
  }
  #chargeRecoveryAttempt(registration, tab, at, windowMs) {
    if (!this.#isRegistrationCurrent(registration)) {
      return false;
    }
    return Object.freeze(this.#recoveryAttempts.charge(tab, at, windowMs));
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
      trailingCount,
      desiredOnDemand: this.#desiredOnDemand,
      wakeAttempt: this.#wakeTransaction?.attempt ?? null,
      wakeCandidates: this.#wakeTransaction?.owned.size ?? 0,
      wakePhase: this.#wakeTransaction?.phase.kind ?? "idle"
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
  #requestPulse(record) {
    if (!this.#isRegistrationCurrent(record)) {
      return canceledReceipt();
    }
    const existing = this.#records.get(PULSE_KEY);
    if (!existing) {
      const request = { kind: "pulse", receipt: createReceipt() };
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
  #setPulseSchedule(record, schedule) {
    if (!this.#isRegistrationCurrent(record)) {
      return;
    }
    this.#pulseScheduler.set(schedule);
    if (schedule.everyMs <= 0 && this.#active?.request.kind === "pulse") {
      this.#cancelActive(this.#active, void 0, "generation-ended");
    }
  }
  #pulseDue() {
    const participant = [...this.#registrations.values()].find(
      (record) => this.#isRegistrationCurrent(record)
    );
    if (!participant) {
      this.#pulseScheduler.set({ everyMs: 0, holdMs: 0 });
      this.#pulseScheduler.complete();
      return;
    }
    const receipt = this.#requestPulse(participant);
    void receipt.done.then(() => this.#pulseScheduler.complete());
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
  #invalidateTab(registration, tab) {
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
      this.#cancelActive(this.#active, void 0, "generation-ended");
      canceledPulse = true;
    }
    return this.#cancelRecovery(registration, tab) || wasCandidate || canceledPulse;
  }
  #reconcileOnDemand(registration, value) {
    if (!this.#isRegistrationCurrent(registration)) {
      return false;
    }
    this.#desiredOnDemand = value;
    if (this.#wakeTransaction) {
      return true;
    }
    return this.#writeDesiredPreference(value);
  }
  #disposeRegistration(record, reason) {
    if (!this.#isRegistrationOwned(record)) {
      return false;
    }
    this.#releaseStatusWidget(record);
    record.active = false;
    this.#registrations.delete(record.token);
    for (const [key, queued] of [...this.#records]) {
      if (key === SWEEP_KEY || key === PULSE_KEY) {
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
          (request) => request.kind === "recovery" && request.registration !== record,
          reason
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
      this.#cancelInvocation(active, active.invocation, reason);
    }
    if (this.#registrations.size === 0) {
      this.#pulseScheduler.set({ everyMs: 0, holdMs: 0 });
      const sweep = this.#records.get(SWEEP_KEY);
      if (sweep?.state === "queued") {
        this.#records.delete(SWEEP_KEY);
        sweep.request.receipt.settle("canceled");
      } else if (sweep?.state === "active") {
        this.#cancelActive(sweep, void 0, reason);
      }
      const pulse = this.#records.get(PULSE_KEY);
      if (pulse?.state === "queued") {
        this.#records.delete(PULSE_KEY);
        pulse.request.receipt.settle("canceled");
      } else if (pulse?.state === "active") {
        this.#cancelActive(pulse, void 0, reason);
      }
    }
    return true;
  }
  #cancelActive(record, preserveTrailing, reason = "generation-ended") {
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
  #cancelInvocation(record, invocation, reason = "generation-ended") {
    invocation.abort.abort();
    record.draining = true;
    this.#cancelWakeTransaction(invocation, reason);
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
        pendingResult: null,
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
    if (record.request.kind === "pulse") {
      return this.#executePulse(record);
    }
    if (record.request.kind === "recovery") {
      return this.#executeRecovery(record, record.request);
    }
    return this.#executeSweep(record);
  }
  async #executePulse(record) {
    const participants = [...this.#registrations.values()].filter(
      (participant) => this.#isRegistrationCurrent(participant)
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
      readOnDemand: () => this.#desiredOnDemand ?? this.#preferences.readOnDemand(),
      reconcileOnDemand: (value) => {
        if (!isCurrent()) {
          return;
        }
        this.#reconcileOnDemand(invocation.registration, value);
      },
      wakeCandidates: (candidates, options) => {
        if (!isCurrent()) {
          return Promise.resolve("canceled");
        }
        return this.#beginWakeTransaction(record, invocation, candidates, options);
      }
    });
  }
  #beginWakeTransaction(operation, invocation, candidates, options) {
    if (this.#wakeTransaction) {
      throw new TypeError("application wake preference is already owned");
    }
    if (!Number.isFinite(options.pollMs) || options.pollMs <= 0 || !Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0 || !Number.isSafeInteger(options.retryLimit) || options.retryLimit < 0) {
      throw new RangeError("wake timings and retry limit must be finite and positive");
    }
    const remaining = /* @__PURE__ */ new Map();
    let invalidCandidate = false;
    for (const candidate of candidates) {
      if (remaining.has(candidate.key)) {
        throw new TypeError("wake candidates must have unique keys");
      }
      let state;
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
          new TypeError("refusing to claim a wake candidate inserted by another owner")
        );
        invalidCandidate = true;
      }
    }
    if (invalidCandidate || remaining.size === 0) {
      return Promise.resolve(invalidCandidate ? "failed" : "completed");
    }
    let original;
    try {
      original = this.#preferences.readOnDemand();
    } catch (error) {
      this.#reportError(error);
      return Promise.resolve("failed");
    }
    const receipt = createReceipt();
    const transaction = {
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
      owned: /* @__PURE__ */ new Map(),
      phase: { kind: "acquiring" },
      receipt,
      remaining,
      timer: null
    };
    this.#wakeTransaction = transaction;
    this.#advanceWake(transaction);
    return receipt.promise;
  }
  #advanceWake(transaction) {
    if (this.#wakeTransaction !== transaction) {
      return;
    }
    if (transaction.advancing) {
      transaction.needsAdvance = true;
      return;
    }
    transaction.advancing = true;
    try {
      for (; ; ) {
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
            if (!transaction.canceled && transaction.attemptFailed && transaction.attempt < transaction.options.retryLimit && transaction.remaining.size > 0) {
              transaction.attempt += 1;
              transaction.attemptFailed = false;
              transaction.phase = { kind: "retrying" };
              if (!this.#scheduleWake(transaction, transaction.options.pollMs, {
                kind: "inserting"
              })) {
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
                "cannot restore a preference over owned wake candidates"
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
              transaction.canceled ? "canceled" : transaction.failed ? "failed" : "completed"
            );
            return;
          }
          case "blocked":
          case "retrying":
            return;
          default:
            transaction.phase;
        }
      }
    } finally {
      transaction.advancing = false;
      if (transaction.needsAdvance && this.#wakeTransaction === transaction && !transaction.timer) {
        transaction.needsAdvance = false;
        this.#advanceWake(transaction);
      }
    }
  }
  #insertWakeCandidates(transaction) {
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
          new TypeError("wake candidate became owned by another insertion")
        );
        continue;
      }
      if (before !== "lazy") {
        transaction.failed = true;
        transaction.attemptFailed = true;
        transaction.remaining.delete(candidate.key);
        continue;
      }
      const owned = {
        candidate,
        invalidated: false
      };
      transaction.owned.set(candidate.key, owned);
      let insertionError = null;
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
  #inspectWaitingCandidates(transaction) {
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
  #rollbackWakeCandidates(transaction) {
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
  #readCandidateState(transaction, candidate) {
    try {
      return candidate.state();
    } catch (error) {
      transaction.failed = true;
      transaction.attemptFailed = true;
      this.#reportDelegateError(transaction.invocation.registration, error);
      return null;
    }
  }
  #ensurePreference(transaction, target) {
    let current;
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
        new TypeError("wake preference changed before the owner could verify its write")
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
  #writeDesiredPreference(target) {
    try {
      if (this.#preferences.readOnDemand() === target) {
        return true;
      }
      this.#preferences.writeOnDemand(target);
      if (this.#preferences.readOnDemand() === target) {
        return true;
      }
      this.#reportError(
        new TypeError("desired wake preference changed before verification")
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
  #blockWake(transaction, resume) {
    transaction.phase = { kind: "blocked", resume };
    this.#scheduleWake(transaction, transaction.options.pollMs, { kind: resume });
  }
  #scheduleWake(transaction, delayMs, resume) {
    this.#clearWakeTimer(transaction);
    const token = Object.freeze({});
    const timer = { handle: null, token };
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
  #clearWakeTimer(transaction) {
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
  #cancelWakeTransaction(invocation, reason) {
    const transaction = this.#wakeTransaction;
    if (!transaction || transaction.invocation.token !== invocation.token) {
      return;
    }
    transaction.canceled = true;
    transaction.closed = reason === "window-closed";
    this.#clearWakeTimer(transaction);
    transaction.phase = transaction.closed ? { kind: "restoring-preference" } : { kind: "rolling-back" };
    this.#advanceWake(transaction);
  }
  #finishWakeTransaction(transaction, result) {
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
  #complete(record, result) {
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
var Timer = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
var owner = new KeepLoadedApplicationOwner({
  applicationId: Services.uuid.generateUUID().toString(),
  preferences: {
    readOnDemand: () => Services.prefs.getBoolPref(PREF_ONDEMAND, false),
    writeOnDemand: (value) => Services.prefs.setBoolPref(PREF_ONDEMAND, value)
  },
  reportError: (error) => {
    console.error("[keep-loaded] application owner failed", error);
  },
  timers: {
    clearTimeout: Timer.clearTimeout,
    now: Date.now,
    setTimeout: Timer.setTimeout
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
