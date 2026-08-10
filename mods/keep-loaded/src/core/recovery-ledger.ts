import { recentAttempts } from "./recovery.ts";

/**
 * The crash budget belongs to the application owner, but its policy is still pure:
 * timestamps are keyed by the exact tab object and a weak key means a closed tab
 * cannot be retained merely because it once crashed.
 */
export class RecoveryAttemptLedger<Tab extends object> {
  readonly #attempts = new WeakMap<Tab, number[]>();

  recent(tab: Tab, now: number, windowMs: number): number[] {
    const retained = recentAttempts(this.#attempts.get(tab) ?? [], now, windowMs);
    if (retained.length === 0) {
      this.#attempts.delete(tab);
    } else {
      this.#attempts.set(tab, retained);
    }
    return [...retained];
  }

  charge(tab: Tab, at: number, windowMs: number): number[] {
    const retained = this.recent(tab, at, windowMs);
    const charged = [...retained, at];
    this.#attempts.set(tab, charged);
    return [...charged];
  }

  clear(tab: Tab): void {
    this.#attempts.delete(tab);
  }
}
