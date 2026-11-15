// Executed only by the disposable repository's real pre-push hook.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { withoutRepositoryGitEnvironment } from "../git-environment.mjs";

const [sandbox, gitDirectory, mode] = process.argv.slice(2);
const root = process.cwd();
const fixture = join(sandbox, "fixture");
const reportPath = join(sandbox, "hook-report.json");
const report = {
  cwd: root,
  gitDir: process.env.GIT_DIR,
  gitWorkTree: process.env.GIT_WORK_TREE ?? null,
  mode,
};

// The negative control deliberately retains Git's environment, but only after proving
// that the real hook points at THIS disposable linked worktree, never the caller's repo.
assert.equal(resolve(process.env.GIT_DIR), gitDirectory);
assert.ok(gitDirectory.startsWith(`${sandbox}/`));
assert.equal(process.env.GIT_WORK_TREE, undefined);

const run = (command, args, cwd, env) => {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8" });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
};

try {
  process.chdir(join(root, "mods/example"));
  // Keep the actual hook environment: the verifier must sanitize its own Git calls.
  run(
    process.execPath,
    [resolve(import.meta.dirname, "../verify-dist.mjs")],
    process.cwd(),
    {
      ...process.env,
      ZEN_VERIFY_DIST_BASE: "HEAD",
    },
  );
  report.verifierPassed = true;

  await mkdir(fixture);
  const env =
    mode === "unsafe" ? process.env : withoutRepositoryGitEnvironment(process.env);
  run("git", ["init", "--quiet"], fixture, env);
  // Fail before add/commit in the negative control if init targeted the linked
  // worktree's gitdir instead of the fixture. This keeps intentional damage bounded.
  await readFile(join(fixture, ".git/HEAD"));
  await writeFile(join(fixture, "fixture.txt"), "fixture only\n");
  run("git", ["add", "."], fixture, env);
  run(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ],
    fixture,
    env,
  );
  report.fixtureHead = run("git", ["rev-parse", "HEAD"], fixture, env).trim();
  report.fixturePassed = true;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await writeFile(reportPath, JSON.stringify(report));
}
