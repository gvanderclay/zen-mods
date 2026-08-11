import { describe, expect, it } from "vitest";
import { runApplicationStress } from "./application-stress.ts";

describe("M17 production application-owner stress", () => {
  it("serializes and drains a seeded mixed-event burst", async () => {
    const result = await runApplicationStress({
      events: 1_000,
      replayEvent: null,
      seed: 184467,
      tabs: 64,
    });

    expect(result).toMatchObject({
      completedEvents: 1_000,
      expectedEvents: 1_000,
      finalOwner: {
        activeCount: 0,
        keyRecords: 0,
        registrationCount: 0,
      },
      maxActive: 1,
      preferenceDrift: false,
      seed: 184467,
    });
    expect(result.maxKeyRecords).toBeLessThanOrEqual(66);
    expect(result.receipts.completed + result.receipts.canceled).toBeGreaterThan(0);
    expect(result.traceTail.length).toBeGreaterThan(0);
    expect(result.traceTail.length).toBeLessThanOrEqual(200);
  });

  it("stops at an exact replay event while retaining the same prefix", async () => {
    const full = await runApplicationStress({
      events: 200,
      replayEvent: null,
      seed: 97,
      tabs: 32,
    });
    const replay = await runApplicationStress({
      events: 200,
      replayEvent: 73,
      seed: 97,
      tabs: 32,
    });

    expect(replay.completedEvents).toBe(73);
    expect(replay.expectedEvents).toBe(73);
    expect(replay.scheduleHash).not.toBe(full.scheduleHash);
    expect(replay.schedulePrefixHash).toBe(full.schedulePrefixHashes[72]);
  });
});
