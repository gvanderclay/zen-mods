/** Owns the application-wide wake transaction from acquisition through cleanup. */

import type {
  ApplicationPreferencesPort,
  ApplicationTimerPort,
} from "./application-owner-contracts.ts";
import type {
  ApplicationDisposeReason,
  WakeCandidate,
  WakeCandidateState,
  WakeTransactionOptions,
  WorkResult,
} from "./application-protocol.ts";
import {
  type ActiveInvocation,
  type ActiveRecord,
  createReceipt,
  type OwnedWakeCandidate,
  type RegistrationRecord,
  type WakePhase,
  type WakeTimer,
  type WakeTransaction,
} from "./application-state.ts";

/** Every coordinator value this owner reads is a query, never a shared writable field. */
interface ApplicationWakePorts<Tab extends object, Evidence> {
  onComplete(record: ActiveRecord<Tab, Evidence>, result: WorkResult): void;
  onDelegateError(record: RegistrationRecord<Tab, Evidence>, error: unknown): void;
  onError(error: unknown): void;
  readonly preferences: ApplicationPreferencesPort;
  readDesiredOnDemand(): boolean | null;
  readonly timers: ApplicationTimerPort;
}

interface ApplicationWakeSnapshot {
  readonly attempt: number | null;
  readonly candidates: number;
  readonly phase: WakePhase["kind"] | "idle";
  readonly retryScheduled: boolean;
}

export class ApplicationWakeOwner<Tab extends object, Evidence> {
  readonly #ports: ApplicationWakePorts<Tab, Evidence>;
  #transaction: WakeTransaction<Tab, Evidence> | null = null;

  constructor(ports: ApplicationWakePorts<Tab, Evidence>) {
    this.#ports = ports;
  }

  holdsOperation(record: ActiveRecord<Tab, Evidence>): boolean {
    return this.#transaction?.operation === record;
  }

  /** Drops one tab from the live transaction, rolling back if this owner claimed it. */
  invalidateCandidate(tab: Tab): boolean {
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

  isActive(): boolean {
    return this.#transaction !== null;
  }

  snapshot(): ApplicationWakeSnapshot {
    return {
      attempt: this.#transaction?.attempt ?? null,
      candidates: this.#transaction?.owned.size ?? 0,
      phase: this.#transaction?.phase.kind ?? "idle",
      retryScheduled: this.#transaction?.timer != null,
    };
  }

  begin(
    operation: ActiveRecord<Tab, Evidence>,
    invocation: ActiveInvocation<Tab, Evidence>,
    candidates: readonly WakeCandidate[],
    options: WakeTransactionOptions,
  ): Promise<WorkResult> {
    if (this.#transaction) {
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
        this.#ports.onDelegateError(invocation.registration, error);
        invalidCandidate = true;
        continue;
      }
      if (state === "lazy") {
        remaining.set(candidate.key, candidate);
      } else if (state === "inserted-pending") {
        this.#ports.onDelegateError(
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
      original = this.#ports.preferences.readOnDemand();
    } catch (error) {
      this.#ports.onError(error);
      return Promise.resolve("failed");
    }
    const receipt = createReceipt();
    const transaction: WakeTransaction<Tab, Evidence> = {
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
      operation,
      options: Object.freeze({ ...options }),
      original,
      owned: new Map(),
      phase: { kind: "acquiring" },
      receipt,
      remaining,
      timer: null,
    };
    this.#transaction = transaction;
    this.#advance(transaction);
    return receipt.promise;
  }

  #advance(transaction: WakeTransaction<Tab, Evidence>): void {
    if (this.#transaction !== transaction) {
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
                !this.#schedule(transaction, transaction.options.pollMs, {
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
        this.#transaction === transaction &&
        !transaction.timer
      ) {
        transaction.needsAdvance = false;
        this.#advance(transaction);
      }
    }
  }

  #insertCandidates(transaction: WakeTransaction<Tab, Evidence>): void {
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

  #inspectWaiting(transaction: WakeTransaction<Tab, Evidence>): boolean {
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

  #rollbackCandidates(transaction: WakeTransaction<Tab, Evidence>): boolean {
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

  #readCandidateState(
    transaction: WakeTransaction<Tab, Evidence>,
    candidate: WakeCandidate,
  ): WakeCandidateState | null {
    try {
      return candidate.state();
    } catch (error) {
      transaction.failed = true;
      transaction.attemptFailed = true;
      this.#ports.onDelegateError(transaction.invocation.registration, error);
      return null;
    }
  }

  #ensurePreference(
    transaction: WakeTransaction<Tab, Evidence>,
    target: boolean,
  ): boolean {
    let current: boolean;
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
        new TypeError("wake preference changed before the owner could verify its write"),
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

  writeDesiredPreference(target: boolean): boolean {
    try {
      if (this.#ports.preferences.readOnDemand() === target) {
        return true;
      }
      this.#ports.preferences.writeOnDemand(target);
      if (this.#ports.preferences.readOnDemand() === target) {
        return true;
      }
      this.#ports.onError(
        new TypeError("desired wake preference changed before verification"),
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

  #block(
    transaction: WakeTransaction<Tab, Evidence>,
    resume: "restoring-preference" | "rolling-back",
  ): void {
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

  #schedule(
    transaction: WakeTransaction<Tab, Evidence>,
    delayMs: number,
    resume?: WakePhase,
  ): boolean {
    this.#clearTimer(transaction);
    const token = Object.freeze({});
    const timer: WakeTimer = { handle: null, token };
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

  #clearTimer(transaction: WakeTransaction<Tab, Evidence>): void {
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

  cancel(
    invocation: ActiveInvocation<Tab, Evidence>,
    reason: ApplicationDisposeReason,
  ): void {
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

  #finish(transaction: WakeTransaction<Tab, Evidence>, result: WorkResult): void {
    if (this.#transaction !== transaction) {
      return;
    }
    this.#clearTimer(transaction);
    this.#transaction = null;
    transaction.receipt.settle(result);
    const pendingResult = transaction.operation.pendingResult;
    if (pendingResult) {
      transaction.operation.pendingResult = null;
      this.#ports.onComplete(transaction.operation, pendingResult);
    }
  }
}
