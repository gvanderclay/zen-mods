/** Launch the recorded Zen/Sine pair with one allowlisted mod in a throwaway profile. */

import { execFile, execFileSync, spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  localModEntry,
  profilePathFromIni,
  validateManifest,
} from "../../../scripts/install-local-core.mjs";
import {
  assertMatchingPlatform,
  captureInstalledPlatform,
  captureSineStamp,
  regularFiles,
  selectPlatformStamp,
  sha256,
} from "./installed-platform.mjs";
import pinnedPlatformStamp from "./platform-stamp.json" with { type: "json" };

const HARNESS_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const LIFECYCLE_FIXTURE_PATHS = Object.freeze({
  carrier: join(HARNESS_DIRECTORY, "fixtures/lifecycle-carrier.sys.mjs"),
  window: join(HARNESS_DIRECTORY, "fixtures/lifecycle-window.uc.mjs"),
});
const ZEN_ROOT = join(homedir(), "Library", "Application Support", "zen");
const DEFAULT_BINARY = "/Applications/Zen.app/Contents/MacOS/zen";
const ZEN_RESOURCES = "/Applications/Zen.app/Contents/Resources";
const execFileAsync = promisify(execFile);

export const LIVE_MOD_ID = "keep-loaded-lifecycle-harness";

const fixtureManifest = {
  id: LIVE_MOD_ID,
  name: "Keep Loaded lifecycle harness",
  description: "Synthetic exact-Sine multi-window lifecycle fixture.",
  version: "1.0.0",
  scripts: {
    "fixtures/lifecycle-carrier.sys.mjs": { loadOrder: 1 },
    "fixtures/lifecycle-window.uc.mjs": {
      include: ["chrome://browser/content/browser.xhtml"],
      loadOrder: 2,
    },
  },
  supportsUnload: true,
};

const lifecycleFixture = {
  enabled: false,
  manifest: fixtureManifest,
  relativePaths: ["fixtures"],
  sourceDirectory: HARNESS_DIRECTORY,
};

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

const readSineProfile = async explicitProfile => {
  const profile = explicitProfile
    ? resolve(explicitProfile)
    : profilePathFromIni(
        await readFile(join(ZEN_ROOT, "profiles.ini"), "utf8"),
        ZEN_ROOT,
      );
  const chromeDirectory = join(profile, "chrome");
  return { chromeDirectory, profile };
};

const availablePort = async () => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve, reject) =>
    server.close(error => (error ? reject(error) : resolve())),
  );
  if (!port) throw new Error("could not reserve a Marionette port");
  return port;
};

export const parseProfileProcessIds = (output, { binary, profile }) =>
  output
    .split("\n")
    .map(line => line.trim().match(/^(\d+)\s+(.+)$/))
    .filter(Boolean)
    .filter(([, , command]) => {
      const arguments_ = command.split(/\s+/);
      if (arguments_[0] !== binary) return false;
      return arguments_.some(
        (argument, index) =>
          ((argument === "--profile" || argument === "-profile") &&
            arguments_[index + 1] === profile) ||
          argument === `--profile=${profile}` ||
          argument === `-profile=${profile}`,
      );
    })
    .map(match => Number.parseInt(match[1], 10))
    .filter(pid => Number.isInteger(pid) && pid > 1 && pid !== process.pid);

const profileProcessIds = async (profile, binary) => {
  const { stdout } = await execFileAsync("/bin/ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return parseProfileProcessIds(stdout, { binary, profile });
};

const waitForProfileExit = async (readProcessIds, timeoutMilliseconds) => {
  const deadline = Date.now() + timeoutMilliseconds;
  let pids = await readProcessIds();
  while (pids.length > 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
    pids = await readProcessIds();
  }
  return pids;
};

const signalProcesses = (pids, signal) => {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
};

export const startTrackedProcess = (binary, arguments_, options) => {
  const child = spawn(binary, arguments_, options);
  const started = new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  return { child, started };
};

export const createZenArguments = ({ headless, profile }) => [
  headless ? "--headless" : "-foreground",
  "--no-remote",
  "--marionette",
  "--remote-allow-system-access",
  "--profile",
  profile,
  "about:blank",
];

/** Keep Node's default terminating signals from bypassing asynchronous Zen cleanup. */
export const installShutdownSignals = ({
  emitter = process,
  exit = code => process.exit(code),
  label,
  shutdown,
}) => {
  let signalExitCode = null;
  const exitAfterSignal = code => {
    if (signalExitCode !== null) {
      return;
    }
    signalExitCode = code;
    let cleanup;
    try {
      cleanup = shutdown();
    } catch (error) {
      cleanup = Promise.reject(error);
    }
    void Promise.resolve(cleanup)
      .catch(error => console.error(`${label} cleanup failed: ${error?.stack ?? error}`))
      .finally(() => exit(code));
  };
  const onInterrupt = () => exitAfterSignal(130);
  const onTerminate = () => exitAfterSignal(143);
  emitter.on("SIGINT", onInterrupt);
  emitter.on("SIGTERM", onTerminate);
  return () => {
    emitter.removeListener("SIGINT", onInterrupt);
    emitter.removeListener("SIGTERM", onTerminate);
  };
};

const stageProfile = async ({ profile, sineChromeDirectory, sineStamp, stagedMod }) => {
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

const preferences = port => [
  ["marionette.port", port],
  ["browser.shell.checkDefaultBrowser", false],
  ["browser.startup.homepage_override.mstone", '"ignore"'],
  ["browser.sessionstore.resume_from_crash", false],
  ["browser.sessionstore.restore_pinned_tabs_on_demand", true],
  ["datareporting.policy.dataSubmissionEnabled", false],
  ["toolkit.telemetry.enabled", false],
  ["app.update.auto", false],
  ["sine.auto-updates", false],
  ["sine.allow-unsafe-js", true],
];

export const launchLiveZen = async ({
  headless = true,
  sineProfile,
  binary = DEFAULT_BINARY,
  platformMode = "observed",
  stagedMod = lifecycleFixture,
} = {}) => {
  const sine = await readSineProfile(sineProfile ?? process.env.SINE_PROFILE);
  const observedPlatformStamp = await captureInstalledPlatform({
    sineChromeDirectory: sine.chromeDirectory,
    zenResources: ZEN_RESOURCES,
  });
  const platformStamp = selectPlatformStamp({
    mode: platformMode,
    observed: observedPlatformStamp,
    pinned: pinnedPlatformStamp,
  });
  const port = await availablePort();
  const profile = await mkdtemp(join(tmpdir(), "zen-keep-loaded-lifecycle-"));
  let stagedModEvidence;
  try {
    stagedModEvidence = await stageProfile({
      profile,
      sineChromeDirectory: sine.chromeDirectory,
      sineStamp: platformStamp.sine,
      stagedMod,
    });
    const userPreferences = preferences(port).map(
      ([name, value]) => `user_pref(${JSON.stringify(name)}, ${value});`,
    );
    await writeFile(join(profile, "user.js"), `${userPreferences.join("\n")}\n`);
  } catch (error) {
    await rm(profile, { recursive: true, force: true });
    throw error;
  }

  let launched;
  try {
    launched = startTrackedProcess(binary, createZenArguments({ headless, profile }), {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, MOZ_MARIONETTE: "1" },
    });
  } catch (error) {
    await rm(profile, { recursive: true, force: true });
    throw error;
  }
  const { child, started } = launched;
  const output = [];
  child.stdout?.on("data", chunk => output.push(String(chunk)));
  child.stderr?.on("data", chunk => output.push(String(chunk)));
  try {
    await started;
  } catch (error) {
    await rm(profile, { recursive: true, force: true });
    throw new Error(`could not launch Zen binary ${binary}: ${error.message}`, {
      cause: error,
    });
  }

  let stopPromise;
  const stop = async () => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      const readProcessIds = async () => {
        const matched = await profileProcessIds(profile, binary);
        if (child.pid && child.exitCode === null && child.signalCode === null) {
          matched.push(child.pid);
        }
        return [...new Set(matched)];
      };
      let pids = await readProcessIds();
      if (pids.length > 0) {
        signalProcesses(pids, "SIGTERM");
        pids = await waitForProfileExit(readProcessIds, 5_000);
      }
      if (pids.length > 0) {
        signalProcesses(pids, "SIGKILL");
        pids = await waitForProfileExit(readProcessIds, 5_000);
      }
      if (pids.length > 0) {
        throw new Error(
          `Zen retained profile ${profile} after SIGKILL (PIDs ${pids.join(", ")}); ` +
            "the profile was retained for diagnosis",
        );
      }
      try {
        const finalPlatformStamp = await captureInstalledPlatform({
          sineChromeDirectory: sine.chromeDirectory,
          zenResources: ZEN_RESOURCES,
        });
        assertMatchingPlatform(platformStamp, finalPlatformStamp, "live run platform");
      } finally {
        await rm(profile, { recursive: true, force: true });
      }
    })();
    return stopPromise;
  };

  return {
    childPid: child.pid,
    output,
    platformStamp,
    port,
    profile,
    sineSourceProfile: sine.profile,
    stagedMod: stagedModEvidence,
    activate: () => {
      if (headless || !child.pid) return;
      execFileSync("osascript", [
        "-e",
        `tell application "System Events" to set frontmost of (first process whose unix id is ${child.pid}) to true`,
      ]);
    },
    stop,
  };
};
