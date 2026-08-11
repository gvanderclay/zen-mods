import { describe, expect, it } from "vitest";
import { RecoveryAttemptLedger } from "./recovery-ledger.ts";

interface Tab {
  id: string;
}

const WINDOW = 60_000;

describe("RecoveryAttemptLedger", () => {
  it("keeps attempts by tab identity and prunes old and future stamps", () => {
    const ledger = new RecoveryAttemptLedger<Tab>();
    const tab = { id: "mail" };
    const other = { id: "other" };

    ledger.charge(tab, 10_000, WINDOW);
    ledger.charge(tab, 20_000, WINDOW);
    ledger.charge(other, 20_000, WINDOW);

    expect(ledger.recent(tab, 19_000, WINDOW)).toEqual([10_000]);
    ledger.charge(tab, 20_000, WINDOW);
    expect(ledger.recent(tab, 79_000, WINDOW)).toEqual([20_000]);
    expect(ledger.recent(other, 20_000, WINDOW)).toEqual([20_000]);
  });

  it("preserves a tab's ledger when the caller generation is replaced", () => {
    const ledger = new RecoveryAttemptLedger<Tab>();
    const tab = { id: "mail" };

    ledger.charge(tab, 1_000, WINDOW);
    expect(ledger.recent(tab, 2_000, WINDOW)).toEqual([1_000]);
    expect(ledger.charge(tab, 3_000, WINDOW)).toEqual([1_000, 3_000]);
  });

  it("does not retain a strong tab reference after it is forgotten", () => {
    const ledger = new RecoveryAttemptLedger<Tab>();
    const tab = { id: "mail" };

    ledger.charge(tab, 1_000, WINDOW);
    ledger.clear(tab);

    expect(ledger.recent(tab, 2_000, WINDOW)).toEqual([]);
  });

  it("reports live attempt ownership and atomically resets the whole process history", () => {
    const ledger = new RecoveryAttemptLedger<Tab>();
    const first = { id: "first" };
    const second = { id: "second" };

    ledger.charge(first, 10_000, WINDOW);
    ledger.charge(second, 20_000, WINDOW);

    expect(ledger.attemptCount).toBe(2);
    expect(ledger.hasAttempts).toBe(true);
    expect(ledger.reset()).toBe(2);
    expect(ledger.attemptCount).toBe(0);
    expect(ledger.hasAttempts).toBe(false);
    expect(ledger.recent(first, 30_000, WINDOW)).toEqual([]);
    expect(ledger.recent(second, 30_000, WINDOW)).toEqual([]);
    expect(ledger.reset()).toBe(0);
  });

  it("keeps its live count accurate when attempts age out or one tab is cleared", () => {
    const ledger = new RecoveryAttemptLedger<Tab>();
    const first = { id: "first" };
    const second = { id: "second" };

    ledger.charge(first, 10_000, WINDOW);
    ledger.charge(first, 20_000, WINDOW);
    ledger.charge(second, 30_000, WINDOW);
    expect(ledger.attemptCount).toBe(3);

    expect(ledger.recent(first, 75_001, WINDOW)).toEqual([20_000]);
    expect(ledger.attemptCount).toBe(2);
    ledger.clear(first);
    expect(ledger.attemptCount).toBe(1);
    expect(ledger.hasAttempts).toBe(true);
    ledger.clear(second);
    expect(ledger.attemptCount).toBe(0);
    expect(ledger.hasAttempts).toBe(false);
  });
});
