/** Launch the stamped Zen/Sine pair in an isolated throwaway profile. */

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  localModEntry,
  profilePathFromIni,
} from "../../../../scripts/install-local-core.mjs";
import platformStamp from "./platform-stamp.json" with { type: "json" };

const HARNESS_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const MOD_DIRECTORY = resolve(HARNESS_DIRECTORY, "../..");
const ZEN_ROOT = join(homedir(), "Library", "Application Support", "zen");
const DEFAULT_BINARY = "/Applications/Zen.app/Contents/MacOS/zen";
const ZEN_RESOURCES = "/Applications/Zen.app/Contents/Resources";
const ZEN_FILES = {
  applicationIniSha256: "application.ini",
  browserOmniSha256: "browser/omni.ja",
  configSha256: "config.js",
  configPrefsSha256: "defaults/pref/config-prefs.js",
};

const sha256 = contents => createHash("sha256").update(contents).digest("hex");

const regularFiles = async (root, directory = root) => {
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

const verifySineTrees = async chromeDirectory => {
  const checks = [
    ["JS", platformStamp.sine.jsTreeSha256],
    ["utils", platformStamp.sine.utilsTreeSha256],
  ];
  for (const [path, expected] of checks) {
    const actual = await treeSha256(join(chromeDirectory, path));
    if (actual !== expected) {
      throw new Error(
        `installed Sine ${path} tree drifted from the harness stamp: ${actual}`,
      );
    }
  }
};

const readStampedSineProfile = async explicitProfile => {
  const profile = explicitProfile
    ? resolve(explicitProfile)
    : profilePathFromIni(
        await readFile(join(ZEN_ROOT, "profiles.ini"), "utf8"),
        ZEN_ROOT,
      );
  const chromeDirectory = join(profile, "chrome");
  const engine = JSON.parse(
    await readFile(join(chromeDirectory, "JS", "engine.json"), "utf8"),
  );
  if (engine.version !== platformStamp.sine.version) {
    throw new Error(
      `Sine ${engine.version} is installed; this harness is stamped for ${platformStamp.sine.version}`,
    );
  }
  for (const [path, expected] of Object.entries(platformStamp.sine.files)) {
    const actual = sha256(await readFile(join(chromeDirectory, path)));
    if (actual !== expected) {
      throw new Error(`installed Sine file drifted from the stamp: ${path}`);
    }
  }
  await verifySineTrees(chromeDirectory);
  return { chromeDirectory, profile };
};

const verifyZen = async () => {
  for (const [stampKey, relativePath] of Object.entries(ZEN_FILES)) {
    if (
      sha256(await readFile(join(ZEN_RESOURCES, relativePath))) !==
      platformStamp.zen[stampKey]
    ) {
      throw new Error(
        `installed Zen ${relativePath} drifted from the ${platformStamp.zen.version} harness stamp`,
      );
    }
  }
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
  if (!port) {
    throw new Error("could not reserve a Marionette port");
  }
  return port;
};

const stageProfile = async ({ profile, sineChromeDirectory }) => {
  const chrome = join(profile, "chrome");
  const sineMods = join(chrome, "sine-mods");
  const target = join(sineMods, "sidebar-context-menu-customizer");
  await mkdir(sineMods, { recursive: true });
  await cp(join(sineChromeDirectory, "JS"), join(chrome, "JS"), {
    recursive: true,
    dereference: true,
  });
  await cp(join(sineChromeDirectory, "utils"), join(chrome, "utils"), {
    recursive: true,
    dereference: true,
  });
  await verifySineTrees(chrome);
  await mkdir(target, { recursive: true });
  for (const path of ["dist", "styles"]) {
    await cp(join(MOD_DIRECTORY, path), join(target, path), {
      recursive: true,
      dereference: true,
    });
  }
  const manifest = JSON.parse(await readFile(join(MOD_DIRECTORY, "theme.json"), "utf8"));
  await writeFile(join(target, "theme.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(sineMods, "chrome.css"), "");
  await writeFile(join(sineMods, "content.css"), "");
  await writeFile(
    join(sineMods, "mods.json"),
    `${JSON.stringify(
      {
        [manifest.id]: {
          ...localModEntry(manifest),
          enabled: false,
        },
      },
      null,
      2,
    )}\n`,
  );
};

const preferences = port => [
  ["marionette.port", port],
  ["browser.shell.checkDefaultBrowser", false],
  ["browser.startup.homepage_override.mstone", '"ignore"'],
  ["browser.sessionstore.resume_from_crash", false],
  ["datareporting.policy.dataSubmissionEnabled", false],
  ["toolkit.telemetry.enabled", false],
  ["app.update.auto", false],
  ["sine.auto-updates", false],
  ["sine.allow-unsafe-js", true],
];

export const launchStampedZen = async ({
  headless = true,
  sineProfile,
  binary = DEFAULT_BINARY,
} = {}) => {
  await verifyZen();
  const sine = await readStampedSineProfile(sineProfile ?? process.env.SINE_PROFILE);
  const profile = await mkdtemp(join(tmpdir(), "zen-sidebar-menu-harness-"));
  const port = await availablePort();
  try {
    await stageProfile({ profile, sineChromeDirectory: sine.chromeDirectory });
    const userPreferences = preferences(port).map(
      ([name, value]) => `user_pref(${JSON.stringify(name)}, ${value});`,
    );
    await writeFile(join(profile, "user.js"), `${userPreferences.join("\n")}\n`);
  } catch (error) {
    await rm(profile, { recursive: true, force: true });
    throw error;
  }

  const args = [
    "--no-remote",
    "--marionette",
    "--remote-allow-system-access",
    "--profile",
    profile,
    "about:blank",
  ];
  if (headless) {
    args.unshift("--headless");
  } else {
    // Firefox's macOS launcher otherwise leaves this isolated second instance behind
    // an already-running Zen, and arrow panels/native menus cannot become active.
    args.unshift("-foreground");
  }
  const child = spawn(binary, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, MOZ_MARIONETTE: "1" },
  });
  const output = [];
  child.stdout?.on("data", chunk => output.push(String(chunk)));
  child.stderr?.on("data", chunk => output.push(String(chunk)));

  return {
    output,
    platformStamp,
    port,
    profile,
    sineSourceProfile: sine.profile,
    activate: () => {
      if (headless) return;
      execFileSync("osascript", [
        "-e",
        `tell application "System Events" to set frontmost of (first process whose unix id is ${child.pid}) to true`,
      ]);
    },
    stop: async () => {
      if (
        child.exitCode === null &&
        child.signalCode === null &&
        child.pid !== undefined
      ) {
        await new Promise((resolve, reject) => {
          let failTimer;
          let forceTimer;
          const onExit = () => {
            clearTimeout(forceTimer);
            clearTimeout(failTimer);
            resolve();
          };
          forceTimer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              child.kill("SIGKILL");
            }
          }, 5_000);
          failTimer = setTimeout(() => {
            child.removeListener("exit", onExit);
            reject(
              new Error(
                `Zen did not exit after SIGKILL; retained its profile at ${profile}`,
              ),
            );
          }, 10_000);
          child.once("exit", onExit);
          child.kill("SIGTERM");
        });
      }
      await rm(profile, { recursive: true, force: true });
    },
  };
};
