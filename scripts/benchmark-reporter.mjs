import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const benchmarkTasks = (tasks, parents = []) => {
  const benchmarks = [];
  for (const task of tasks ?? []) {
    const lineage = [...parents, task.name].filter(Boolean);
    const markedAsBenchmark = task.meta?.benchmark === true;
    const benchmark = task.result?.benchmark;
    if (markedAsBenchmark && !benchmark) {
      throw new Error(
        `${lineage.join(" > ") || task.id || "unknown task"} is marked as a benchmark but has no result`,
      );
    }
    if (markedAsBenchmark && benchmark) {
      benchmarks.push({
        id: task.id,
        name: task.name,
        fullName: lineage.join(" > "),
        ...benchmark,
      });
    }
    benchmarks.push(...benchmarkTasks(task.tasks, lineage));
  }
  return benchmarks;
};

/**
 * Vitest's built-in benchmark JSON intentionally empties `samples`. This reporter
 * keeps a separate raw file while the pinned runner's internal benchmark tasks still
 * contain them. The internal shape is isolated here and covered by a fixture test.
 */
export const rawBenchmarkReport = testModules => ({
  files: testModules.map(testModule => {
    const file = testModule.task?.file ?? testModule.task ?? testModule;
    return {
      filepath: file.filepath,
      benchmarks: benchmarkTasks(file.tasks),
    };
  }),
});

export const assertRawBenchmarkReport = report => {
  if (!Array.isArray(report?.files)) {
    throw new Error("raw benchmark report has no files array");
  }
  const benchmarks = report.files.flatMap(file => file.benchmarks ?? []);
  if (benchmarks.length === 0) {
    throw new Error("raw benchmark report contains no benchmark results");
  }
  const ids = new Set();
  for (const benchmark of benchmarks) {
    if (!benchmark.id || !benchmark.name || !benchmark.fullName) {
      throw new Error("raw benchmark identity is incomplete");
    }
    if (ids.has(benchmark.id)) {
      throw new Error(`duplicate raw benchmark id ${benchmark.id}`);
    }
    ids.add(benchmark.id);
    const samples = benchmark.samples;
    if (!Array.isArray(samples) || samples.length === 0) {
      throw new Error(`${benchmark.fullName} has no raw samples`);
    }
    if (samples.some(sample => !Number.isFinite(sample) || sample < 0)) {
      throw new Error(`${benchmark.fullName} contains a non-finite raw sample`);
    }
    if (!Number.isInteger(benchmark.sampleCount) || benchmark.sampleCount <= 0) {
      throw new Error(`${benchmark.fullName} has an invalid sample count`);
    }
    if (benchmark.sampleCount !== samples.length) {
      throw new Error(
        `${benchmark.fullName} recorded ${samples.length} raw samples but reports ${benchmark.sampleCount}`,
      );
    }
    for (const field of ["mean", "min", "max"]) {
      if (!Number.isFinite(benchmark[field]) || benchmark[field] < 0) {
        throw new Error(`${benchmark.fullName} has an invalid ${field}`);
      }
    }
  }
};

export const rawSampleOutputPath = comparisonOutputPath =>
  comparisonOutputPath.endsWith(".json")
    ? `${comparisonOutputPath.slice(0, -".json".length)}.samples.json`
    : `${comparisonOutputPath}.samples.json`;

export default class RawBenchmarkReporter {
  context;

  onInit(context) {
    this.context = context;
  }

  async onTestRunEnd(testModules) {
    const configuredOutput = this.context?.config.benchmark?.outputJson;
    if (!configuredOutput) {
      return;
    }
    const comparisonOutput = resolve(this.context.config.root, configuredOutput);
    const sampleOutput = rawSampleOutputPath(comparisonOutput);
    const report = rawBenchmarkReport(testModules);
    assertRawBenchmarkReport(report);
    await mkdir(dirname(sampleOutput), { recursive: true });
    await writeFile(sampleOutput, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Raw benchmark samples written to ${sampleOutput}`);
  }
}
