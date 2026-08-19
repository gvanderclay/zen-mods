/** Stage one allowlisted mod into a throwaway live profile and record its bytes. */

import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { localModEntry, validateManifest } from "../../../scripts/install-local-core.mjs";
import {
  assertMatchingPlatform,
  captureSineStamp,
  regularFiles,
  sha256,
} from "./installed-platform.mjs";

const safeRelativePath = path => {
  if (typeof path !== "string" || path.trim() === "" || isAbsolute(path)) {
    return false;
  }
  return !path
    .split(/[\\/]/)
    .some(segment => segment === "" || segment === "." || segment === "..");
};

/** Validate the deliberately small file-copy boundary used by throwaway live profiles. */
export const validateStagedMod = stagedMod => {
  if (!stagedMod || typeof stagedMod !== "object" || Array.isArray(stagedMod)) {
    throw new TypeError("stagedMod must be an object");
  }
  const { enabled = false, manifest, relativePaths, sourceDirectory } = stagedMod;
  if (
    typeof manifest?.id !== "string" ||
    !safeRelativePath(manifest.id) ||
    /[\\/]/.test(manifest.id)
  ) {
    throw new TypeError("stagedMod manifest id must be one safe path segment");
  }
  validateManifest(manifest, manifest?.id);
  if (typeof sourceDirectory !== "string" || sourceDirectory.trim() === "") {
    throw new TypeError("stagedMod.sourceDirectory must be a non-empty path");
  }
  if (!Array.isArray(relativePaths) || relativePaths.length === 0) {
    throw new TypeError("stagedMod.relativePaths must not be empty");
  }
  const seen = new Set();
  for (const path of relativePaths) {
    if (!safeRelativePath(path)) {
      throw new TypeError(`staged mod path must be safe and relative: ${String(path)}`);
    }
    if (seen.has(path)) {
      throw new TypeError(`duplicate staged mod path: ${path}`);
    }
    seen.add(path);
  }
  if (typeof enabled !== "boolean") {
    throw new TypeError("stagedMod.enabled must be boolean");
  }
  return {
    enabled,
    manifest,
    relativePaths: [...relativePaths],
    sourceDirectory: resolve(sourceDirectory),
  };
};

/** Record the copied target after staging so artifacts name the bytes Zen executes. */
export const collectStagedModEvidence = async ({ manifest, relativePaths, target }) => {
  for (const relativePath of relativePaths) {
    await access(join(target, relativePath));
  }
  const files = {};
  for (const file of (await regularFiles(target)).sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  )) {
    const contents = await readFile(file.path);
    files[file.relativePath] = {
      bytes: contents.length,
      sha256: sha256(contents),
    };
  }
  const manifestFile = files["theme.json"];
  if (!manifestFile) {
    throw new Error("staged mod evidence is missing theme.json");
  }
  return {
    files,
    manifest: { ...manifestFile, value: manifest },
    relativePaths: [...relativePaths],
  };
};

export const stageProfile = async ({
  profile,
  sineChromeDirectory,
  sineStamp,
  stagedMod,
}) => {
  const chrome = join(profile, "chrome");
  const sineMods = join(chrome, "sine-mods");
  const { enabled, manifest, relativePaths, sourceDirectory } =
    validateStagedMod(stagedMod);
  const target = join(sineMods, manifest.id);
  await mkdir(sineMods, { recursive: true });
  await cp(join(sineChromeDirectory, "JS"), join(chrome, "JS"), {
    recursive: true,
    dereference: true,
  });
  await cp(join(sineChromeDirectory, "utils"), join(chrome, "utils"), {
    recursive: true,
    dereference: true,
  });
  assertMatchingPlatform(
    { sine: sineStamp },
    { sine: await captureSineStamp(chrome) },
    "staged Sine",
  );
  await mkdir(target, { recursive: true });
  for (const relativePath of relativePaths) {
    const destination = join(target, relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(sourceDirectory, relativePath), destination, {
      recursive: true,
      dereference: true,
    });
  }
  await writeFile(join(target, "theme.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(sineMods, "chrome.css"), "");
  await writeFile(join(sineMods, "content.css"), "");
  await writeFile(
    join(sineMods, "mods.json"),
    `${JSON.stringify(
      {
        [manifest.id]: {
          ...localModEntry(manifest),
          enabled,
        },
      },
      null,
      2,
    )}\n`,
  );
  return collectStagedModEvidence({ manifest, relativePaths, target });
};
