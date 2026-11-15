import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withoutRepositoryGitEnvironment } from "./git-environment.mjs";

const temporaryDirectories = [];
const hookRunner = resolve(import.meta.dirname, "fixtures/pre-push-worktree-hook.mjs");
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(path => rm(path, { recursive: true, force: true })),
  );
});

const setup = async mode => {
  // Sanitize before the first Git call, even when this test runs inside the real hook.
  const sandbox = await realpath(await mkdtemp(join(tmpdir(), "zen-pre-push-worktree-")));
  temporaryDirectories.push(sandbox);
  const main = join(sandbox, "main");
  const linked = join(sandbox, "linked");
  const remote = join(sandbox, "remote.git");
  const hooks = join(sandbox, "hooks");
  const env = {
    ...withoutRepositoryGitEnvironment(process.env),
    // Keep user hooks, signing, init templates and config out of the fixture.
    GIT_CONFIG_GLOBAL: join(sandbox, "no-global-config"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TEMPLATE_DIR: "",
  };
  const gitResult = (cwd, ...args) =>
    spawnSync("git", args, { cwd, env, encoding: "utf8" });
  const git = (cwd, ...args) => {
    const result = gitResult(cwd, ...args);
    expect(
      result.status,
      `git ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
    ).toBe(0);
    return result.stdout.trim();
  };

  await mkdir(join(main, "mods/example/dist"), { recursive: true });
  await mkdir(hooks);
  await writeFile(
    join(main, "mods/example/theme.json"),
    JSON.stringify({ scripts: { "dist/example.uc.mjs": {} } }),
  );
  await writeFile(join(main, "mods/example/dist/example.uc.mjs"), "// generated\n");
  git(main, "init", "--quiet");
  git(main, "add", ".");
  git(
    main,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "initial",
  );
  git(sandbox, "init", "--quiet", "--bare", remote);
  git(main, "worktree", "add", "--quiet", "--detach", linked, "HEAD");
  const gitDirectory = git(linked, "rev-parse", "--absolute-git-dir");
  git(main, "config", "core.hooksPath", hooks);
  const hook = join(hooks, "pre-push");
  await writeFile(
    hook,
    `#!/bin/sh\nexec ${[process.execPath, hookRunner, sandbox, gitDirectory, mode].map(shellQuote).join(" ")}\n`,
  );
  await chmod(hook, 0o755);

  const snapshot = async () => ({
    head: git(main, "rev-parse", "HEAD"),
    linkedHead: git(linked, "rev-parse", "HEAD"),
    bare: git(main, "config", "--bool", "--get", "core.bare"),
    config: await readFile(join(main, ".git/config")),
    index: await readFile(join(main, ".git/index")),
    linkedIndex: await readFile(join(gitDirectory, "index")),
  });
  return {
    linked,
    main,
    gitDirectory,
    snapshot,
    report: async () =>
      JSON.parse(await readFile(join(sandbox, "hook-report.json"), "utf8")),
    push: () => gitResult(linked, "push", remote, "HEAD:refs/heads/regression"),
    remoteHead: () =>
      git(sandbox, "--git-dir", remote, "rev-parse", "refs/heads/regression"),
  };
};

describe("pre-push in a linked Git worktree", () => {
  it("verifies from a mod and isolates fixture init/add/commit without changing either checkout", async () => {
    const fixture = await setup("safe");
    const before = await fixture.snapshot();
    expect(before.bare).toBe("false");
    const push = fixture.push();
    expect(push.status, `${push.stdout}\n${push.stderr}`).toBe(0);
    expect(await fixture.report()).toMatchObject({
      cwd: fixture.linked,
      gitDir: fixture.gitDirectory,
      gitWorkTree: null,
      verifierPassed: true,
      fixturePassed: true,
    });
    expect(fixture.remoteHead()).toBe(before.linkedHead);
    expect(await fixture.snapshot()).toEqual(before);
  });

  it("rejects the same hook when fixture init retains the hook's repository environment", async () => {
    const fixture = await setup("unsafe");
    const push = fixture.push();
    expect(push.status, `${push.stdout}\n${push.stderr}`).not.toBe(0);
    const report = await fixture.report();
    expect(report).toMatchObject({
      cwd: fixture.linked,
      gitDir: fixture.gitDirectory,
      gitWorkTree: null,
      verifierPassed: true,
    });
    expect(report.fixturePassed).toBeUndefined();
    expect(report.error).toContain("ENOENT");
    expect(report.error).toContain("fixture/.git/HEAD");
  });
});
