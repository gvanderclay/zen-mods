/** Launch the recorded Zen/Sine pair with one allowlisted mod in a throwaway profile. */

import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { profilePathFromIni } from "../../../scripts/install-local-core.mjs";
import {
  assertMatchingPlatform,
  captureInstalledPlatform,
  selectPlatformStamp,
} from "./installed-platform.mjs";
import pinnedPlatformStamp from "./platform-stamp.json" with { type: "json" };
import { stageProfile } from "./staged-mod.mjs";
import {
  profileProcessIds,
  signalProcesses,
  startTrackedProcess,
  waitForProfileExit,
} from "./tracked-process.mjs";

const HARNESS_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const LIFECYCLE_FIXTURE_PATHS = Object.freeze({
  carrier: join(HARNESS_DIRECTORY, "fixtures/lifecycle-carrier.sys.mjs"),
  window: join(HARNESS_DIRECTORY, "fixtures/lifecycle-window.uc.mjs"),
});
const ZEN_ROOT = join(homedir(), "Library", "Application Support", "zen");
const DEFAULT_BINARY = "/Applications/Zen.app/Contents/MacOS/zen";
const ZEN_RESOURCES = "/Applications/Zen.app/Contents/Resources";

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
