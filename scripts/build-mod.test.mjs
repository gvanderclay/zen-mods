import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repository = resolve(import.meta.dirname, "..");
const buildScript = join(repository, "scripts/build-mod.mjs");
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { force: true, recursive: true })),
  );
});

const temporaryMod = async () => {
  const directory = await mkdtemp(join(tmpdir(), "zen-mod-build-"));
  temporaryDirectories.push(directory);
  const output = join(directory, "dist/test.uc.mjs");
  await mkdir(dirname(output), { recursive: true });
  await mkdir(join(directory, "src"));
  await writeFile(
    join(directory, "theme.json"),
    JSON.stringify({
      id: "build-test",
      scripts: { "dist/test.uc.mjs": { include: ["browser.xhtml"] } },
    }),
  );
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "@zen-mods/build-test", dependencies: {} }),
  );
  return { directory, output };
};

describe("build-mod", () => {
  it("keeps the previous good bundle when graph validation fails", async () => {
    const { directory, output } = await temporaryMod();
    const previousBundle = "// previous good bundle\n";
    await writeFile(output, previousBundle);
    await writeFile(join(directory, "src/main.ts"), 'import "./helper.test.ts";\n');
    await writeFile(
      join(directory, "src/helper.test.ts"),
      "globalThis.fixture = true;\n",
    );

    const result = spawnSync(process.execPath, [buildScript], {
      cwd: directory,
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "development-only path: src/helper.test.ts",
    );
    await expect(readFile(output, "utf8")).resolves.toBe(previousBundle);
  });
});
