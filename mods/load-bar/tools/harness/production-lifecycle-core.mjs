const PHASES = ["waiting", "visible", "completing", "canceling"];

const isObject = value => value !== null && typeof value === "object";

export const validateProductionLifecycleEvidence = evidence => {
  const failures = [];
  const require = (condition, message) => {
    if (!condition) failures.push(message);
  };
  const requireSnapshot = (value, path, expected) => {
    require(isObject(value), `${path} must be an object`);
    if (!isObject(value)) return;
    for (const [key, expectedValue] of Object.entries(expected)) {
      require(value[key] ===
        expectedValue, `${path}.${key} must equal ${String(expectedValue)}`);
    }
  };

  require(isObject(evidence), "lifecycle evidence must be an object");
  if (!isObject(evidence)) return { failures, ok: false };

  require(Array.isArray(evidence.reloads), "reloads must be an array");
  const reloads = Array.isArray(evidence.reloads) ? evidence.reloads : [];
  require(reloads.length === PHASES.length, "reloads must contain four phase records");
  require(new Set(reloads.map(value => value?.phase)).size === PHASES.length &&
    PHASES.every(phase =>
      reloads.some(value => value?.phase === phase),
    ), "reloads must contain each phase exactly once");

  for (const phase of PHASES) {
    const path = `reloads.${phase}`;
    const value = reloads.find(record => record?.phase === phase);
    require(isObject(value), `${path} must exist`);
    if (!isObject(value)) continue;
    const before = value.before;
    const atStop = value.atStop;
    const after = value.after;
    const expectedCurrentRecords = phase === "waiting" || phase === "visible" ? 1 : 0;

    require(before?.phase === phase, `${path}.before.phase must equal ${phase}`);
    require(before?.count === 1, `${path}.before.count must equal 1`);
    require(typeof before?.token === "string" &&
      before.token.length > 0, `${path}.before.token must be non-empty`);
    require(before?.marker ===
      before?.token, `${path}.before marker must match its token`);
    requireSnapshot(before?.snapshot, `${path}.before.snapshot`, {
      activeRecords: 1,
      live: true,
      pendingTimers: phase === "visible" ? 0 : 1,
      pendingWaits: 0,
      started: true,
      stopReason: null,
      visibleRecords: 1,
    });

    require(atStop?.phase === phase, `${path}.atStop.phase must equal ${phase}`);
    require(atStop?.lineConnected ===
      true, `${path}.atStop line must still be connected`);
    require(atStop?.marker ===
      before?.token, `${path}.atStop marker must still belong to old token`);
    requireSnapshot(atStop?.snapshot, `${path}.atStop.snapshot`, {
      activeRecords: 1,
      live: false,
      pendingTimers: 0,
      pendingWaits: 0,
      started: true,
      stopReason: "sine-unload",
      visibleRecords: 1,
    });

    require(typeof after?.token === "string" &&
      after.token.length > 0, `${path}.after.token must be non-empty`);
    require(after?.token !== before?.token, `${path} replacement token must change`);
    require(after?.marker ===
      after?.token, `${path}.after marker must match replacement token`);
    require(after?.count === expectedCurrentRecords, `${path}.after line count is wrong`);
    require(after?.oldConnected === false, `${path}.after old line must be disconnected`);
    requireSnapshot(after?.oldSnapshot, `${path}.after.oldSnapshot`, {
      activeRecords: 0,
      live: false,
      pendingTimers: 0,
      pendingWaits: 0,
      started: true,
      stopReason: "sine-unload",
      visibleRecords: 0,
    });
    requireSnapshot(after?.snapshot, `${path}.after.snapshot`, {
      activeRecords: expectedCurrentRecords,
      live: true,
      pendingTimers: phase === "waiting" ? 1 : 0,
      pendingWaits: 0,
      started: true,
      stopReason: null,
      visibleRecords: expectedCurrentRecords,
    });
    require(value.stale?.settingsAccepted ===
      false, `${path} stale settings must be rejected`);
    require(value.stale?.stopAccepted === false, `${path} stale stop must be rejected`);
  }

  const disable = evidence.disable;
  require(isObject(disable), "disable must be an object");
  if (isObject(disable)) {
    require(disable.enabled === false, "disable must leave the mod disabled");
    require(disable.marker === null, "disable must remove the owner marker");
    require(disable.totalLines === 0, "disable must remove every custom line");
    require(disable.nativeDisplay !== null &&
      disable.nativeDisplay !== "none", "disable must expose native activity");
    requireSnapshot(disable.snapshot, "disable.snapshot", {
      activeRecords: 0,
      live: false,
      pendingTimers: 0,
      pendingWaits: 0,
      started: true,
      stopReason: "sine-unload",
      visibleRecords: 0,
    });
  }

  return { failures, ok: failures.length === 0 };
};
