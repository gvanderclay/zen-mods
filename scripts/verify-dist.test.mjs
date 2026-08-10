import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "verify-dist.mjs");
const temporaryDirectories = [];
let mod;
let repository;

const git = (...args) => spawnSync("git", args, { cwd: repository, encoding: "utf8" });

const verify = () =>
  spawnSync(process.execPath, [script], { cwd: mod, encoding: "utf8" });

beforeEach(async () => {
  repository = await mkdtemp(join(tmpdir(), "zen-verify-dist-"));
  temporaryDirectories.push(repository);
  mod = join(repository, "mods/example");
  await mkdir(join(mod, "dist"), { recursive: true });
  await writeFile(
    join(mod, "theme.json"),
    JSON.stringify({ scripts: { "dist/example.uc.mjs": {} } }),
  );
  await writeFile(join(mod, "dist/example.uc.mjs"), "// generated\n");
  expect(git("init", "--quiet").status).toBe(0);
  expect(git("add", ".").status).toBe(0);
  expect(
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ).status,
  ).toBe(0);
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { force: true, recursive: true })),
  );
});

describe("verify-dist", () => {
  it("accepts tracked generated output with no worktree drift", () => {
    const result = verify();
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it("rejects a newly declared bundle that was not added to Git", async () => {
    await writeFile(
      join(mod, "theme.json"),
      JSON.stringify({
        scripts: {
          "dist/example.sys.mjs": {},
          "dist/example.uc.mjs": {},
        },
      }),
    );
    await writeFile(join(mod, "dist/example.sys.mjs"), "// generated system\n");

    const result = verify();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("declared bundle is not tracked by Git");
  });

  it("rejects untracked junk and modified tracked output", async () => {
    await writeFile(join(mod, "dist/junk.txt"), "junk\n");
    let result = verify();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("untracked dist file(s)");

    await rm(join(mod, "dist/junk.txt"));
    await writeFile(join(mod, "dist/example.uc.mjs"), "// stale\n");
    result = verify();
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("example.uc.mjs");
  });

  it("rejects staged dist junk even when the worktree matches the index", async () => {
    await writeFile(join(mod, "dist/staged-junk.mjs"), "// junk\n");
    expect(git("add", "mods/example/dist/staged-junk.mjs").status).toBe(0);

    const result = verify();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("tracked dist file(s) not declared by the manifest");
    expect(result.stderr).toContain("dist/staged-junk.mjs");
  });

  it("rejects a retired output that remains tracked", async () => {
    await writeFile(join(mod, "dist/retired.sys.mjs"), "// retired\n");
    await writeFile(
      join(mod, "theme.json"),
      JSON.stringify({
        scripts: {
          "dist/example.uc.mjs": {},
          "dist/retired.sys.mjs": {},
        },
      }),
    );
    expect(git("add", ".").status).toBe(0);
    expect(
      git(
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "--quiet",
        "-m",
        "add second output",
      ).status,
    ).toBe(0);
    await writeFile(
      join(mod, "theme.json"),
      JSON.stringify({ scripts: { "dist/example.uc.mjs": {} } }),
    );
    expect(git("add", "mods/example/theme.json").status).toBe(0);

    const result = verify();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("tracked dist file(s) not declared by the manifest");
    expect(result.stderr).toContain("dist/retired.sys.mjs");
  });
});
