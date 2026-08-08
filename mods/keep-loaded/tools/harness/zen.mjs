/**
 * Launches a throwaway Zen with Marionette enabled.
 *
 * `--no-remote` and a fresh profile are not optional: without them a second launch
 * talks to the Zen the user is actually working in, and the harness would be driving
 * their live browser instead of its own.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BINARY = "/Applications/Zen.app/Contents/MacOS/zen";

const PREFS = [
  ["marionette.port", 2828],
  ["browser.shell.checkDefaultBrowser", false],
  ["browser.startup.homepage_override.mstone", '"ignore"'],
  ["browser.sessionstore.resume_from_crash", false],
  ["datareporting.policy.dataSubmissionEnabled", false],
  ["toolkit.telemetry.enabled", false],
  ["app.update.auto", false],
  // The mod's own subject: leave Zen's default on so the profile behaves like a real one.
  ["browser.sessionstore.restore_pinned_tabs_on_demand", true],
];

export const launchZen = async ({ binary = BINARY, port = 2828 } = {}) => {
  const profile = await mkdtemp(join(tmpdir(), "zen-harness-"));
  const prefs = PREFS.map(([name, value]) => `user_pref("${name}", ${value});`);
  await writeFile(join(profile, "user.js"), `${prefs.join("\n")}\n`, "utf8");

  const child = spawn(
    binary,
    [
      "--headless",
      "--no-remote",
      "--marionette",
      // Chrome context is refused without it: "System access is required."
      "--remote-allow-system-access",
      "--profile",
      profile,
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, MOZ_MARIONETTE: "1" } },
  );

  const output = [];
  child.stdout?.on("data", chunk => output.push(String(chunk)));
  child.stderr?.on("data", chunk => output.push(String(chunk)));

  return {
    profile,
    port,
    output,
    stop: async () => {
      child.kill("SIGTERM");
      await rm(profile, { recursive: true, force: true });
    },
  };
};
