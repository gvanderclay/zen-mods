#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { zenProcessIsRunning } from "./install-local-core.mjs";
import {
  localInstallCommand,
  parseRestartArguments,
} from "./install-local-restart-core.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const installerPath = join(repositoryRoot, "scripts", "install-local.mjs");
const WAIT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;

const usage = () => {
  console.error(
    "Usage: pnpm run install:local:restart <mod-id> [--profile <profile-path>]\n" +
      "       pnpm run install:local:all:restart",
  );
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

const zenIsRunning = () => zenProcessIsRunning(processCommands());

const run = (command, args, label) => {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${label} failed${result.error ? `: ${result.error.message}` : ` with exit code ${result.status}`}`,
    );
  }
};

const waitForZen = async expectedRunning => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (zenIsRunning() !== expectedRunning) {
    if (Date.now() >= deadline) {
      throw new Error(
        expectedRunning
          ? "Zen did not reopen within 30 seconds"
          : "Zen did not quit within 30 seconds; resolve any open quit prompt and retry",
      );
    }
    await delay(POLL_INTERVAL_MS);
  }
};

const quitZen = async () => {
  if (!zenIsRunning()) {
    console.log("Zen is already closed.");
    return;
  }
  console.log("Quitting Zen cleanly...");
  run("osascript", ["-e", 'tell application "Zen" to quit'], "requesting Zen quit");
  await waitForZen(false);
};

const reopenZen = async () => {
  console.log("Reopening Zen...");
  run("open", ["-a", "Zen"], "reopening Zen");
  await waitForZen(true);
};

const restartInstall = async options => {
  if (process.platform !== "darwin") {
    throw new Error("restart-aware installation currently supports macOS only");
  }

  let failure = null;
  try {
    await quitZen();
    const command = localInstallCommand(options, {
      nodePath: process.execPath,
      installerPath,
    });
    run(command.command, command.args, "local installation");
  } catch (error) {
    failure = error;
  }

  try {
    await reopenZen();
  } catch (error) {
    failure ??= error;
    if (failure !== error) {
      console.error(
        `Additionally, Zen could not be reopened: ${error?.message ?? error}`,
      );
    }
  }

  if (failure) {
    throw failure;
  }
  console.log("Local install complete; Zen is running again.");
};

try {
  await restartInstall(parseRestartArguments(process.argv.slice(2)));
} catch (error) {
  usage();
  console.error(`\nRestart-aware local install failed: ${error?.message ?? error}`);
  process.exitCode = 1;
}
