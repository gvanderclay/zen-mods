import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";

const repository = resolve(import.meta.dirname, "..");
const buildScript = join(repository, "scripts/build-mod.mjs");
const temporaryDirectories = [];

const waitForFile = async path => {
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      await access(path);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT" || Date.now() >= deadline) {
        throw error;
      }
      await delay(5);
    }
  }
};

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

const temporaryDualMod = async () => {
  const directory = await mkdtemp(join(tmpdir(), "zen-dual-mod-build-"));
  temporaryDirectories.push(directory);
  const ucOutput = join(directory, "dist/test.uc.mjs");
  const sysOutput = join(directory, "dist/test.sys.mjs");
  await mkdir(dirname(ucOutput), { recursive: true });
  await mkdir(join(directory, "src"));
  await writeFile(
    join(directory, "theme.json"),
    JSON.stringify({
      id: "dual-build-test",
      scripts: {
        "dist/test.sys.mjs": { loadOrder: 1 },
        "dist/test.uc.mjs": { include: ["browser.xhtml"], loadOrder: 2 },
      },
    }),
  );
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "@zen-mods/dual-build-test", dependencies: {} }),
  );
  return { directory, sysOutput, ucOutput };
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

  it("builds a declared UC and system entry together", async () => {
    const { directory, sysOutput, ucOutput } = await temporaryDualMod();
    await writeFile(join(directory, "src/main.ts"), "export const windowEntry = 1;\n");
    await writeFile(
      join(directory, "src/application.ts"),
      "export const systemEntry = 2;\n",
    );

    const result = spawnSync(process.execPath, [buildScript], {
      cwd: directory,
      encoding: "utf8",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    await expect(readFile(ucOutput, "utf8")).resolves.toContain("windowEntry");
    await expect(readFile(sysOutput, "utf8")).resolves.toContain("systemEntry");
  });

  it("preserves both previous outputs when either entry graph is invalid", async () => {
    const { directory, sysOutput, ucOutput } = await temporaryDualMod();
    const previousUc = "// previous UC\n";
    const previousSys = "// previous system\n";
    await writeFile(ucOutput, previousUc);
    await writeFile(sysOutput, previousSys);
    await writeFile(join(directory, "src/main.ts"), "export const windowEntry = 1;\n");
    await writeFile(join(directory, "src/application.ts"), 'import "./owner.test.ts";\n');
    await writeFile(join(directory, "src/owner.test.ts"), "globalThis.bad = true;\n");

    const result = spawnSync(process.execPath, [buildScript], {
      cwd: directory,
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "development-only path: src/owner.test.ts",
    );
    await expect(readFile(ucOutput, "utf8")).resolves.toBe(previousUc);
    await expect(readFile(sysOutput, "utf8")).resolves.toBe(previousSys);
  });

  it("keeps every previous output readable until replacements are ready to publish", async () => {
    const { directory, sysOutput, ucOutput } = await temporaryDualMod();
    const previousUc = "// previous UC\n";
    const previousSys = "// previous system\n";
    await writeFile(ucOutput, previousUc);
    await writeFile(sysOutput, previousSys);
    await writeFile(join(directory, "src/main.ts"), "export const windowEntry = 1;\n");
    await writeFile(
      join(directory, "src/application.ts"),
      "export const systemEntry = 2;\n",
    );
    const pause = join(directory, "publication");
    const child = spawn(process.execPath, [buildScript], {
      cwd: directory,
      env: {
        ...process.env,
        ZEN_BUILD_TEST_PAUSE_BEFORE_PUBLICATION: pause,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout += chunk;
    });
    child.stderr.on("data", chunk => {
      stderr += chunk;
    });

    await waitForFile(`${pause}.ready`);
    let observation;
    try {
      observation = await Promise.all([
        readFile(ucOutput, "utf8"),
        readFile(sysOutput, "utf8"),
      ]);
    } catch (error) {
      observation = error;
    }
    await writeFile(`${pause}.release`, "");
    const [status] = await once(child, "exit");

    expect(status, `${stdout}\n${stderr}`).toBe(0);
    expect(observation).toEqual([previousUc, previousSys]);
    await expect(readFile(ucOutput, "utf8")).resolves.toContain("windowEntry");
    await expect(readFile(sysOutput, "utf8")).resolves.toContain("systemEntry");
  });

  it("serializes concurrent publication of one mod's complete output set", async () => {
    const { directory, sysOutput, ucOutput } = await temporaryDualMod();
    await writeFile(join(directory, "src/main.ts"), 'export const generation = "a";\n');
    await writeFile(
      join(directory, "src/application.ts"),
      'export const generation = "a";\n',
    );
    const firstPause = join(directory, "first-publication");
    const secondPause = join(directory, "second-publication");
    const first = spawn(process.execPath, [buildScript], {
      cwd: directory,
      env: {
        ...process.env,
        ZEN_BUILD_TEST_PAUSE_BEFORE_PUBLICATION: firstPause,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    await waitForFile(`${firstPause}.ready`);
    await writeFile(join(directory, "src/main.ts"), 'export const generation = "b";\n');
    await writeFile(
      join(directory, "src/application.ts"),
      'export const generation = "b";\n',
    );
    const second = spawn(process.execPath, [buildScript], {
      cwd: directory,
      env: {
        ...process.env,
        ZEN_BUILD_TEST_PAUSE_BEFORE_PUBLICATION: secondPause,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    await delay(100);
    await expect(access(`${secondPause}.ready`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    await writeFile(`${firstPause}.release`, "");
    const [firstStatus] = await once(first, "exit");
    expect(firstStatus).toBe(0);

    await waitForFile(`${secondPause}.ready`);
    await writeFile(`${secondPause}.release`, "");
    const [secondStatus] = await once(second, "exit");
    expect(secondStatus).toBe(0);
    await expect(readFile(ucOutput, "utf8")).resolves.toContain('generation = "b"');
    await expect(readFile(sysOutput, "utf8")).resolves.toContain('generation = "b"');
  });

  it("restores the complete previous set when publication fails partway", async () => {
    const { directory, sysOutput, ucOutput } = await temporaryDualMod();
    const previousUc = "// previous UC\n";
    const previousSys = "// previous system\n";
    await writeFile(ucOutput, previousUc);
    await writeFile(sysOutput, previousSys);
    await writeFile(join(directory, "src/main.ts"), "export const windowEntry = 1;\n");
    await writeFile(
      join(directory, "src/application.ts"),
      "export const systemEntry = 2;\n",
    );

    const result = spawnSync(process.execPath, [buildScript], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        ZEN_BUILD_TEST_FAIL_PUBLICATION_AFTER: "1",
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "injected publication failure after 1 output",
    );
    await expect(readFile(ucOutput, "utf8")).resolves.toBe(previousUc);
    await expect(readFile(sysOutput, "utf8")).resolves.toBe(previousSys);
    const leftovers = (await readdir(join(directory, "dist"))).filter(name =>
      /\.(?:bak|tmp)-/.test(name),
    );
    expect(leftovers).toEqual([]);
  });

  it("keeps the committed output set when cleanup fails after one backup", async () => {
    const { directory, sysOutput, ucOutput } = await temporaryDualMod();
    const previousUc = "// previous UC\n";
    const previousSys = "// previous system\n";
    await writeFile(ucOutput, previousUc);
    await writeFile(sysOutput, previousSys);
    await writeFile(join(directory, "src/main.ts"), "export const windowEntry = 1;\n");
    await writeFile(
      join(directory, "src/application.ts"),
      "export const systemEntry = 2;\n",
    );

    const result = spawnSync(process.execPath, [buildScript], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        ZEN_BUILD_TEST_FAIL_BACKUP_CLEANUP_AFTER: "1",
      },
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "injected backup cleanup failure after 1 removal",
    );
    await expect(readFile(ucOutput, "utf8")).resolves.toContain("windowEntry");
    await expect(readFile(sysOutput, "utf8")).resolves.toContain("systemEntry");

    const backupFiles = (await readdir(join(directory, "dist"))).filter(name =>
      name.includes(".bak-"),
    );
    expect(backupFiles).toHaveLength(1);
    const preservedBackup = await readFile(
      join(directory, "dist", backupFiles[0]),
      "utf8",
    );
    expect([previousUc, previousSys]).toContain(preservedBackup);
  });
});
