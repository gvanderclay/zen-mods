/** Pure, deterministic validation for the Keep Loaded multi-window harness. */

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

const SHA256 = /^[0-9a-f]{64}$/;
const SOURCE_STAMP = /^[0-9a-f]{40}$/;
const BUILD_ID = /^\d{14}$/;
const ZEN_SHA256_KEYS = [
  "applicationIniSha256",
  "browserOmniSha256",
  "configSha256",
  "configPrefsSha256",
];
const SINE_TREE_SHA256_KEYS = ["jsTreeSha256", "utilsTreeSha256"];

const addStringError = (errors, object, key, path) => {
  if (typeof object?.[key] !== "string" || object[key].trim() === "") {
    errors.push({ path: `${path}.${key}`, message: "must be a non-empty string" });
  }
};

/** Validate the exact-version stamp consumed by the throwaway-profile launcher. */
export const validatePlatformStamp = stamp => {
  const errors = [];
  if (!isPlainObject(stamp)) {
    return freeze({
      ok: false,
      errors: [{ path: "$", message: "must be an object" }],
      stamp: null,
    });
  }
  if (!isPlainObject(stamp.zen)) {
    errors.push({ path: "zen", message: "must be an object" });
  } else {
    for (const key of [
      "version",
      "buildId",
      "geckoVersion",
      "sourceStamp",
      ...ZEN_SHA256_KEYS,
    ]) {
      addStringError(errors, stamp.zen, key, "zen");
    }
    if (typeof stamp.zen.buildId === "string" && !BUILD_ID.test(stamp.zen.buildId)) {
      errors.push({ path: "zen.buildId", message: "must be a 14-digit build ID" });
    }
    if (
      typeof stamp.zen.sourceStamp === "string" &&
      !SOURCE_STAMP.test(stamp.zen.sourceStamp)
    ) {
      errors.push({ path: "zen.sourceStamp", message: "must be a lowercase SHA-1" });
    }
    for (const key of ZEN_SHA256_KEYS) {
      if (typeof stamp.zen[key] === "string" && !SHA256.test(stamp.zen[key])) {
        errors.push({ path: `zen.${key}`, message: "must be a lowercase SHA-256" });
      }
    }
  }
  if (!isPlainObject(stamp.sine)) {
    errors.push({ path: "sine", message: "must be an object" });
  } else {
    addStringError(errors, stamp.sine, "version", "sine");
    for (const key of SINE_TREE_SHA256_KEYS) {
      addStringError(errors, stamp.sine, key, "sine");
      if (typeof stamp.sine[key] === "string" && !SHA256.test(stamp.sine[key])) {
        errors.push({ path: `sine.${key}`, message: "must be a lowercase SHA-256" });
      }
    }
    if (!isPlainObject(stamp.sine.files) || Object.keys(stamp.sine.files).length === 0) {
      errors.push({ path: "sine.files", message: "must be a non-empty object" });
    } else {
      for (const path of Object.keys(stamp.sine.files).sort()) {
        const checksum = stamp.sine.files[path];
        const segments = path.split("/");
        if (
          path.trim() === "" ||
          path.startsWith("/") ||
          segments.some(segment => segment === "" || segment === "." || segment === "..")
        ) {
          errors.push({
            path: `sine.files.${path}`,
            message: "path must be safe and relative",
          });
        }
        if (typeof checksum !== "string" || !SHA256.test(checksum)) {
          errors.push({
            path: `sine.files.${path}`,
            message: "must be a lowercase SHA-256",
          });
        }
      }
    }
  }
  return freeze({ ok: errors.length === 0, errors, stamp: canonicalize(stamp, "stamp") });
};
