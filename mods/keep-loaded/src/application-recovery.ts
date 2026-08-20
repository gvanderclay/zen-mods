/** Owns the application crash budget behind a registration-liveness guard. */

import type { RegistrationRecord } from "./application-state.ts";
import { RecoveryAttemptLedger } from "./core/recovery-ledger.ts";

interface RecoveryBudgetPorts<Tab extends object, Evidence> {
  isRegistrationCurrent(record: RegistrationRecord<Tab, Evidence>): boolean;
  /** Lets the registration owner refresh panels after the budget really changes. */
  onBudgetChanged(): void;
}

export class RecoveryBudget<Tab extends object, Evidence> {
  readonly #ledger = new RecoveryAttemptLedger<Tab>();
  readonly #ports: RecoveryBudgetPorts<Tab, Evidence>;

  constructor(ports: RecoveryBudgetPorts<Tab, Evidence>) {
    this.#ports = ports;
  }

  get attemptCount(): number {
    return this.#ledger.attemptCount;
  }

  charge(
    registration: RegistrationRecord<Tab, Evidence>,
    tab: Tab,
    at: number,
    windowMs: number,
  ): readonly number[] | false {
    if (!this.#ports.isRegistrationCurrent(registration)) {
      return false;
    }
    const attempts = Object.freeze(this.#ledger.charge(tab, at, windowMs));
    this.#ports.onBudgetChanged();
    return attempts;
  }

  hasAttempts(registration: RegistrationRecord<Tab, Evidence>): boolean {
    return this.#ports.isRegistrationCurrent(registration) && this.#ledger.hasAttempts;
  }

  recent(
    registration: RegistrationRecord<Tab, Evidence>,
    tab: Tab,
    now: number,
    windowMs: number,
  ): readonly number[] {
    if (!this.#ports.isRegistrationCurrent(registration)) {
      return [];
    }
    return Object.freeze(this.#ledger.recent(tab, now, windowMs));
  }

  reset(registration: RegistrationRecord<Tab, Evidence>): boolean {
    if (!this.#ports.isRegistrationCurrent(registration)) {
      return false;
    }
    if (this.#ledger.reset() === 0) {
      return false;
    }
    this.#ports.onBudgetChanged();
    return true;
  }
}
