/** Pure, deterministic helpers shared by the Sidebar live-XUL probes. */

const freeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      freeze(child);
    }
  }
  return value;
};

const isPlainObject = value => {
  if (value === null || typeof value !== "object") {
    return false;
  }
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

/**
 * Normalize named harness verdicts and derive an immutable aggregate result.
 *
 * @param {Iterable<{name: string, ok: boolean, detail?: string | null}>} input
 */
export const collectVerdicts = input => {
  const names = new Set();
  const verdicts = [...input].map((verdict, index) => {
    if (!isPlainObject(verdict)) {
      throw new TypeError(`verdicts[${index}] must be an object`);
    }
    if (typeof verdict.name !== "string" || verdict.name.trim() === "") {
      throw new TypeError(`verdicts[${index}].name must be a non-empty string`);
    }
    if (names.has(verdict.name)) {
      throw new TypeError(`duplicate verdict name: ${verdict.name}`);
    }
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
    return {
      name: verdict.name,
      ok: verdict.ok,
      detail: verdict.detail ?? null,
    };
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

/**
 * Summarize millisecond timings while retaining the raw observations.
 * p95 uses the nearest-rank definition, which always reports an observed value.
 *
 * @param {Iterable<number>} input
 */
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
        errors.push({
          path: `zen.${key}`,
          message: "must be a lowercase SHA-256",
        });
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
        errors.push({
          path: `sine.${key}`,
          message: "must be a lowercase SHA-256",
        });
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

  return freeze({
    ok: errors.length === 0,
    errors,
    stamp: canonicalize(stamp, "stamp"),
  });
};
