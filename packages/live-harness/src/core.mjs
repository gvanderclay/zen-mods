/** Pure, deterministic validation for exact Zen/Sine probes. */

import { freeze, isPlainObject } from "./plain-data.mjs";

/** Require an exact, duplicate-free assertion contract before interpreting verdicts. */
export const validateAssertionManifest = (result, requiredNames) => {
  if (!isPlainObject(result)) throw new TypeError("probe result must be an object");
  if (result.fatal !== null && result.fatal !== undefined) {
    throw new Error(`probe reported a fatal error: ${String(result.fatal)}`);
  }
  if (!Array.isArray(result.assertions) || result.assertions.length === 0) {
    throw new Error("probe assertions must not be empty");
  }
  if (!Array.isArray(requiredNames) || requiredNames.length === 0) {
    throw new Error("required assertion names must not be empty");
  }

  const required = new Set();
  for (const name of requiredNames) {
    if (typeof name !== "string" || name.trim() === "") {
      throw new TypeError("required assertion names must be non-empty strings");
    }
    if (required.has(name)) throw new Error(`duplicate required assertion name: ${name}`);
    required.add(name);
  }

  const seen = new Set();
  const assertions = result.assertions.map((assertion, index) => {
    if (!isPlainObject(assertion)) {
      throw new TypeError(`assertions[${index}] must be an object`);
    }
    if (typeof assertion.name !== "string" || assertion.name.trim() === "") {
      throw new TypeError(`assertions[${index}].name must be a non-empty string`);
    }
    if (seen.has(assertion.name)) {
      throw new Error(`duplicate assertion name: ${assertion.name}`);
    }
    seen.add(assertion.name);
    if (typeof assertion.ok !== "boolean") {
      throw new TypeError(`assertions[${index}].ok must be a boolean`);
    }
    if (
      assertion.detail !== undefined &&
      assertion.detail !== null &&
      typeof assertion.detail !== "string"
    ) {
      throw new TypeError(`assertions[${index}].detail must be a string or null`);
    }
    return {
      name: assertion.name,
      ok: assertion.ok,
      detail: assertion.detail ?? null,
    };
  });

  const missing = requiredNames.filter(name => !seen.has(name));
  if (missing.length > 0) throw new Error(`missing: ${missing.join(", ")}`);
  const unexpected = assertions
    .map(item => item.name)
    .filter(name => !required.has(name));
  if (unexpected.length > 0) throw new Error(`unexpected: ${unexpected.join(", ")}`);
  return freeze(assertions);
};

/** Detect the four lifecycle faults the harness must never normalize away. */
export const auditLifecycle = evidence => {
  if (!isPlainObject(evidence)) throw new TypeError("evidence must be an object");
  if (!Array.isArray(evidence.resources) || !Array.isArray(evidence.events)) {
    throw new TypeError("evidence must contain resource and event arrays");
  }
  const violations = [];
  for (const [index, resource] of evidence.resources.entries()) {
    if (!isPlainObject(resource) || typeof resource.active !== "boolean") {
      throw new TypeError(`resources[${index}] must be an object with boolean active`);
    }
    if (!resource.active) continue;
    const code =
      resource.kind === "listener"
        ? "leaked-listener"
        : resource.kind === "timer"
          ? "leaked-timer"
          : "leaked-resource";
    violations.push({ code, owner: String(resource.owner ?? "unknown"), index });
  }
  for (const [index, event] of evidence.events.entries()) {
    if (!isPlainObject(event)) throw new TypeError(`events[${index}] must be an object`);
    if (event.type === "resource-at-stop") {
      if (typeof event.active !== "boolean") {
        throw new TypeError(`events[${index}].active must be a boolean`);
      }
      if (event.active) {
        violations.push({
          code: "resource-active-at-stop",
          kind: String(event.kind ?? "unknown"),
          owner: String(event.owner ?? "unknown"),
          index,
        });
      }
      continue;
    }
    if (
      event.type === "callback-delivered" &&
      event.stopped === true &&
      event.guarded !== true
    ) {
      violations.push({
        code: "stale-callback",
        owner: String(event.owner ?? "unknown"),
        index,
      });
    }
    if (event.type !== "mutation") continue;
    if (event.stopped === true) {
      violations.push({
        code: "stale-continuation",
        owner: String(event.owner ?? "unknown"),
        index,
      });
    }
    if (event.owner !== event.targetOwner) {
      violations.push({
        code: "wrong-window-mutation",
        owner: String(event.owner ?? "unknown"),
        targetOwner: String(event.targetOwner ?? "unknown"),
        index,
      });
    }
  }
  return freeze({ ok: violations.length === 0, violations });
};

/** Derive an immutable aggregate from already validated named verdicts. */
export const collectVerdicts = input => {
  const names = new Set();
  const verdicts = [...input].map((verdict, index) => {
    if (!isPlainObject(verdict))
      throw new TypeError(`verdicts[${index}] must be an object`);
    if (typeof verdict.name !== "string" || verdict.name.trim() === "") {
      throw new TypeError(`verdicts[${index}].name must be a non-empty string`);
    }
    if (names.has(verdict.name))
      throw new TypeError(`duplicate verdict name: ${verdict.name}`);
    names.add(verdict.name);
    if (typeof verdict.ok !== "boolean") {
      throw new TypeError(`verdicts[${index}].ok must be a boolean`);
    }
    if (
      verdict.detail !== undefined &&
      verdict.detail !== null &&
      typeof verdict.detail !== "string"
    ) {
      throw new TypeError(`verdicts[${index}].detail must be a string or null`);
    }
    return { name: verdict.name, ok: verdict.ok, detail: verdict.detail ?? null };
  });
  const failures = verdicts.filter(verdict => !verdict.ok);
  return freeze({
    ok: failures.length === 0,
    counts: {
      total: verdicts.length,
      passed: verdicts.length - failures.length,
      failed: failures.length,
    },
    verdicts,
    failures,
  });
};

/** Summarize millisecond timings while retaining every raw observation. */
export const summarizeTimings = input => {
  const raw = [...input];
  for (const [index, timing] of raw.entries()) {
    if (!Number.isFinite(timing) || timing < 0) {
      throw new TypeError(`timings[${index}] must be a finite non-negative number`);
    }
  }
  if (raw.length === 0) {
    return freeze({
      raw,
      count: 0,
      median: null,
      p95: null,
      min: null,
      max: null,
      spread: null,
    });
  }
  const sorted = [...raw].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  const min = sorted[0];
  const max = sorted.at(-1);
  return freeze({
    raw,
    count: raw.length,
    median,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    min,
    max,
    spread: max - min,
  });
};
