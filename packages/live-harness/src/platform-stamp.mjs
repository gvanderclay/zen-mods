/** Pure validation for the exact Zen/Sine platform stamp. */

import { freeze, isPlainObject } from "./plain-data.mjs";

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
