/** Fail-closed evidence checks for the production multi-window shipped-bundle gate. */

const freeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
};

const isPlainObject = value => {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const canonicalize = (value, path = "value") => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => canonicalize(entry, `${path}[${index}]`));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonicalize(value[key], `${path}.${key}`)]),
    );
  }
  throw new TypeError(`${path} must contain only finite JSON values`);
};

const sameJson = (left, right) => {
  try {
    return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
  } catch {
    return false;
  }
};

export const REQUIRED_ASSERTIONS = Object.freeze([
  "exact stamped platform is running",
  "production mod starts disabled",
  "manifest retains supportsUnload",
  "G1 first lease creates one widget shared by both windows",
  "original true wake restores true after global serialization",
  "original false wake remains false without a true write",
  "two-window production sweeps serialize and coalesce",
  "real G1 creator callbacks are captured before reload",
  "Sine reload replaces both live generations on the stable owner",
  "retained G1 facade fill cannot mutate either G2 window",
  "retained G1 widget view callback cannot mutate either G2 window",
  "retained G1 panel disposer cannot mutate either G2 window",
  "retained G1 wake completion cannot mutate either G2 window",
  "native B close drains only that production generation",
  "native B close preserves creator A widget and panel",
  "active Sine disable drains every owned production resource",
  "last active registration disable destroys the application widget",
  "disabled pulse schedule cannot fire into the replacement generation",
  "supportsUnload is justified by the complete final drain",
]);

export const REQUIRED_FORCE_KEYS = Object.freeze([
  "facadeFill",
  "viewShowing",
  "panelDisposer",
  "wakeCompletion",
]);

const addFailure = (failures, path, message) => failures.push({ path, message });

const requireBoolean = (value, path, failures) => {
  if (value !== true) addFailure(failures, path, "must be true");
};

const requireZero = (value, path, failures) => {
  if (value !== 0) addFailure(failures, path, "must be zero");
};

const hasDistinctRegistrationIds = value =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(id => typeof id === "string" && id !== "") &&
  new Set(value).size === value.length;

const requireExactRegistrationIds = (actual, path, expected, failures) => {
  if (!hasDistinctRegistrationIds(actual)) {
    addFailure(failures, path, "must contain distinct non-empty registration IDs");
    return;
  }
  if (!hasDistinctRegistrationIds(expected)) {
    addFailure(
      failures,
      path,
      "cannot bind to the captured distinct G1 registration IDs",
    );
    return;
  }
  if (!sameJson([...actual].sort(), [...expected].sort())) {
    addFailure(failures, path, "must equal the captured G1 registration ID set");
  }
};

const requireOwnerRegistrationIdentity = (
  owner,
  path,
  expectedRegistrationIds,
  expectedApplicationId,
  failures,
) => {
  if (!isPlainObject(owner)) {
    addFailure(failures, path, "must be an owner snapshot");
    return;
  }
  requireExactRegistrationIds(
    owner.registrationIds,
    `${path}.registrationIds`,
    expectedRegistrationIds,
    failures,
  );
  requireExactRegistrationIds(
    owner.statusWidgetLeaseIds,
    `${path}.statusWidgetLeaseIds`,
    expectedRegistrationIds,
    failures,
  );
  if (hasDistinctRegistrationIds(expectedRegistrationIds)) {
    if (owner.registrationCount !== expectedRegistrationIds.length) {
      addFailure(
        failures,
        `${path}.registrationCount`,
        "must retain every captured registration",
      );
    }
    if (owner.statusWidgetLeases !== expectedRegistrationIds.length) {
      addFailure(
        failures,
        `${path}.statusWidgetLeases`,
        "must retain every captured widget lease",
      );
    }
  }
  if (typeof expectedApplicationId !== "string" || expectedApplicationId === "") {
    addFailure(
      failures,
      `${path}.applicationId`,
      "cannot bind to the captured non-empty G1 application ID",
    );
  } else if (owner.applicationId !== expectedApplicationId) {
    addFailure(
      failures,
      `${path}.applicationId`,
      "must retain the captured G1 application ID",
    );
  }
};

const requireIdleOwner = (owner, path, failures, { registrations, phase }) => {
  if (!isPlainObject(owner)) {
    addFailure(failures, path, "must be an object");
    return;
  }
  if (owner.protocol !== 11) {
    addFailure(failures, `${path}.protocol`, "must be protocol 11");
  }
  if (
    !Array.isArray(registrations) ||
    registrations.some(
      registration => typeof registration !== "string" || registration === "",
    ) ||
    new Set(registrations).size !== registrations.length
  ) {
    addFailure(
      failures,
      path,
      "must be checked against distinct non-empty registrations",
    );
    return;
  }
  if (owner.registrationCount !== registrations.length) {
    addFailure(failures, `${path}.registrationCount`, `must be ${registrations.length}`);
  }
  if (owner.statusWidgetLeases !== registrations.length) {
    addFailure(failures, `${path}.statusWidgetLeases`, `must be ${registrations.length}`);
  }
  if (owner.statusWidgetPhase !== phase) {
    addFailure(failures, `${path}.statusWidgetPhase`, `must be ${phase}`);
  }
  for (const key of ["registrationIds", "statusWidgetLeaseIds"]) {
    const actual = owner[key];
    if (
      !Array.isArray(actual) ||
      actual.length !== registrations.length ||
      new Set(actual).size !== actual.length
    ) {
      addFailure(failures, `${path}.${key}`, "must contain every live registration once");
      continue;
    }
    for (const registration of registrations) {
      if (!actual.includes(registration)) {
        addFailure(failures, `${path}.${key}`, `must contain ${registration}`);
      }
    }
  }
  if (
    !Array.isArray(owner.registrationIds) ||
    !Array.isArray(owner.statusWidgetLeaseIds) ||
    !sameJson([...owner.registrationIds].sort(), [...owner.statusWidgetLeaseIds].sort())
  ) {
    addFailure(
      failures,
      `${path}.statusWidgetLeaseIds`,
      "must equal the duplicate-free registration ID set",
    );
  }
  for (const key of [
    "activeCount",
    "drainingCount",
    "keyRecords",
    "readyCount",
    "sweepRecords",
    "trailingCount",
    "wakeCandidates",
  ]) {
    requireZero(owner[key], `${path}.${key}`, failures);
  }
  if (owner.activeKind !== null)
    addFailure(failures, `${path}.activeKind`, "must be null");
  if (owner.wakePhase !== "idle")
    addFailure(failures, `${path}.wakePhase`, "must be idle");
};

const requireCurrentTwoWindows = (state, path, failures, expected = null) => {
  if (!isPlainObject(state)) {
    addFailure(failures, path, "must be an object");
    return;
  }
  const windows = state.windows;
  if (!isPlainObject(windows)) {
    addFailure(failures, `${path}.windows`, "must be an object");
    return;
  }
  const registrations = [];
  const namedRegistrationIds = {};
  for (const key of ["a", "b"]) {
    const current = windows[key];
    if (!isPlainObject(current)) {
      addFailure(failures, `${path}.windows.${key}`, "must be an object");
      continue;
    }
    for (const property of ["controller", "facade", "view"]) {
      requireBoolean(current[property], `${path}.windows.${key}.${property}`, failures);
    }
    if (typeof current.registrationId !== "string" || current.registrationId === "") {
      addFailure(failures, `${path}.windows.${key}.registrationId`, "must be non-empty");
    } else {
      registrations.push(current.registrationId);
      namedRegistrationIds[key] = current.registrationId;
    }
    const panel = current.panel;
    if (
      !isPlainObject(panel) ||
      typeof panel.heading !== "string" ||
      panel.heading === "" ||
      typeof panel.action !== "string" ||
      panel.action === ""
    ) {
      addFailure(
        failures,
        `${path}.windows.${key}.panel`,
        "must be a filled current panel",
      );
    }
  }
  if (new Set(registrations).size !== 2) {
    addFailure(failures, `${path}.windows`, "must retain two distinct registrations");
  }
  const widget = state.widget;
  if (!isPlainObject(widget) || widget.provider !== "api" || widget.placement !== true) {
    addFailure(failures, `${path}.widget`, "must retain the application widget");
  }
  requireIdleOwner(state.owner, `${path}.owner`, failures, {
    phase: "present",
    registrations,
  });
  if (expected) {
    if (state.owner?.applicationId !== expected.applicationId) {
      addFailure(failures, `${path}.owner.applicationId`, "must retain the G2 owner");
    }
    if (!sameJson([...registrations].sort(), [...expected.registrationIds].sort())) {
      addFailure(
        failures,
        `${path}.windows`,
        "must retain exactly the two G2 registrations",
      );
    }
    for (const key of ["a", "b"]) {
      const expectedRegistrationId = expected[`${key}RegistrationId`];
      if (
        typeof expectedRegistrationId !== "string" ||
        expectedRegistrationId === "" ||
        namedRegistrationIds[key] !== expectedRegistrationId
      ) {
        addFailure(
          failures,
          `${path}.windows.${key}.registrationId`,
          "must retain the named current G2 registration",
        );
      }
    }
  }
};

const requirePreferenceLane = (
  lane,
  path,
  failures,
  expected,
  expectedRegistrationIds,
  expectedApplicationId,
) => {
  if (!isPlainObject(lane)) {
    addFailure(failures, path, "must be an object");
    return;
  }
  if (lane.initial !== expected)
    addFailure(failures, `${path}.initial`, `must be ${expected}`);
  if (lane.final !== expected)
    addFailure(failures, `${path}.final`, `must be ${expected}`);
  requireBoolean(lane.wakeObserved, `${path}.wakeObserved`, failures);
  if (!Array.isArray(lane.transitions)) {
    addFailure(failures, `${path}.transitions`, "must be an array");
    return;
  }
  const expectedTransitions = expected ? [false, true, false, true] : [];
  if (!sameJson(lane.transitions, expectedTransitions)) {
    addFailure(
      failures,
      `${path}.transitions`,
      `must be ${JSON.stringify(expectedTransitions)}`,
    );
  }
  if (expected === true && lane.bHeldOnDemand !== false) {
    addFailure(
      failures,
      `${path}.bHeldOnDemand`,
      "must remain physically false while B is held",
    );
  }
  if (expected === true && lane.bHeldOnDemandBeforeRelease !== false) {
    addFailure(
      failures,
      `${path}.bHeldOnDemandBeforeRelease`,
      "must remain physically false immediately before B releases",
    );
  }
  if (expected === true) {
    const bHeldCandidate = lane.bHeldCandidate;
    if (
      !isPlainObject(bHeldCandidate) ||
      !Number.isInteger(bHeldCandidate.calls) ||
      bHeldCandidate.calls < 1 ||
      bHeldCandidate.callDelta !== 1 ||
      bHeldCandidate.connected !== true ||
      bHeldCandidate.pending !== true ||
      bHeldCandidate.inserted !== true ||
      bHeldCandidate.linkedPanel !== true
    ) {
      addFailure(
        failures,
        `${path}.bHeldCandidate`,
        "must retain B's physical fixture candidate through the pref hold",
      );
    }
  }
  const during = lane.ownerDuring;
  if (!isPlainObject(during)) {
    addFailure(failures, `${path}.ownerDuring`, "must record the held owner state");
  } else {
    if (
      during.activeCount !== 1 ||
      during.activeKind !== "sweep" ||
      during.keyRecords !== 1 ||
      during.wakeCandidates !== 1 ||
      during.wakePhase !== "waiting"
    ) {
      addFailure(
        failures,
        `${path}.ownerDuring`,
        "must show one real held sweep candidate",
      );
    }
    if (during.protocol !== 11) {
      addFailure(failures, `${path}.ownerDuring.protocol`, "must be protocol 11");
    }
    if (during.desiredOnDemand !== expected) {
      addFailure(
        failures,
        `${path}.ownerDuring.desiredOnDemand`,
        `must remain ${expected}`,
      );
    }
  }
  if (isPlainObject(during)) {
    requireOwnerRegistrationIdentity(
      during,
      `${path}.ownerDuring`,
      expectedRegistrationIds,
      expectedApplicationId,
      failures,
    );
  }
  const heldCandidate = lane.heldCandidate;
  if (
    !isPlainObject(heldCandidate) ||
    !Number.isInteger(heldCandidate.calls) ||
    heldCandidate.calls < 1 ||
    heldCandidate.callDelta !== 1 ||
    heldCandidate.connected !== true ||
    heldCandidate.pending !== true ||
    heldCandidate.inserted !== true ||
    heldCandidate.linkedPanel !== true
  ) {
    addFailure(
      failures,
      `${path}.heldCandidate`,
      "must retain one physical fixture candidate while the wake is held",
    );
  }
  const after = lane.ownerAfter;
  requireExactRegistrationIds(
    lane.expectedRegistrationIds,
    `${path}.expectedRegistrationIds`,
    expectedRegistrationIds,
    failures,
  );
  requireOwnerRegistrationIdentity(
    after,
    `${path}.ownerAfter`,
    expectedRegistrationIds,
    expectedApplicationId,
    failures,
  );
  requireIdleOwner(after, `${path}.ownerAfter`, failures, {
    phase: "present",
    registrations: expectedRegistrationIds,
  });
  if (after?.desiredOnDemand !== expected) {
    addFailure(failures, `${path}.ownerAfter.desiredOnDemand`, `must remain ${expected}`);
  }
};

const requireSentinel = (sentinel, path, failures) => {
  if (!isPlainObject(sentinel)) {
    addFailure(failures, path, "must be an object");
    return;
  }
  if (sentinel.deferCalls !== 1) {
    addFailure(failures, `${path}.deferCalls`, "must run exactly once");
  }
  if (sentinel.timerFired !== false) {
    addFailure(failures, `${path}.timerFired`, "must stay false");
  }
  requireBoolean(sentinel.waitStopped, `${path}.waitStopped`, failures);
};

/**
 * Validate raw browser evidence independently of the browser-side assertion booleans.
 * The aggregate gate has to prove both preference lanes, exact G2 preservation after
 * each retained G1 path, and a drain that makes `supportsUnload` credible.
 */
export const validateMultiWindowEvidence = evidence => {
  const failures = [];
  if (!isPlainObject(evidence)) {
    return freeze({
      failures: [{ path: "evidence", message: "must be an object" }],
      ok: false,
    });
  }

  if (evidence.manifest?.supportsUnload !== true) {
    addFailure(
      failures,
      "manifest.supportsUnload",
      "must preserve the shipped manifest's supportsUnload: true",
    );
  }

  let g1RegistrationIds = null;
  let g1ApplicationId = null;
  const ownership = evidence.ownership;
  if (!isPlainObject(ownership)) {
    addFailure(failures, "ownership", "must be an object");
  } else {
    requireBoolean(ownership.sharedWidget, "ownership.sharedWidget", failures);
    requireBoolean(ownership.viewsDistinct, "ownership.viewsDistinct", failures);
    if (
      typeof ownership.creatorRegistrationId !== "string" ||
      ownership.creatorRegistrationId === ""
    ) {
      addFailure(failures, "ownership.creatorRegistrationId", "must be non-empty");
    }
    g1RegistrationIds = ownership.registrationIds;
    g1ApplicationId = ownership.owner?.applicationId ?? null;
    requireExactRegistrationIds(
      g1RegistrationIds,
      "ownership.registrationIds",
      g1RegistrationIds,
      failures,
    );
    if (Array.isArray(g1RegistrationIds) && g1RegistrationIds.length !== 2) {
      addFailure(
        failures,
        "ownership.registrationIds",
        "must capture exactly the two G1 registrations",
      );
    }
    if (typeof g1ApplicationId !== "string" || g1ApplicationId === "") {
      addFailure(
        failures,
        "ownership.owner.applicationId",
        "must capture the non-empty G1 application ID",
      );
    }
    requireIdleOwner(ownership.owner, "ownership.owner", failures, {
      phase: "present",
      registrations: g1RegistrationIds,
    });
    if (
      !ownership.owner?.registrationIds?.includes(ownership.creatorRegistrationId) ||
      ownership.owner.registrationCount !== 2
    ) {
      addFailure(
        failures,
        "ownership.creatorRegistrationId",
        "must belong to one of two live leases",
      );
    }
  }

  const preferences = evidence.preferences;
  if (!isPlainObject(preferences)) {
    addFailure(failures, "preferences", "must be an object");
  } else {
    requirePreferenceLane(
      preferences.trueOriginal,
      "preferences.trueOriginal",
      failures,
      true,
      g1RegistrationIds,
      g1ApplicationId,
    );
    requirePreferenceLane(
      preferences.falseOriginal,
      "preferences.falseOriginal",
      failures,
      false,
      g1RegistrationIds,
      g1ApplicationId,
    );
  }

  const serialization = evidence.serialization;
  if (!isPlainObject(serialization)) {
    addFailure(failures, "serialization", "must be an object");
  } else {
    if (serialization.maxActive !== 1) {
      addFailure(failures, "serialization.maxActive", "must be exactly one");
    }
    if (serialization.maxHeld !== 1) {
      addFailure(failures, "serialization.maxHeld", "must be exactly one");
    }
    requireBoolean(
      serialization.trailingObserved,
      "serialization.trailingObserved",
      failures,
    );
    const fanout = serialization.fanoutCalls;
    if (!isPlainObject(fanout) || fanout.a !== 1 || fanout.b !== 1) {
      addFailure(failures, "serialization.fanoutCalls", "must visit both windows once");
    }
    const trace = serialization.ownerTrace;
    if (!Array.isArray(trace) || trace.length < 4) {
      addFailure(
        failures,
        "serialization.ownerTrace",
        "must retain raw held, trailing, and idle owner samples",
      );
    } else {
      const requiredTracePhases = ["held-a", "held-b", "trailing", "idle"];
      const traceByPhase = new Map();
      for (const [index, entry] of trace.entries()) {
        if (!isPlainObject(entry)) {
          addFailure(
            failures,
            `serialization.ownerTrace[${index}]`,
            "must be an evidence object",
          );
          continue;
        }
        if (typeof entry.phase === "string" && !traceByPhase.has(entry.phase)) {
          traceByPhase.set(entry.phase, entry);
        }
        requireOwnerRegistrationIdentity(
          entry.owner,
          `serialization.ownerTrace[${index}].owner`,
          g1RegistrationIds,
          g1ApplicationId,
          failures,
        );
      }
      for (const phase of requiredTracePhases) {
        if (!traceByPhase.has(phase)) {
          addFailure(
            failures,
            "serialization.ownerTrace",
            `must include the ${phase} raw phase sample`,
          );
        }
      }
      for (const phase of ["held-a", "held-b"]) {
        const snapshot = traceByPhase.get(phase)?.owner;
        if (
          snapshot?.activeCount !== 1 ||
          snapshot?.activeKind !== "sweep" ||
          snapshot?.wakePhase !== "waiting"
        ) {
          addFailure(
            failures,
            "serialization.ownerTrace",
            `${phase} must record the held sweep`,
          );
        }
      }
      const trailingSnapshot = traceByPhase.get("trailing")?.owner;
      if (trailingSnapshot?.activeCount !== 1 || trailingSnapshot?.trailingCount !== 1) {
        addFailure(
          failures,
          "serialization.ownerTrace",
          "trailing must record one queued trailing sweep",
        );
      }
      const idleSnapshot = traceByPhase.get("idle")?.owner;
      requireIdleOwner(idleSnapshot, "serialization.ownerTrace.idle", failures, {
        phase: "present",
        registrations: g1RegistrationIds,
      });
      const samples = trace.map(entry => entry?.owner);
      if (samples.some(snapshot => !isPlainObject(snapshot))) {
        addFailure(
          failures,
          "serialization.ownerTrace",
          "must contain owner snapshots rather than asserted counters",
        );
      } else {
        const observedMaxActive = Math.max(
          ...samples.map(snapshot => snapshot.activeCount),
        );
        const observedMaxTrailing = Math.max(
          ...samples.map(snapshot => snapshot.trailingCount),
        );
        if (serialization.maxActive !== observedMaxActive || observedMaxActive !== 1) {
          addFailure(
            failures,
            "serialization.maxActive",
            "must equal the raw owner trace maximum of one",
          );
        }
        if (
          serialization.maxTrailing !== observedMaxTrailing ||
          observedMaxTrailing !== 1
        ) {
          addFailure(
            failures,
            "serialization.maxTrailing",
            "must equal the raw owner trace trailing peak of one",
          );
        }
      }
    }
    requireExactRegistrationIds(
      serialization.expectedRegistrationIds,
      "serialization.expectedRegistrationIds",
      g1RegistrationIds,
      failures,
    );
    requireOwnerRegistrationIdentity(
      serialization.idle,
      "serialization.idle",
      g1RegistrationIds,
      g1ApplicationId,
      failures,
    );
    requireIdleOwner(serialization.idle, "serialization.idle", failures, {
      phase: "present",
      registrations: g1RegistrationIds,
    });
  }

  const capture = evidence.capture;
  if (!isPlainObject(capture)) {
    addFailure(failures, "capture", "must be an object");
  } else {
    for (const key of [
      "g1Facade",
      "g1View",
      "g1WidgetViewShowing",
      "g1PanelDisposer",
      "g1WakeCompletion",
    ]) {
      requireBoolean(capture[key], `capture.${key}`, failures);
    }
    if (
      !Number.isInteger(capture.priorSettleCalls) ||
      capture.priorSettleCalls < 2 ||
      capture.passthroughSettleCalls !== capture.priorSettleCalls
    ) {
      addFailure(
        failures,
        "capture.priorSettleCalls",
        "must show the two preference rounds passed through before one armed capture",
      );
    }
  }

  const reload = evidence.reload;
  let g2Identity = null;
  if (!isPlainObject(reload)) {
    addFailure(failures, "reload", "must be an object");
  } else {
    for (const key of [
      "applicationPreserved",
      "controllersReplaced",
      "g1Stopped",
      "registrationsReplaced",
      "viewsReplaced",
    ]) {
      requireBoolean(reload[key], `reload.${key}`, failures);
    }
    const g1 = reload.g1RegistrationIds;
    const g2 = reload.g2RegistrationIds;
    const g2ARegistrationId = reload.g2ARegistrationId;
    const g2BRegistrationId = reload.g2BRegistrationId;
    if (
      !Array.isArray(g1) ||
      g1.length !== 2 ||
      new Set(g1).size !== 2 ||
      g1.some(id => typeof id !== "string" || id === "")
    ) {
      addFailure(
        failures,
        "reload.g1RegistrationIds",
        "must contain two distinct G1 IDs",
      );
    }
    if (
      !Array.isArray(g2) ||
      g2.length !== 2 ||
      new Set(g2).size !== 2 ||
      g2.some(id => typeof id !== "string" || id === "")
    ) {
      addFailure(
        failures,
        "reload.g2RegistrationIds",
        "must contain two distinct G2 IDs",
      );
    }
    if (
      typeof g2ARegistrationId !== "string" ||
      g2ARegistrationId === "" ||
      typeof g2BRegistrationId !== "string" ||
      g2BRegistrationId === "" ||
      g2ARegistrationId === g2BRegistrationId
    ) {
      addFailure(
        failures,
        "reload.g2ARegistrationId",
        "must name distinct non-empty G2 A and B registrations",
      );
    } else if (
      !Array.isArray(g2) ||
      !sameJson([...g2].sort(), [g2ARegistrationId, g2BRegistrationId].sort())
    ) {
      addFailure(
        failures,
        "reload.g2RegistrationIds",
        "must equal the named G2 A and B registration set",
      );
    }
    if (Array.isArray(g1) && Array.isArray(g2) && g1.some(id => g2.includes(id))) {
      addFailure(failures, "reload.g2RegistrationIds", "must not overlap G1 IDs");
    }
    if (
      typeof reload.g1ApplicationId !== "string" ||
      reload.g1ApplicationId === "" ||
      reload.g1ApplicationId !== reload.g2ApplicationId
    ) {
      addFailure(
        failures,
        "reload.g2ApplicationId",
        "must equal the non-empty G1 owner ID",
      );
    }
    if (
      !Array.isArray(g1) ||
      !Array.isArray(g1RegistrationIds) ||
      !sameJson([...g1].sort(), [...g1RegistrationIds].sort())
    ) {
      addFailure(
        failures,
        "reload.g1RegistrationIds",
        "must equal the captured ownership registration IDs",
      );
    }
    if (reload.g1ApplicationId !== g1ApplicationId) {
      addFailure(
        failures,
        "reload.g1ApplicationId",
        "must equal the captured ownership application ID",
      );
    }
    if (
      Array.isArray(g2) &&
      typeof reload.g2ApplicationId === "string" &&
      typeof g2ARegistrationId === "string" &&
      g2ARegistrationId !== "" &&
      typeof g2BRegistrationId === "string" &&
      g2BRegistrationId !== ""
    ) {
      g2Identity = {
        aRegistrationId: g2ARegistrationId,
        applicationId: reload.g2ApplicationId,
        bRegistrationId: g2BRegistrationId,
        registrationIds: g2,
      };
    }
    requireCurrentTwoWindows(reload.current, "reload.current", failures, g2Identity);
  }

  const forces = evidence.forces;
  if (!isPlainObject(forces)) {
    addFailure(failures, "forces", "must be an object");
  } else {
    for (const key of REQUIRED_FORCE_KEYS) {
      const force = forces[key];
      const path = `forces.${key}`;
      if (!isPlainObject(force)) {
        addFailure(failures, path, "must be an object");
        continue;
      }
      requireBoolean(force.invoked, `${path}.invoked`, failures);
      requireBoolean(force.stable, `${path}.stable`, failures);
      if (force.error !== null) addFailure(failures, `${path}.error`, "must be null");
      requireZero(force.mutationDelta, `${path}.mutationDelta`, failures);
      const deltas = force.mutationDeltas;
      if (!isPlainObject(deltas) || deltas.a !== 0 || deltas.b !== 0) {
        addFailure(
          failures,
          `${path}.mutationDeltas`,
          "must record zero MutationObserver delivery in both G2 views",
        );
      }
      if (!sameJson(force.before, force.after)) {
        addFailure(failures, path, "must preserve an identical G2 A+B snapshot");
      }
      requireCurrentTwoWindows(force.before, `${path}.before`, failures, g2Identity);
      requireCurrentTwoWindows(force.after, `${path}.after`, failures, g2Identity);
    }
    const disposer = forces.panelDisposer;
    if (isPlainObject(disposer)) {
      requireBoolean(disposer.held, "forces.panelDisposer.held", failures);
      if (!Number.isInteger(disposer.stopCalls) || disposer.stopCalls < 1) {
        addFailure(
          failures,
          "forces.panelDisposer.stopCalls",
          "must observe G1 terminal stop",
        );
      }
    }
    const wake = forces.wakeCompletion?.completion;
    if (!isPlainObject(wake)) {
      addFailure(failures, "forces.wakeCompletion.completion", "must be an object");
    } else {
      for (const key of ["workSettled", "released", "settleFinished"]) {
        requireBoolean(wake[key], `forces.wakeCompletion.completion.${key}`, failures);
      }
      for (const key of ["readyCalls", "errorCalls"]) {
        requireZero(wake[key], `forces.wakeCompletion.completion.${key}`, failures);
      }
    }
  }

  const close = evidence.close;
  if (!isPlainObject(close)) {
    addFailure(failures, "close", "must be an object");
  } else {
    requireBoolean(close.secondaryClosed, "close.secondaryClosed", failures);
    const events = close.events;
    if (!isPlainObject(events)) {
      addFailure(failures, "close.events", "must record native-close event timing");
    } else {
      if (events.beforeUnloadSeen !== false) {
        addFailure(failures, "close.events.beforeUnloadSeen", "must be false");
      }
      if (
        !Number.isInteger(events.domwindowclosedSeq) ||
        !Number.isInteger(events.unloadSeq) ||
        !(events.domwindowclosedSeq < events.unloadSeq)
      ) {
        addFailure(
          failures,
          "close.events",
          "must sequence domwindowclosed before unload",
        );
      }
    }
    const controller = close.closedController;
    if (!isPlainObject(controller)) {
      addFailure(failures, "close.closedController", "must be an object");
    } else {
      requireBoolean(controller.stopped, "close.closedController.stopped", failures);
      requireZero(
        controller.pendingTimers,
        "close.closedController.pendingTimers",
        failures,
      );
      requireZero(
        controller.pendingWaits,
        "close.closedController.pendingWaits",
        failures,
      );
      if (controller.reason !== "window-unload") {
        addFailure(failures, "close.closedController.reason", "must be window-unload");
      }
    }
    if (!g2Identity || close.closedRegistrationId !== g2Identity.bRegistrationId) {
      addFailure(
        failures,
        "close.closedRegistrationId",
        "must identify the named G2 B registration closed natively",
      );
    }
    const closeRegistrationIds = g2Identity ? [g2Identity.aRegistrationId] : [];
    requireOwnerRegistrationIdentity(
      close.owner,
      "close.owner",
      closeRegistrationIds,
      g1ApplicationId,
      failures,
    );
    requireIdleOwner(close.owner, "close.owner", failures, {
      phase: "present",
      registrations: closeRegistrationIds,
    });
    if (close.owner?.registrationCount !== 1) {
      addFailure(failures, "close.owner.registrationCount", "must retain creator A");
    }
    if (!isPlainObject(close.creator)) {
      addFailure(failures, "close.creator", "must be an object");
    } else {
      requireBoolean(
        close.creator.widgetPreserved,
        "close.creator.widgetPreserved",
        failures,
      );
      requireBoolean(close.creator.panelFills, "close.creator.panelFills", failures);
      if (
        !g2Identity ||
        close.creator.registrationId !== g2Identity.aRegistrationId ||
        !close.owner?.registrationIds?.includes(close.creator.registrationId)
      ) {
        addFailure(
          failures,
          "close.creator.registrationId",
          "must identify the surviving G2 A registration",
        );
      }
    }
    const heldCandidate = close.heldCandidate;
    if (
      !isPlainObject(heldCandidate) ||
      heldCandidate.connected !== true ||
      heldCandidate.pending !== true ||
      heldCandidate.inserted !== true ||
      heldCandidate.linkedPanel !== true ||
      !Number.isInteger(heldCandidate.calls) ||
      heldCandidate.calls < 1 ||
      heldCandidate.callDelta !== 1
    ) {
      addFailure(
        failures,
        "close.heldCandidate",
        "must record the real B candidate held at native close",
      );
    }
  }

  const disable = evidence.disable;
  if (!isPlainObject(disable)) {
    addFailure(failures, "disable", "must be an object");
  } else {
    const active = disable.activeBeforeDisable;
    if (!isPlainObject(active)) {
      addFailure(failures, "disable.activeBeforeDisable", "must be an object");
    } else {
      const activeOwner = active.owner;
      const activeARegistrationIds = g2Identity ? [g2Identity.aRegistrationId] : [];
      if (!isPlainObject(activeOwner)) {
        addFailure(
          failures,
          "disable.activeBeforeDisable.owner",
          "must be an owner snapshot",
        );
      } else {
        requireOwnerRegistrationIdentity(
          activeOwner,
          "disable.activeBeforeDisable.owner",
          activeARegistrationIds,
          g1ApplicationId,
          failures,
        );
        for (const key of ["activeCount", "keyRecords", "wakeCandidates"]) {
          if (activeOwner[key] !== 1) {
            addFailure(
              failures,
              `disable.activeBeforeDisable.owner.${key}`,
              "must be one",
            );
          }
        }
        if (
          activeOwner.protocol !== 11 ||
          activeOwner.registrationCount !== 1 ||
          activeOwner.statusWidgetLeases !== 1 ||
          activeOwner.statusWidgetPhase !== "present" ||
          activeOwner.desiredOnDemand !== false ||
          activeOwner.wakePhase !== "waiting"
        ) {
          addFailure(
            failures,
            "disable.activeBeforeDisable.owner",
            "must show one current A lease and a held desired-false wake",
          );
        }
        if (
          !Array.isArray(activeOwner.registrationIds) ||
          activeOwner.registrationIds.length !== 1 ||
          activeOwner.registrationIds[0] !== active.aRegistrationId ||
          !sameJson(activeOwner.registrationIds, activeOwner.statusWidgetLeaseIds)
        ) {
          addFailure(
            failures,
            "disable.activeBeforeDisable.owner.registrationIds",
            "must be exactly the current A widget lease",
          );
        }
      }
      if (
        typeof active.aRegistrationId !== "string" ||
        active.aRegistrationId === "" ||
        !g2Identity ||
        active.aRegistrationId !== g2Identity.aRegistrationId ||
        active.aWidgetPresent !== true ||
        active.bTerminal !== true
      ) {
        addFailure(
          failures,
          "disable.activeBeforeDisable",
          "must retain current A widget and terminal B",
        );
      }
      const heldCandidate = active.heldCandidate;
      if (
        !isPlainObject(heldCandidate) ||
        heldCandidate.connected !== true ||
        heldCandidate.pending !== true ||
        heldCandidate.inserted !== true ||
        heldCandidate.linkedPanel !== true ||
        !Number.isInteger(heldCandidate.calls) ||
        heldCandidate.calls < 1 ||
        heldCandidate.callDelta !== 1
      ) {
        addFailure(
          failures,
          "disable.activeBeforeDisable.heldCandidate",
          "must prove a real held A candidate",
        );
      }
    }
    const firstDrain = disable.firstDrain;
    if (!isPlainObject(firstDrain)) {
      addFailure(
        failures,
        "disable.firstDrain",
        "must record the first Sine disable drain",
      );
    }
    requireIdleOwner(firstDrain?.owner, "disable.firstDrain.owner", failures, {
      phase: "absent",
      registrations: [],
    });
    if (!isPlainObject(firstDrain?.widget)) {
      addFailure(failures, "disable.firstDrain.widget", "must be an object");
    } else {
      if (firstDrain.widget.present !== false) {
        addFailure(failures, "disable.firstDrain.widget.present", "must be false");
      }
      if (firstDrain.widget.placement !== false) {
        addFailure(failures, "disable.firstDrain.widget.placement", "must be false");
      }
    }
    if (
      !isPlainObject(firstDrain?.windows) ||
      firstDrain.windows.aPanel !== false ||
      firstDrain.windows.bPanel !== false
    ) {
      addFailure(failures, "disable.firstDrain.windows", "must retain no panel views");
    }
    if (!isPlainObject(disable.controllers)) {
      addFailure(failures, "disable.controllers", "must be an object");
    } else {
      for (const key of ["a", "b"]) {
        const controller = disable.controllers[key];
        if (!isPlainObject(controller)) {
          addFailure(failures, `disable.controllers.${key}`, "must be an object");
          continue;
        }
        requireBoolean(
          controller.stopped,
          `disable.controllers.${key}.stopped`,
          failures,
        );
        requireZero(
          controller.pendingTimers,
          `disable.controllers.${key}.pendingTimers`,
          failures,
        );
        requireZero(
          controller.pendingWaits,
          `disable.controllers.${key}.pendingWaits`,
          failures,
        );
      }
    }
    if (!isPlainObject(disable.sentinels)) {
      addFailure(failures, "disable.sentinels", "must be an object");
    } else {
      for (const key of ["a", "b"]) {
        requireSentinel(disable.sentinels[key], `disable.sentinels.${key}`, failures);
      }
    }
    const sine = disable.actualSineDisable;
    if (
      !isPlainObject(sine) ||
      sine.enabledBefore !== true ||
      sine.enabledAfter !== false ||
      sine.callbackDelivered !== true ||
      sine.callbackBeforeFixtureRelease !== true ||
      !Number.isFinite(sine.callbackAt) ||
      !Number.isFinite(sine.fixtureReleasedAt) ||
      sine.callbackAt > sine.fixtureReleasedAt
    ) {
      addFailure(
        failures,
        "disable.actualSineDisable",
        "must prove the first drain used manager.toggleTheme and delivered its callback",
      );
    }
  }

  const pulse = evidence.pulse;
  if (!isPlainObject(pulse)) {
    addFailure(failures, "pulse", "must be an object");
  } else {
    for (const key of [
      "oldDeadlineQuiet",
      "replacementNormalAfterDeadline",
      "released",
    ]) {
      requireBoolean(pulse[key], `pulse.${key}`, failures);
    }
    const timing = pulse.timing;
    if (!isPlainObject(timing)) {
      addFailure(failures, "pulse.timing", "must be an object");
    } else {
      const keys = [
        "firstEnableAt",
        "firstActiveAt",
        "firstReleasedAt",
        "disabledAt",
        "oldDeadlineEarliestAt",
        "oldDeadlineLatestAt",
        "replacementEnableAt",
        "replacementActiveAt",
        "replacementReleasedAt",
        "replacementSentinelReadyAt",
        "replacementDeadlineEarliestAt",
        "normalActiveAt",
      ];
      for (const key of keys) {
        if (!Number.isFinite(timing[key])) {
          addFailure(failures, `pulse.timing.${key}`, "must be finite");
        }
      }
      if (
        !(
          timing.firstActiveAt <= timing.firstReleasedAt &&
          timing.firstReleasedAt <= timing.disabledAt &&
          timing.disabledAt <= timing.oldDeadlineEarliestAt &&
          timing.firstEnableAt <= timing.firstActiveAt &&
          timing.oldDeadlineEarliestAt <= timing.oldDeadlineLatestAt
        )
      ) {
        addFailure(
          failures,
          "pulse.timing",
          "must disable after release and before the old deadline",
        );
      }
      if (
        !(
          timing.replacementActiveAt <= timing.replacementReleasedAt &&
          timing.replacementReleasedAt <= timing.oldDeadlineEarliestAt &&
          timing.replacementSentinelReadyAt <= timing.oldDeadlineEarliestAt &&
          timing.replacementReleasedAt <= timing.replacementSentinelReadyAt &&
          timing.oldDeadlineLatestAt <= timing.replacementDeadlineEarliestAt &&
          timing.replacementEnableAt <= timing.replacementActiveAt &&
          timing.replacementDeadlineEarliestAt <= timing.normalActiveAt
        )
      ) {
        addFailure(
          failures,
          "pulse.timing",
          "must separate old and replacement pulse deadlines",
        );
      }
    }
    const oldDeadline = pulse.oldDeadlineObservation;
    if (!isPlainObject(oldDeadline)) {
      addFailure(
        failures,
        "pulse.oldDeadlineObservation",
        "must record the old-deadline window",
      );
    } else if (
      !Number.isFinite(oldDeadline.startAt) ||
      !Number.isFinite(oldDeadline.endAt) ||
      !Number.isInteger(oldDeadline.samples) ||
      oldDeadline.samples < 1 ||
      oldDeadline.activeSamples !== 0 ||
      oldDeadline.activeStarts !== 0 ||
      oldDeadline.activeTransitions !== 0 ||
      !(oldDeadline.startAt <= timing?.oldDeadlineEarliestAt) ||
      !(timing?.oldDeadlineLatestAt + 1_000 <= oldDeadline.endAt)
    ) {
      addFailure(
        failures,
        "pulse.oldDeadlineObservation",
        "must sample across the old deadline with zero active transition counters",
      );
    }
    const replacementEarly = pulse.replacementEarlyObservation;
    if (!isPlainObject(replacementEarly)) {
      addFailure(
        failures,
        "pulse.replacementEarlyObservation",
        "must record the replacement pre-deadline interval",
      );
    } else if (
      !Number.isFinite(replacementEarly.startAt) ||
      !Number.isFinite(replacementEarly.endAt) ||
      !Number.isInteger(replacementEarly.samples) ||
      replacementEarly.samples < 1 ||
      replacementEarly.activeSamples !== 0 ||
      replacementEarly.activeStarts !== 0 ||
      replacementEarly.activeTransitions !== 0 ||
      !(replacementEarly.startAt <= timing?.replacementReleasedAt) ||
      !(timing?.replacementDeadlineEarliestAt <= replacementEarly.endAt)
    ) {
      addFailure(
        failures,
        "pulse.replacementEarlyObservation",
        "must reject every active transition before the earliest replacement deadline",
      );
    }
    const replacementSentinel = pulse.replacementSentinel;
    if (
      !isPlainObject(replacementSentinel) ||
      replacementSentinel.baselineInactive !== true ||
      !Number.isFinite(replacementSentinel.readyAt) ||
      replacementSentinel.readyAt !== timing?.replacementSentinelReadyAt
    ) {
      addFailure(
        failures,
        "pulse.replacementSentinel",
        "must use a fresh inactive sentinel ready before the old deadline",
      );
    }
    const finalController = pulse.finalController;
    if (!isPlainObject(finalController)) {
      addFailure(failures, "pulse.finalController", "must be an object");
    } else {
      requireBoolean(finalController.stopped, "pulse.finalController.stopped", failures);
      requireZero(
        finalController.pendingTimers,
        "pulse.finalController.pendingTimers",
        failures,
      );
      requireZero(
        finalController.pendingWaits,
        "pulse.finalController.pendingWaits",
        failures,
      );
    }
    requireIdleOwner(pulse.finalOwner, "pulse.finalOwner", failures, {
      phase: "absent",
      registrations: [],
    });
    if (
      !isPlainObject(pulse.finalWidget) ||
      pulse.finalWidget.present !== false ||
      pulse.finalWidget.placement !== false
    ) {
      addFailure(failures, "pulse.finalWidget", "must prove final widget removal");
    }
    if (
      !isPlainObject(pulse.finalWindows) ||
      pulse.finalWindows.aPanel !== false ||
      pulse.finalWindows.bPanel !== false
    ) {
      addFailure(failures, "pulse.finalWindows", "must prove final panel removal");
    }
    const sine = pulse.finalSineDisable;
    if (
      !isPlainObject(sine) ||
      sine.enabledBefore !== true ||
      sine.enabledAfter !== false ||
      sine.callbackDelivered !== true
    ) {
      addFailure(
        failures,
        "pulse.finalSineDisable",
        "must prove the terminal drain used manager.toggleTheme",
      );
    }
  }

  return freeze({ failures, ok: failures.length === 0 });
};
