#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  copyFile,
  lstat,
  readFile,
  readlink,
  realpath,
  rename,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  localModEntry,
  parseModDatabase,
  profilePathFromIni,
  validateManifest,
  zenProcessIsRunning,
} from "./install-local-core.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modsRoot = join(repositoryRoot, "mods");

const usage = () => {
  console.error("Usage: pnpm run install:local <mod-id> [--profile <profile-path>]");
};

const parseArguments = args => {
  let modId;
  let profile;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--profile") {
      profile = args[index + 1];
      if (!profile) {
        throw new Error("--profile requires a path");
      }
      index += 1;
    } else if (!argument?.startsWith("-") && !modId) {
      modId = argument;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }

  if (!modId) {
    throw new Error("a mod id is required");
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(modId)) {
    throw new Error(`invalid mod id: ${modId}`);
  }
  return { modId, profile };
};

const processCommands = () => {
  const result = spawnSync("ps", ["-ax", "-o", "command="], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(
      `could not inspect running processes: ${result.error?.message ?? result.stderr}`,
    );
  }
  return result.stdout.split(/\r?\n/);
};

const existingLink = async (linkPath, expectedTarget) => {
  let stats;
  try {
    stats = await lstat(linkPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }

  if (!stats.isSymbolicLink()) {
    throw new Error(`${linkPath} already exists and is not a symlink`);
  }
  const target = resolve(dirname(linkPath), await readlink(linkPath));
  if ((await realpath(target)) !== expectedTarget) {
    throw new Error(`${linkPath} points to ${target}, not ${expectedTarget}`);
  }
  return true;
};

const buildMod = (modDirectory, packageName) => {
  console.log(`Building ${packageName}...`);
  const result = spawnSync(
    process.execPath,
    [join(repositoryRoot, "scripts/build-mod.mjs")],
    {
      cwd: modDirectory,
      stdio: "inherit",
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`build failed${result.error ? `: ${result.error.message}` : ""}`);
  }
};

const install = async ({ modId, profile: explicitProfile }) => {
  if (zenProcessIsRunning(processCommands())) {
    throw new Error("Zen is running. Quit Zen completely before installing a local mod.");
  }

  const modDirectory = join(modsRoot, modId);
  const canonicalModDirectory = await realpath(modDirectory).catch(() => {
    throw new Error(`unknown mod: ${modId}`);
  });
  if (relative(modsRoot, canonicalModDirectory).startsWith("..")) {
    throw new Error(`mod directory escapes ${modsRoot}`);
  }

  const manifest = JSON.parse(await readFile(join(modDirectory, "theme.json"), "utf8"));
  validateManifest(manifest, modId);
  const packageJson = JSON.parse(
    await readFile(join(modDirectory, "package.json"), "utf8"),
  );

  const zenRoot = join(homedir(), "Library", "Application Support", "zen");
  const profile = explicitProfile
    ? resolve(explicitProfile)
    : profilePathFromIni(await readFile(join(zenRoot, "profiles.ini"), "utf8"), zenRoot);
  const sineDirectory = join(profile, "chrome", "sine-mods");
  const databasePath = join(sineDirectory, "mods.json");
  const databaseContents = await readFile(databasePath, "utf8").catch(error => {
    if (error?.code === "ENOENT") {
      throw new Error(`Sine mods database not found at ${databasePath}`);
    }
    throw error;
  });
  const database = parseModDatabase(databaseContents);
  const nextDatabase = {
    ...database,
    [modId]: localModEntry(manifest, database[modId]),
  };

  const linkPath = join(sineDirectory, modId);
  const linkAlreadyExists = await existingLink(linkPath, canonicalModDirectory);
  buildMod(modDirectory, packageJson.name ?? modId);

  let createdLink = false;
  const temporaryPath = `${databasePath}.tmp-${process.pid}`;
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const backupPath = `${databasePath}.bak-local-${timestamp}`;

  try {
    if (!linkAlreadyExists) {
      await symlink(canonicalModDirectory, linkPath, "dir");
      createdLink = true;
    }
    await copyFile(databasePath, backupPath);
    await writeFile(temporaryPath, JSON.stringify(nextDatabase), "utf8");
    await rename(temporaryPath, databasePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    if (createdLink) {
      await unlink(linkPath).catch(() => {});
    }
    throw error;
  }

  console.log(`Installed ${manifest.name} in ${profile}`);
  console.log(`Linked ${linkPath} -> ${canonicalModDirectory}`);
  console.log(`Backed up Sine metadata to ${backupPath}`);
};

try {
  await install(parseArguments(process.argv.slice(2)));
} catch (error) {
  usage();
  console.error(`\nLocal install failed: ${error?.message ?? error}`);
  process.exitCode = 1;
}
