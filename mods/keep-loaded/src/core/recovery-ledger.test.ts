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
});
