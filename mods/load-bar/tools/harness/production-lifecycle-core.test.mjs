import { describe, expect, it } from "vitest";
import { validateProductionLifecycleEvidence } from "./production-lifecycle-core.mjs";

const snapshot = overrides => ({
  activeRecords: 0,
  live: true,
  pendingTimers: 0,
  pendingWaits: 0,
  started: true,
  stopReason: null,
  visibleRecords: 0,
  ...overrides,
});

const reload = phase => {
  const survivesReload = phase === "waiting" || phase === "visible";
  return {
    after: {
      count: survivesReload ? 1 : 0,
      marker: `new-${phase}`,
      oldConnected: false,
      oldSnapshot: snapshot({ live: false, stopReason: "sine-unload" }),
      snapshot: snapshot({
        activeRecords: survivesReload ? 1 : 0,
        pendingTimers: phase === "waiting" ? 1 : 0,
        visibleRecords: survivesReload ? 1 : 0,
      }),
      token: `new-${phase}`,
    },
    atStop: {
      lineConnected: true,
      marker: `old-${phase}`,
      phase,
      snapshot: snapshot({
        activeRecords: 1,
        live: false,
        stopReason: "sine-unload",
        visibleRecords: 1,
      }),
    },
    before: {
      count: 1,
      marker: `old-${phase}`,
      phase,
      snapshot: snapshot({
        activeRecords: 1,
        pendingTimers: phase === "visible" ? 0 : 1,
        visibleRecords: 1,
      }),
      token: `old-${phase}`,
    },
    phase,
    stale: { settingsAccepted: false, stopAccepted: false },
  };
};

const evidence = () => ({
  disable: {
    enabled: false,
    marker: null,
    nativeDisplay: "block",
    snapshot: snapshot({ live: false, stopReason: "sine-unload" }),
    totalLines: 0,
  },
  reloads: ["waiting", "visible", "completing", "canceling"].map(reload),
});

describe("production lifecycle evidence", () => {
  it("accepts exact phase reloads and a complete final drain", () => {
    expect(validateProductionLifecycleEvidence(evidence())).toEqual({
      failures: [],
      ok: true,
    });
  });

  it("rejects a missing or duplicate phase", () => {
    const value = evidence();
    value.reloads[3] = reload("visible");

    expect(validateProductionLifecycleEvidence(value).ok).toBe(false);
  });

  it("rejects teardown that starts after its captured line settled", () => {
    const value = evidence();
    value.reloads[2].atStop.lineConnected = false;
    value.reloads[2].atStop.phase = null;

    expect(validateProductionLifecycleEvidence(value).ok).toBe(false);
  });

  it("rejects stale facade work or an old resource that survives replacement", () => {
    const value = evidence();
    value.reloads[0].stale.settingsAccepted = true;
    value.reloads[1].after.oldSnapshot.activeRecords = 1;

    expect(validateProductionLifecycleEvidence(value).ok).toBe(false);
  });

  it("rejects a final disable that leaves native ownership or resources behind", () => {
    const value = evidence();
    value.disable.marker = "generation";
    value.disable.snapshot.pendingTimers = 1;

    expect(validateProductionLifecycleEvidence(value).ok).toBe(false);
  });
});
