// Generated from src/ by build.mjs — do not edit.

// src/application-protocol.ts
var APPLICATION_COORDINATOR_PROTOCOL = 12;

// src/application-state.ts
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

// src/application-queue.ts
var canceledReceipt = () => {
  const receipt = createReceipt();
  receipt.settle("canceled");
  return receipt.public;
};
var KeyedWorkQueue = class {
  #ports;
  #records = /* @__PURE__ */ new Map();
  #active = null;
  constructor(ports) {
    this.#ports = ports;
  }
  isBusy() {
    return this.#active !== null;
  }
  /** Finishes the active record whose wake transaction just released it. */
  releaseWakeHold(operationToken) {
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
  cancelActivePulse(reason = "generation-ended") {
    if (this.#active?.request.kind === "pulse") {
      this.#cancelActive(this.#active, void 0, reason);
    }
  }
  /** Drops the application-wide sweep and pulse keys once no registration remains. */
  dropApplicationWork(reason) {
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
  /** Drops one registration's keyed work, promoting an eligible trailing successor. */
  dropRegistrationWork(registration, reason) {
    for (const [key, queued] of [...this.#records]) {
      if (key === SWEEP_KEY || key === PULSE_KEY) {
        continue;
      }
      if (queued.state === "queued") {
        if (queued.request.kind === "recovery" && queued.request.registration === registration) {
          this.#records.delete(key);
          queued.request.receipt.settle("canceled");
        }
        continue;
      }
      if (queued.request.kind === "recovery" && queued.request.registration === registration) {
        const successor = this.#cancelActive(
          queued,
          (request) => request.kind === "recovery" && request.registration !== registration,
          reason
        );
        if (successor) {
          this.#records.set(key, { request: successor, state: "queued" });
        }
      }
      if (queued.trailing?.kind === "recovery" && queued.trailing.registration === registration) {
        queued.trailing.receipt.settle("canceled");
        queued.trailing = null;
      }
    }
    const active = this.#active;
    if (active?.invocation?.registration === registration) {
      this.#cancelInvocation(active, active.invocation, reason);
    }
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
    return {
      activeCount: this.#active ? 1 : 0,
      activeKind: this.#active?.request.kind ?? null,
      drainingCount: this.#active?.draining ? 1 : 0,
      keyRecords: this.#records.size,
      readyCount,
      sweepRecords,
      trailingCount
    };
  }
  requestSweep(record) {
    if (!this.#ports.isRegistrationCurrent(record)) {
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
  requestPulse(record) {
    if (!this.#ports.isRegistrationCurrent(record)) {
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
  requestRecovery(registration, tab, evidence) {
    if (!this.#ports.isRegistrationCurrent(registration)) {
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
  cancelRecovery(registration, tab) {
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
    this.#ports.wake.cancel(invocation, reason);
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
    const participants = this.#ports.participants();
    for (const participant of participants) {
      if (record.canceled) {
        break;
      }
      if (!this.#ports.isRegistrationCurrent(participant) || !participant.delegate.pulse) {
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
  async #executeRecovery(record, request) {
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
  async #executeSweep(record) {
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
    const isCurrent = () => this.#active === record && record.operationToken === this.#active.operationToken && record.invocation === invocation && !record.canceled && !invocation.abort.signal.aborted && this.#ports.isRegistrationCurrent(invocation.registration);
    return Object.freeze({
      signal: invocation.abort.signal,
      isCurrent,
      readOnDemand: () => this.#ports.readOnDemand(),
      reconcileOnDemand: (value) => {
        if (!isCurrent()) {
          return;
        }
        this.#ports.reconcileOnDemand(invocation.registration, value);
      },
      wakeCandidates: (candidates, options) => {
        if (!isCurrent()) {
          return Promise.resolve("canceled");
        }
        return this.#ports.wake.begin(
          record.operationToken,
          invocation,
          candidates,
          options
        );
      }
    });
  }
  #complete(record, result) {
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
};

// src/application-wake.ts
var ApplicationWakeOwner = class {
  #ports;
  #transaction = null;
  constructor(ports) {
    this.#ports = ports;
  }
  holdsOperation(operationToken) {
    return this.#transaction?.operationToken === operationToken;
  }
  /** Drops one tab from the live transaction, rolling back if this owner claimed it. */
  invalidateCandidate(tab) {
    const transaction = this.#transaction;
    const owned = transaction?.owned.get(tab);
    const wasCandidate = transaction?.remaining.has(tab) === true || !!owned;
    if (transaction && wasCandidate) {
      transaction.remaining.delete(tab);
      if (owned) {
        owned.invalidated = true;
        transaction.failed = true;
        this.#clearTimer(transaction);
        transaction.phase = { kind: "rolling-back" };
        this.#advance(transaction);
      }
    }
    return wasCandidate;
  }
  isActive() {
    return this.#transaction !== null;
  }
  snapshot() {
    return {
      attempt: this.#transaction?.attempt ?? null,
      candidates: this.#transaction?.owned.size ?? 0,
      phase: this.#transaction?.phase.kind ?? "idle",
      retryScheduled: this.#transaction?.timer != null
    };
  }
  begin(operationToken, invocation, candidates, options) {
    if (this.#transaction) {
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
        this.#ports.onDelegateError(invocation.registration, error);
        invalidCandidate = true;
        continue;
      }
      if (state === "lazy") {
        remaining.set(candidate.key, candidate);
      } else if (state === "inserted-pending") {
        this.#ports.onDelegateError(
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
      original = this.#ports.preferences.readOnDemand();
    } catch (error) {
      this.#ports.onError(error);
      return Promise.resolve("failed");
    }
    const receipt = createReceipt();
    const transaction = {
      advancing: false,
      blockedArmFallbackUsed: false,
      attempt: 0,
      attemptFailed: false,
      canceled: false,
      closed: false,
      deadline: 0,
      failed: false,
      invocation,
      needsAdvance: false,
      operationToken,
      options: Object.freeze({ ...options }),
      original,
      owned: /* @__PURE__ */ new Map(),
      phase: { kind: "acquiring" },
      receipt,
      remaining,
      timer: null
    };
    this.#transaction = transaction;
    this.#advance(transaction);
    return receipt.promise;
  }
  #advance(transaction) {
    if (this.#transaction !== transaction) {
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
        if (this.#transaction !== transaction) {
          return;
        }
        switch (transaction.phase.kind) {
          case "acquiring":
            if (!this.#ensurePreference(transaction, false)) {
              transaction.failed = true;
              transaction.phase = { kind: "restoring-preference" };
              continue;
            }
            transaction.phase = { kind: "inserting" };
            continue;
          case "inserting":
            this.#insertCandidates(transaction);
            continue;
          case "waiting":
            if (this.#inspectWaiting(transaction)) {
              continue;
            }
            if (!this.#schedule(transaction, transaction.options.pollMs)) {
              transaction.attemptFailed = true;
              transaction.phase = { kind: "rolling-back" };
              continue;
            }
            return;
          case "rolling-back":
            if (!this.#rollbackCandidates(transaction)) {
              this.#block(transaction, "rolling-back");
              return;
            }
            if (!transaction.canceled && transaction.attemptFailed && transaction.attempt < transaction.options.retryLimit && transaction.remaining.size > 0) {
              transaction.attempt += 1;
              transaction.attemptFailed = false;
              transaction.phase = { kind: "retrying" };
              if (!this.#schedule(transaction, transaction.options.pollMs, {
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
            const target = this.#ports.readDesiredOnDemand() ?? transaction.original;
            if (!this.#ensurePreference(transaction, target)) {
              transaction.failed = true;
              this.#block(transaction, "restoring-preference");
              return;
            }
            if ((this.#ports.readDesiredOnDemand() ?? transaction.original) !== target) {
              continue;
            }
            this.#finish(
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
      if (transaction.needsAdvance && this.#transaction === transaction && !transaction.timer) {
        transaction.needsAdvance = false;
        this.#advance(transaction);
      }
    }
  }
  #insertCandidates(transaction) {
    transaction.deadline = this.#ports.timers.now() + transaction.options.timeoutMs;
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
        this.#ports.onDelegateError(
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
        this.#ports.onDelegateError(transaction.invocation.registration, error);
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
  #inspectWaiting(transaction) {
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
    if (this.#ports.timers.now() >= transaction.deadline) {
      transaction.failed = true;
      transaction.attemptFailed = true;
      transaction.phase = { kind: "rolling-back" };
      return true;
    }
    return false;
  }
  #rollbackCandidates(transaction) {
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
        this.#ports.onDelegateError(transaction.invocation.registration, error);
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
      this.#ports.onDelegateError(transaction.invocation.registration, error);
      return null;
    }
  }
  #ensurePreference(transaction, target) {
    let current;
    try {
      current = this.#ports.preferences.readOnDemand();
    } catch (error) {
      this.#ports.onError(error);
      return false;
    }
    if (current === target) {
      return true;
    }
    try {
      this.#ports.preferences.writeOnDemand(target);
      if (this.#ports.preferences.readOnDemand() === target) {
        return true;
      }
      this.#ports.onError(
        new TypeError("wake preference changed before the owner could verify its write")
      );
      return false;
    } catch (error) {
      transaction.failed = true;
      this.#ports.onError(error);
      try {
        return this.#ports.preferences.readOnDemand() === target;
      } catch (verificationError) {
        this.#ports.onError(verificationError);
        return false;
      }
    }
  }
  writeDesiredPreference(target) {
    try {
      if (this.#ports.preferences.readOnDemand() === target) {
        return true;
      }
      this.#ports.preferences.writeOnDemand(target);
      if (this.#ports.preferences.readOnDemand() === target) {
        return true;
      }
      this.#ports.onError(
        new TypeError("desired wake preference changed before verification")
      );
      return false;
    } catch (error) {
      this.#ports.onError(error);
      try {
        return this.#ports.preferences.readOnDemand() === target;
      } catch (verificationError) {
        this.#ports.onError(verificationError);
        return false;
      }
    }
  }
  #block(transaction, resume) {
    transaction.phase = { kind: "blocked", resume };
    if (this.#schedule(transaction, transaction.options.pollMs, { kind: resume })) {
      transaction.blockedArmFallbackUsed = false;
      return;
    }
    if (transaction.blockedArmFallbackUsed) {
      return;
    }
    transaction.blockedArmFallbackUsed = true;
    transaction.phase = { kind: resume };
    transaction.needsAdvance = true;
  }
  #schedule(transaction, delayMs, resume) {
    this.#clearTimer(transaction);
    const token = Object.freeze({});
    const timer = { handle: null, token };
    transaction.timer = timer;
    try {
      const handle = this.#ports.timers.setTimeout(() => {
        if (this.#transaction !== transaction || transaction.timer?.token !== token) {
          return;
        }
        transaction.timer = null;
        if (resume) {
          transaction.phase = resume;
        }
        this.#advance(transaction);
      }, delayMs);
      timer.handle = handle;
      if (transaction.timer !== timer) {
        try {
          this.#ports.timers.clearTimeout(handle);
        } catch (error) {
          this.#ports.onError(error);
        }
      }
      return true;
    } catch (error) {
      transaction.failed = true;
      transaction.timer = null;
      this.#ports.onError(error);
      return false;
    }
  }
  #clearTimer(transaction) {
    const timer = transaction.timer;
    if (!timer) {
      return;
    }
    transaction.timer = null;
    if (timer.handle === null) {
      return;
    }
    try {
      this.#ports.timers.clearTimeout(timer.handle);
    } catch (error) {
      this.#ports.onError(error);
    }
  }
  cancel(invocation, reason) {
    const transaction = this.#transaction;
    if (!transaction || transaction.invocation.token !== invocation.token) {
      return;
    }
    transaction.canceled = true;
    transaction.closed = reason === "window-closed";
    this.#clearTimer(transaction);
    transaction.phase = { kind: "rolling-back" };
    this.#advance(transaction);
  }
  #finish(transaction, result) {
    if (this.#transaction !== transaction) {
      return;
    }
    this.#clearTimer(transaction);
    this.#transaction = null;
    transaction.receipt.settle(result);
    this.#ports.onRelease(transaction.operationToken);
  }
};

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
  #attemptCount = 0;
  get attemptCount() {
    return this.#attemptCount;
  }
  get hasAttempts() {
    return this.#attemptCount > 0;
  }
  recent(tab, now, windowMs) {
    const previous = this.#attempts.get(tab) ?? [];
    const retained = recentAttempts(previous, now, windowMs);
    this.#attemptCount -= previous.length - retained.length;
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
    this.#attemptCount += 1;
    return [...charged];
  }
  clear(tab) {
    this.#attemptCount -= this.#attempts.get(tab)?.length ?? 0;
    this.#attempts.delete(tab);
  }
  /** Replaces the WeakMap so no old tab key can remain part of the new history. */
  reset() {
    const removed = this.#attemptCount;
    this.#attempts = /* @__PURE__ */ new WeakMap();
    this.#attemptCount = 0;
    return removed;
  }
};

// src/status-widget-leases.ts
var StatusWidgetLeases = class {
  #hosts = /* @__PURE__ */ new Map();
  #onViewShowing = (event) => this.#show(event);
  #ports;
  #phase = "absent";
  constructor(ports) {
    this.#ports = ports;
  }
  acquire(holder, host) {
    if (!this.#ports.isOwned(holder)) {
      return Object.freeze({ release: () => false });
    }
    if (this.#hosts.has(holder)) {
      throw new TypeError("a registration can own only one status widget lease");
    }
    this.#hosts.set(holder, host);
    this.#ensure();
    let released = false;
    return Object.freeze({
      release: () => {
        if (released) {
          return false;
        }
        released = true;
        return this.release(holder);
      }
    });
  }
  release(holder) {
    const host = this.#hosts.get(holder);
    if (!host) {
      return false;
    }
    this.#hosts.delete(holder);
    if (this.#hosts.size === 0 && this.#phase === "present") {
      this.#phase = "destroying";
      try {
        host.destroy();
      } catch (error) {
        this.#ports.onError(error);
      } finally {
        this.#phase = "absent";
        try {
          this.#ensure();
        } catch (replacementError) {
          this.#ports.onError(replacementError);
        }
      }
    }
    return true;
  }
  snapshot() {
    return {
      leaseIds: Object.freeze([...this.#hosts.keys()].map((holder) => holder.id)),
      leases: this.#hosts.size,
      phase: this.#phase
    };
  }
  #ensure() {
    if (this.#phase !== "absent" || this.#hosts.size === 0) {
      return;
    }
    const entry = this.#hosts.entries().next().value;
    if (!entry) {
      return;
    }
    const [holder, host] = entry;
    this.#phase = "creating";
    try {
      host.create(this.#onViewShowing);
    } catch (error) {
      this.#cleanupFailedCreation(holder, host, error);
      throw error;
    }
    if (this.#phase !== "creating") {
      return;
    }
    if (this.#hosts.size === 0) {
      this.#phase = "destroying";
      try {
        host.destroy();
      } catch (error) {
        this.#ports.onError(error);
      } finally {
        this.#phase = "absent";
        this.#ensure();
      }
      return;
    }
    this.#phase = "present";
  }
  /** Cleans a partial widget before retrying a lease acquired during nested teardown. */
  #cleanupFailedCreation(holder, host, failure) {
    if (this.#hosts.get(holder) === host) {
      this.#hosts.delete(holder);
    }
    this.#phase = "destroying";
    try {
      host.destroy();
    } catch (error) {
      this.#ports.onError(error);
    } finally {
      this.#phase = "absent";
      try {
        host.fail?.(failure);
      } catch (error) {
        this.#ports.onError(error);
      }
      try {
        this.#ensure();
      } catch (replacementError) {
        this.#ports.onError(replacementError);
      }
    }
  }
  #show(event) {
    for (const [holder, host] of this.#hosts) {
      if (!this.#ports.isCurrent(holder)) {
        continue;
      }
      try {
        if (host.show(event)) {
          return;
        }
      } catch (error) {
        this.#ports.onError(error);
      }
    }
  }
};

// src/application-coordinator.ts
var isThenable = (value) => (typeof value === "object" || typeof value === "function") && value !== null && "then" in value && typeof value.then === "function";
var KeepLoadedApplicationOwner = class {
  #applicationId;
  #preferences;
  #registrations = /* @__PURE__ */ new Map();
  #reportError;
  #recoveryAttempts = new RecoveryAttemptLedger();
  #pulseScheduler;
  #wake;
  #queue;
  #desiredOnDemand = null;
  #nextRegistration = 1;
  #statusWidget = new StatusWidgetLeases({
    isCurrent: (record) => this.#isRegistrationCurrent(record),
    isOwned: (record) => this.#isRegistrationOwned(record),
    onError: (error) => this.#reportError(error)
  });
  constructor({
    applicationId: applicationId2,
    preferences,
    reportError,
    timers
  }) {
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
    this.#wake = new ApplicationWakeOwner({
      onRelease: (operationToken) => this.#queue.releaseWakeHold(operationToken),
      onDelegateError: (record, error) => this.#reportDelegateError(record, error),
      onError: (error) => this.#reportError(error),
      preferences,
      readDesiredOnDemand: () => this.#desiredOnDemand,
      timers
    });
    this.#queue = new KeyedWorkQueue({
      isRegistrationCurrent: (record) => this.#isRegistrationCurrent(record),
      onDelegateError: (record, error) => this.#reportDelegateError(record, error),
      participants: () => [...this.#registrations.values()].filter(
        (participant) => this.#isRegistrationCurrent(participant)
      ),
      readOnDemand: () => this.#desiredOnDemand ?? this.#preferences.readOnDemand(),
      reconcileOnDemand: (record, value) => {
        this.#reconcileOnDemand(record, value);
      },
      wake: this.#wake
    });
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
      acquireStatusWidget: (host) => this.#statusWidget.acquire(record, host),
      requestSweep: () => this.#queue.requestSweep(record),
      requestPulse: () => this.#queue.requestPulse(record),
      setPulseSchedule: (schedule) => this.#setPulseSchedule(record, schedule),
      requestRecovery: (tab, evidence) => this.#queue.requestRecovery(record, tab, evidence),
      recentRecoveryAttempts: (tab, now, windowMs) => this.#recentRecoveryAttempts(record, tab, now, windowMs),
      chargeRecoveryAttempt: (tab, at, windowMs) => this.#chargeRecoveryAttempt(record, tab, at, windowMs),
      hasRecoveryAttempts: () => this.#isRegistrationCurrent(record) && this.#recoveryAttempts.hasAttempts,
      resetRecoveryAttempts: () => this.#resetRecoveryAttempts(record),
      cancelRecovery: (tab) => this.#queue.cancelRecovery(record, tab),
      invalidateTab: (tab) => this.#invalidateTab(record, tab),
      reconcileOnDemand: (value) => this.#reconcileOnDemand(record, value),
      isApplicationBusy: () => this.#queue.isBusy(),
      dispose: (reason = "generation-ended") => this.#disposeRegistration(record, reason)
    });
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
    const attempts = Object.freeze(this.#recoveryAttempts.charge(tab, at, windowMs));
    this.#refreshStatusPanels();
    return attempts;
  }
  #resetRecoveryAttempts(registration) {
    if (!this.#isRegistrationCurrent(registration)) {
      return false;
    }
    if (this.#recoveryAttempts.reset() === 0) {
      return false;
    }
    this.#refreshStatusPanels();
    return true;
  }
  #refreshStatusPanels() {
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
  snapshot() {
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
        [...this.#registrations.values()].map((record) => record.id)
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
      wakePhase: wake.phase
    });
  }
  #setPulseSchedule(record, schedule) {
    if (!this.#isRegistrationCurrent(record)) {
      return;
    }
    this.#pulseScheduler.set(schedule);
    if (schedule.everyMs <= 0) {
      this.#queue.cancelActivePulse();
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
    const receipt = this.#queue.requestPulse(participant);
    void receipt.done.then(() => this.#pulseScheduler.complete());
  }
  #invalidateTab(registration, tab) {
    if (!this.#isRegistrationCurrent(registration)) {
      return false;
    }
    const wasCandidate = this.#wake.invalidateCandidate(tab);
    return this.#queue.cancelRecovery(registration, tab) || wasCandidate;
  }
  #reconcileOnDemand(registration, value) {
    if (!this.#isRegistrationCurrent(registration)) {
      return false;
    }
    this.#desiredOnDemand = value;
    if (this.#wake.isActive()) {
      return true;
    }
    return this.#wake.writeDesiredPreference(value);
  }
  #disposeRegistration(record, reason) {
    if (!this.#isRegistrationOwned(record)) {
      return false;
    }
    record.active = false;
    this.#registrations.delete(record.token);
    this.#statusWidget.release(record);
    this.#queue.dropRegistrationWork(record, reason);
    if (this.#registrations.size === 0) {
      this.#pulseScheduler.set({ everyMs: 0, holdMs: 0 });
      this.#queue.dropApplicationWork(reason);
    }
    return true;
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
    now: ChromeUtils.now,
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
