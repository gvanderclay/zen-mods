/** Fail-closed evidence checks for the production stale-widget-generation gate. */

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
  "real G1 widget and generation callbacks are captured",
  "real G1 wake completion is paused before reload",
  "Sine reload replaces G1 with one live G2 widget lease",
  "retained G1 facade fill cannot mutate G2",
  "retained G1 widget view callback cannot mutate G2",
  "retained G1 panel disposer cannot mutate G2",
  "retained G1 wake completion cannot mutate G2",
  "G2 panel still fills normally after stale work is forced",
  "production disable drains the widget owner",
]);

export const REQUIRED_FORCE_KEYS = Object.freeze([
  "facadeFill",
  "viewShowing",
  "panelDisposer",
  "wakeCompletion",
]);

const addFailure = (failures, path, message) => failures.push({ path, message });

const isCurrentG2State = (state, path, failures) => {
  if (!isPlainObject(state)) {
    addFailure(failures, path, "must be an object");
    return;
  }
  const current = state.current;
  if (!isPlainObject(current)) {
    addFailure(failures, `${path}.current`, "must be an object");
  } else {
    for (const key of ["facade", "controller", "widget", "view"]) {
      if (current[key] !== true) {
        addFailure(failures, `${path}.current.${key}`, "must still identify G2");
      }
    }
  }
  if (typeof state.registrationId !== "string" || state.registrationId === "") {
    addFailure(failures, `${path}.registrationId`, "must be a non-empty string");
  }
  const owner = state.owner;
  if (!isPlainObject(owner)) {
    addFailure(failures, `${path}.owner`, "must be an object");
    return;
  }
  if (owner.registrationCount !== 1) {
    addFailure(failures, `${path}.owner.registrationCount`, "must remain one");
  }
  if (owner.statusWidgetLeases !== 1) {
    addFailure(failures, `${path}.owner.statusWidgetLeases`, "must remain one");
  }
  if (owner.statusWidgetPhase !== "present") {
    addFailure(failures, `${path}.owner.statusWidgetPhase`, "must remain present");
  }
  for (const key of ["registrationIds", "statusWidgetLeaseIds"]) {
    if (!Array.isArray(owner[key]) || !owner[key].includes(state.registrationId)) {
      addFailure(failures, `${path}.owner.${key}`, "must retain the G2 registration");
    }
  }
};

/**
 * Validate raw browser evidence independently of the browser-side `ok` booleans.
 * A probe cannot pass merely by claiming that a stale callback did nothing: it must
 * retain every real callback, keep the complete G2 identity/snapshot unchanged, and
 * record no MutationObserver delivery for each forced path.
 */
export const validateStaleGenerationEvidence = result => {
  const failures = [];
  if (!isPlainObject(result)) {
    return freeze({
      ok: false,
      failures: [{ path: "result", message: "must be an object" }],
    });
  }

  const capture = result.capture;
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
      if (capture[key] !== true) {
        addFailure(failures, `capture.${key}`, "must confirm a real G1 capture");
      }
    }
  }

  const generation = result.generation;
  if (!isPlainObject(generation)) {
    addFailure(failures, "generation", "must be an object");
  } else {
    for (const key of [
      "g1Stopped",
      "g2Current",
      "controllerReplaced",
      "registrationReplaced",
      "ownerApplicationPreserved",
    ]) {
      if (generation[key] !== true) {
        addFailure(failures, `generation.${key}`, "must be true");
      }
    }
  }

  const forces = result.forces;
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
      if (force.invoked !== true) addFailure(failures, `${path}.invoked`, "must be true");
      if (force.error !== null) addFailure(failures, `${path}.error`, "must be null");
      if (force.mutationDelta !== 0) {
        addFailure(failures, `${path}.mutationDelta`, "must be zero");
      }
      if (force.stable !== true) addFailure(failures, `${path}.stable`, "must be true");
      if (!sameJson(force.before, force.after)) {
        addFailure(failures, path, "must retain an identical G2 state snapshot");
      }
      isCurrentG2State(force.before, `${path}.before`, failures);
      isCurrentG2State(force.after, `${path}.after`, failures);
    }

    const disposer = forces.panelDisposer;
    if (isPlainObject(disposer)) {
      if (disposer.held !== true) {
        addFailure(
          failures,
          "forces.panelDisposer.held",
          "must retain the real G1 disposer",
        );
      }
      if (!Number.isInteger(disposer.stopCalls) || disposer.stopCalls < 1) {
        addFailure(
          failures,
          "forces.panelDisposer.stopCalls",
          "must observe the G1 generation stop",
        );
      }
    }

    const wake = forces.wakeCompletion;
    if (isPlainObject(wake)) {
      const completion = wake.completion;
      if (!isPlainObject(completion)) {
        addFailure(failures, "forces.wakeCompletion.completion", "must be an object");
      } else {
        for (const key of ["workSettled", "released", "settleFinished"]) {
          if (completion[key] !== true) {
            addFailure(
              failures,
              `forces.wakeCompletion.completion.${key}`,
              "must be true",
            );
          }
        }
        for (const key of ["readyCalls", "errorCalls"]) {
          if (completion[key] !== 0) {
            addFailure(
              failures,
              `forces.wakeCompletion.completion.${key}`,
              "must remain zero",
            );
          }
        }
      }
    }
  }

  return freeze({ ok: failures.length === 0, failures });
};
