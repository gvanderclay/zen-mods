import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const temporaryDirectories = [];

const run = (command, args, cwd = packageRoot) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout;
};

const makeTemporaryDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "sine-lifecycle-"));
  temporaryDirectories.push(directory);
  return directory;
};

const listFiles = async directory => {
  const files = [];
  const visit = async current => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else {
        files.push(relative(directory, path));
      }
    }
  };
  await visit(directory);
  return files.sort();
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { force: true, recursive: true })),
  );
});

describe("published package", () => {
  it("exposes only side-effect-free leaf entry points", async () => {
    const manifest = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    );

    expect(manifest.private).toBe(true);
    expect(manifest.sideEffects).toBe(false);
    expect(Object.keys(manifest.exports).sort()).toEqual([
      "./disposable-scope",
      "./generation-scope",
      "./sine-window",
    ]);
    expect(manifest.exports["."]).toBeUndefined();
  });

  it("matches a clean TypeScript emit", async () => {
    const temporary = await makeTemporaryDirectory();
    const emitted = join(temporary, "dist");
    const tsc = join(repositoryRoot, "node_modules/typescript/bin/tsc");

    run(process.execPath, [
      tsc,
      "-p",
      join(packageRoot, "tsconfig.build.json"),
      "--outDir",
      emitted,
    ]);

    const actualFiles = await listFiles(join(packageRoot, "dist"));
    const emittedFiles = await listFiles(emitted);
    expect(actualFiles).toEqual(emittedFiles);
    for (const file of emittedFiles) {
      const [actual, expected] = await Promise.all([
        readFile(join(packageRoot, "dist", file)),
        readFile(join(emitted, file)),
      ]);
      expect(actual.equals(expected), file).toBe(true);
    }
  });

  it("packs only the public distribution and works from a consumer install", async () => {
    const temporary = await makeTemporaryDirectory();
    run("pnpm", ["pack", "--pack-destination", temporary]);
    const tarballs = (await readdir(temporary)).filter(file => file.endsWith(".tgz"));
    expect(tarballs).toHaveLength(1);
    const tarball = join(temporary, tarballs[0]);
    const listing = run("tar", ["-tzf", tarball]).trim().split("\n").sort();
    expect(listing).toEqual([
      "package/LICENSE",
      "package/README.md",
      "package/dist/disposable-scope.d.ts",
      "package/dist/disposable-scope.js",
      "package/dist/errors.d.ts",
      "package/dist/errors.js",
      "package/dist/generation-scope.d.ts",
      "package/dist/generation-scope.js",
      "package/dist/sine-window.d.ts",
      "package/dist/sine-window.js",
      "package/package.json",
    ]);

    const extracted = join(temporary, "extracted");
    const consumer = join(temporary, "consumer");
    const installed = join(consumer, "node_modules", "@zen-mods", "sine-lifecycle");
    await mkdir(extracted, { recursive: true });
    await mkdir(dirname(installed), { recursive: true });
    run("tar", ["-xzf", tarball, "-C", extracted]);
    await symlink(join(extracted, "package"), installed, "dir");
    await writeFile(
      join(consumer, "package.json"),
      `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
    );
    await writeFile(
      join(consumer, "index.ts"),
      [
        'import { DisposableScope } from "@zen-mods/sine-lifecycle/disposable-scope";',
        'import { GenerationScope } from "@zen-mods/sine-lifecycle/generation-scope";',
        'import { bindSineWindowLifecycle } from "@zen-mods/sine-lifecycle/sine-window";',
        "void DisposableScope;",
        "void GenerationScope;",
        "void bindSineWindowLifecycle;",
      ].join("\n"),
    );
    const tsc = join(repositoryRoot, "node_modules/typescript/bin/tsc");
    run(
      process.execPath,
      [
        tsc,
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "false",
        "--target",
        "ES2023",
        "--lib",
        "ES2023,ESNext.Disposable,DOM",
        "--module",
        "NodeNext",
        "--moduleResolution",
        "NodeNext",
        "index.ts",
      ],
      consumer,
    );
  });
});
