/** Captures and compares the exact installed Zen and Sine bytes used by live probes. */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { validatePlatformStamp } from "./platform-stamp.mjs";

const ZEN_FILES = {
  applicationIniSha256: "application.ini",
  browserOmniSha256: "browser/omni.ja",
  configSha256: "config.js",
  configPrefsSha256: "defaults/pref/config-prefs.js",
};
const SINE_FILES = [
  "JS/core/manager.sys.mjs",
  "JS/core/utils.sys.mjs",
  "JS/engine.json",
  "JS/services/module_loader.mjs",
  "utils/chrome.manifest",
];

export const sha256 = contents => createHash("sha256").update(contents).digest("hex");

export const regularFiles = async (root, directory = root) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await regularFiles(root, path)));
    } else if (entry.isFile()) {
      files.push({
        path,
        relativePath: path.slice(root.length + 1).replaceAll("\\", "/"),
      });
    }
  }
  return files;
};

const treeSha256 = async root => {
  const hash = createHash("sha256");
  const files = (await regularFiles(root)).sort((left, right) =>
    left.relativePath < right.relativePath
      ? -1
      : left.relativePath > right.relativePath
        ? 1
        : 0,
  );
  for (const file of files) {
    hash.update(file.relativePath, "utf8");
    hash.update("\0");
    hash.update(await readFile(file.path));
    hash.update("\0");
  }
  return hash.digest("hex");
};

const parseIniSection = (raw, section) => {
  const values = {};
  let active = false;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    const heading = trimmed.match(/^\[([^\]]+)\]$/);
    if (heading) {
      active = heading[1] === section;
      continue;
    }
    if (!active || trimmed === "" || trimmed.startsWith(";") || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator > 0) {
      values[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
    }
  }
  return values;
};

const captureZenStamp = async zenResources => {
  const applicationIni = await readFile(join(zenResources, "application.ini"));
  const rawApplicationIni = applicationIni.toString("utf8");
  const app = parseIniSection(rawApplicationIni, "App");
  const gecko = parseIniSection(rawApplicationIni, "Gecko");
  const hashes = {};
  for (const [key, relativePath] of Object.entries(ZEN_FILES)) {
    hashes[key] =
      relativePath === "application.ini"
        ? sha256(applicationIni)
        : sha256(await readFile(join(zenResources, relativePath)));
  }
  return {
    version: app.Version,
    buildId: app.BuildID,
    geckoVersion: gecko.MaxVersion,
    sourceStamp: app.SourceStamp,
    ...hashes,
  };
};

export const captureSineStamp = async chromeDirectory => {
  const engine = JSON.parse(
    await readFile(join(chromeDirectory, "JS", "engine.json"), "utf8"),
  );
  const files = {};
  for (const relativePath of SINE_FILES) {
    files[relativePath] = sha256(await readFile(join(chromeDirectory, relativePath)));
  }
  return {
    version: engine.version,
    jsTreeSha256: await treeSha256(join(chromeDirectory, "JS")),
    utilsTreeSha256: await treeSha256(join(chromeDirectory, "utils")),
    files,
  };
};

export const captureInstalledPlatform = async ({
  sineChromeDirectory,
  zenResources,
}) => ({
  zen: await captureZenStamp(zenResources),
  sine: await captureSineStamp(sineChromeDirectory),
});

export const platformDifferences = (expected, actual, path = "") => {
  if (Object.is(expected, actual)) return [];
  if (
    expected === null ||
    actual === null ||
    typeof expected !== "object" ||
    typeof actual !== "object" ||
    Array.isArray(expected) ||
    Array.isArray(actual)
  ) {
    return [path || "$"];
  }
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  return keys.flatMap(key =>
    platformDifferences(expected[key], actual[key], path ? `${path}.${key}` : key),
  );
};

export const assertMatchingPlatform = (expected, actual, label) => {
  const differences = platformDifferences(expected, actual);
  if (differences.length > 0) {
    throw new Error(`${label} differs at ${differences.join(", ")}`);
  }
};

const requireValidStamp = (stamp, label) => {
  const validation = validatePlatformStamp(stamp);
  if (!validation.ok) {
    throw new Error(`${label} is invalid: ${JSON.stringify(validation.errors)}`);
  }
};

export const selectPlatformStamp = ({ mode, observed, pinned }) => {
  if (mode !== "observed" && mode !== "pinned") {
    throw new TypeError("platformMode must be observed or pinned");
  }
  requireValidStamp(observed, "installed platform evidence");
  if (mode === "observed") return observed;
  requireValidStamp(pinned, "pinned platform stamp");
  const differences = platformDifferences(pinned, observed);
  if (differences.length > 0) {
    throw new Error(
      `installed platform differs from the pinned stamp at ${differences.join(", ")}`,
    );
  }
  return observed;
};
