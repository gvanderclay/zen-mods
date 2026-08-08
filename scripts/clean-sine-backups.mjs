#!/usr/bin/env node

import { readdir, readFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { isLocalBackupFilename, profilePathFromIni } from "./install-local-core.mjs";

const usage = () => {
  console.error(
    "Usage: pnpm run clean:sine-backups [--dry-run] [--profile <profile-path>]",
  );
};

const parseArguments = args => {
  let dryRun = false;
  let profile;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") {
      continue;
    }
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--profile") {
      profile = args[index + 1];
      if (!profile || profile.startsWith("--")) {
        throw new Error("--profile requires a path");
      }
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }

  return { dryRun, profile };
};

const cleanBackups = async ({ dryRun, profile: explicitProfile }) => {
  const zenRoot = join(homedir(), "Library", "Application Support", "zen");
  const profile = explicitProfile
    ? resolve(explicitProfile)
    : profilePathFromIni(await readFile(join(zenRoot, "profiles.ini"), "utf8"), zenRoot);
  const sineDirectory = join(profile, "chrome", "sine-mods");
  const entries = await readdir(sineDirectory, { withFileTypes: true }).catch(error => {
    if (error?.code === "ENOENT") {
      throw new Error(`Sine mods directory not found at ${sineDirectory}`);
    }
    throw error;
  });
  const backupNames = entries
    .filter(entry => entry.isFile() && isLocalBackupFilename(entry.name))
    .map(entry => entry.name)
    .sort();

  if (backupNames.length === 0) {
    console.log(`No local Sine backups found in ${sineDirectory}`);
    return;
  }

  if (dryRun) {
    console.log(`Would delete ${backupNames.length} local Sine backup(s):`);
    for (const name of backupNames) {
      console.log(`  ${join(sineDirectory, name)}`);
    }
    return;
  }

  for (const name of backupNames) {
    await unlink(join(sineDirectory, name));
  }
  console.log(`Deleted ${backupNames.length} local Sine backup(s) from ${sineDirectory}`);
};

try {
  await cleanBackups(parseArguments(process.argv.slice(2)));
} catch (error) {
  usage();
  console.error(`\nBackup cleanup failed: ${error?.message ?? error}`);
  process.exitCode = 1;
}
