import { describe, expect, it } from "vitest";
import { PulseClaims, type PulseRecord } from "./pulse-claims.ts";

interface Tab {
  id: string;
}

const idle: PulseRecord = { heldSince: null, lastPulseAt: null };

describe("PulseClaims", () => {
  it("enumerates only active claims owned by the current generation", () => {
    const claims = new PulseClaims<Tab>();
    const first = {};
    const second = {};
    const tabA = { id: "a" };
    const tabB = { id: "b" };

    expect(claims.set(tabA, first, { heldSince: 10, lastPulseAt: 10 })).toBe(true);
    expect(claims.set(tabB, second, { heldSince: 20, lastPulseAt: 20 })).toBe(true);

    expect(claims.active(first)).toEqual([[tabA, { heldSince: 10, lastPulseAt: 10 }]]);
    expect(claims.active(second)).toEqual([[tabB, { heldSince: 20, lastPulseAt: 20 }]]);
    expect(claims.activeCount(first)).toBe(1);
  });

  it("rejects stale ownership and permits a replacement after release", () => {
    const claims = new PulseClaims<Tab>();
    const oldOwner = {};
    const newOwner = {};
    const tab = { id: "mail" };

    expect(claims.set(tab, oldOwner, { heldSince: 10, lastPulseAt: 10 })).toBe(true);
    expect(claims.set(tab, newOwner, { heldSince: 20, lastPulseAt: 20 })).toBe(false);
    expect(claims.forget(tab, newOwner)).toBe(false);
    expect(claims.forget(tab, oldOwner)).toBe(true);
    expect(claims.set(tab, newOwner, { heldSince: 30, lastPulseAt: 30 })).toBe(true);
    expect(claims.active(newOwner)).toEqual([[tab, { heldSince: 30, lastPulseAt: 30 }]]);
  });

  it("keeps timing metadata while dropping the active docshell claim", () => {
    const claims = new PulseClaims<Tab>();
    const owner = {};
    const tab = { id: "calendar" };

    claims.set(tab, owner, { heldSince: 10, lastPulseAt: 10 });
    expect(claims.forget(tab, owner)).toBe(true);
    expect(claims.get(tab)).toEqual({ heldSince: null, lastPulseAt: 10 });
    expect(claims.active(owner)).toEqual([]);
  });

  it("reads one tab's record with exact generation ownership", () => {
    const claims = new PulseClaims<Tab>();
    const owner = {};
    const replacement = {};
    const tab = { id: "calendar" };

    claims.set(tab, owner, { heldSince: 10, lastPulseAt: 10 });

    expect(claims.owned(tab, owner)).toEqual({ heldSince: 10, lastPulseAt: 10 });
    expect(claims.owned(tab, replacement)).toEqual({
      heldSince: null,
      lastPulseAt: 10,
    });
  });

  it("removes closed or unpinned records so the ledger does not retain them", () => {
    const claims = new PulseClaims<Tab>();
    const owner = {};
    const tab = { id: "slack" };

    claims.set(tab, owner, { heldSince: 10, lastPulseAt: 10 });
    expect(claims.remove(tab, owner)).toBe(true);
    expect(claims.get(tab)).toEqual(idle);
    expect(claims.activeCount(owner)).toBe(0);
    expect(claims.remove(tab, owner)).toBe(true);
  });

  it("does not allow a stale owner to remove a replacement claim", () => {
    const claims = new PulseClaims<Tab>();
    const oldOwner = {};
    const newOwner = {};
    const tab = { id: "mail" };

    claims.set(tab, oldOwner, { heldSince: 10, lastPulseAt: 10 });
    claims.forget(tab, oldOwner);
    claims.set(tab, newOwner, { heldSince: 30, lastPulseAt: 30 });

    expect(claims.remove(tab, oldOwner)).toBe(false);
    expect(claims.active(newOwner)).toEqual([[tab, { heldSince: 30, lastPulseAt: 30 }]]);
  });

  it("exposes unresolved ownership so a replacement generation can retry cleanup", () => {
    const claims = new PulseClaims<Tab>();
    const oldOwner = {};
    const tab = { id: "mail" };

    claims.set(tab, oldOwner, { heldSince: 10, lastPulseAt: 10 });

    expect(claims.allActive()).toEqual([
      [tab, oldOwner, { heldSince: 10, lastPulseAt: 10 }],
    ]);
  });
});
