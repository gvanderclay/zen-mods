import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { assertRawBenchmarkReport, rawSampleOutputPath } from "./benchmark-reporter.mjs";

const repository = resolve(import.meta.dirname, "..");
const vitestCli = resolve(repository, "node_modules/vitest/vitest.mjs");
const fixture = resolve(repository, "scripts/fixtures/benchmark-smoke.bench.ts");
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, { force: true, recursive: true })),
  );
});

describe("raw benchmark reporter integration", () => {
  it("retains samples from the pinned Vitest benchmark runner", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zen-benchmark-reporter-"));
    temporaryDirectories.push(directory);
    const output = resolve(directory, "smoke.json");
    const result = spawnSync(
      process.execPath,
      [
        vitestCli,
        "bench",
        "--config",
        resolve(repository, "vitest.config.ts"),
        "--root",
        repository,
        "--maxWorkers=1",
        "--no-file-parallelism",
        "--outputJson",
        output,
        fixture,
      ],
      { cwd: repository, encoding: "utf8" },
    );

    expect(`${result.stdout}\n${result.stderr}`).not.toContain("Error");
    expect(result.status).toBe(0);
    const report = JSON.parse(await readFile(rawSampleOutputPath(output), "utf8"));
    expect(() => assertRawBenchmarkReport(report)).not.toThrow();
    const benchmarks = report.files.flatMap(file => file.benchmarks);
    expect(benchmarks).toHaveLength(1);
    expect(benchmarks[0]).toEqual(
      expect.objectContaining({
        fullName: "retain raw samples",
        sampleCount: 5,
      }),
    );
    expect(benchmarks[0].samples).toHaveLength(5);
  });
});
