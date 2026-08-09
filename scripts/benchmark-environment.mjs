import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertRawBenchmarkReport } from "./benchmark-reporter.mjs";
import { portableBundleLabel } from "./build-graph.mjs";

const repository = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(repository, ".benchmarks");
const metadataPath = resolve(outputDirectory, "environment.json");

const command = (executable, args) =>
  execFileSync(executable, args, {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

const optionalCommand = (executable, args) => {
  try {
    return command(executable, args);
  } catch {
    return null;
  }
};

const parseIniSection = (raw, section) => {
  const values = {};
  let currentSection = "";
  for (const sourceLine of raw.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      currentSection = line.slice(1, -1);
      continue;
    }
    if (currentSection !== section || !line || line.startsWith(";")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator > 0) {
      values[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }
  return values;
};

const zenMetadata = async () => {
  const applicationIni =
    process.env.ZEN_APPLICATION_INI ??
    "/Applications/Zen.app/Contents/Resources/application.ini";
  try {
    const raw = await readFile(applicationIni, "utf8");
    const app = parseIniSection(raw, "App");
    const gecko = parseIniSection(raw, "Gecko");
    return {
      applicationIni,
      buildId: app.BuildID ?? null,
      geckoVersion: gecko.MaxVersion ?? null,
      sourceStamp: app.SourceStamp ?? null,
      version: app.Version ?? null,
    };
  } catch {
    return null;
  }
};

const walkFiles = async directory => {
  const files = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return files;
    }
    throw error;
  }
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
};

const benchmarkMods = async () => {
  const modsDirectory = resolve(repository, "mods");
  const entries = await readdir(modsDirectory, { withFileTypes: true });
  const mods = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const directory = resolve(modsDirectory, entry.name);
    const packageManifest = JSON.parse(
      await readFile(resolve(directory, "package.json"), "utf8"),
    );
    const benchmarkScripts = ["bench", "bench:record", "bench:compare"];
    const presentScripts = benchmarkScripts.filter(
      name => packageManifest.scripts?.[name],
    );
    if (presentScripts.length === 0) {
      continue;
    }
    if (presentScripts.length !== benchmarkScripts.length) {
      throw new Error(
        `${packageManifest.name ?? entry.name} must define bench, bench:record, and bench:compare together`,
      );
    }
    const theme = JSON.parse(await readFile(resolve(directory, "theme.json"), "utf8"));
    mods.push({ directory, id: portableBundleLabel(theme.id) });
  }
  return mods.toSorted((left, right) => left.id.localeCompare(right.id));
};

export const benchmarkDefinitionFiles = async () => {
  const paths = [
    resolve(repository, "package.json"),
    resolve(repository, "pnpm-lock.yaml"),
    resolve(repository, "pnpm-workspace.yaml"),
    resolve(repository, "tsconfig.base.json"),
    resolve(repository, "vitest.config.ts"),
    resolve(repository, "scripts/benchmark-environment.mjs"),
    resolve(repository, "scripts/benchmark-reporter.mjs"),
  ];
  for (const mod of await benchmarkMods()) {
    paths.push(resolve(mod.directory, "package.json"));
    paths.push(resolve(mod.directory, "tsconfig.json"));
    const benchmarkFiles = await walkFiles(resolve(mod.directory, "benchmarks"));
    paths.push(
      ...benchmarkFiles.filter(path => /\.(?:bench|benchmark)\.[cm]?[jt]sx?$/.test(path)),
    );
  }
  return [...new Set(paths)]
    .map(path => relative(repository, path).replaceAll("\\", "/"))
    .sort();
};

export const benchmarkDefinitionHash = entries => {
  const hash = createHash("sha256");
  for (const [path, contents] of entries.toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    hash.update(path);
    hash.update("\0");
    hash.update(contents);
    hash.update("\0");
  }
  return hash.digest("hex");
};

const benchmarkDefinition = async () => {
  const files = await benchmarkDefinitionFiles();
  const entries = await Promise.all(
    files.map(async path => [path, await readFile(resolve(repository, path))]),
  );
  return { files, sha256: benchmarkDefinitionHash(entries) };
};

const sha256 = contents => createHash("sha256").update(contents).digest("hex");

const summaryBenchmarks = report =>
  (report.files ?? []).flatMap(file =>
    (file.groups ?? []).flatMap(group => group.benchmarks ?? []),
  );

const rawBenchmarks = report =>
  (report.files ?? []).flatMap(file => file.benchmarks ?? []);

export const benchmarkArtifactProblems = (summary, raw) => {
  const problems = [];
  const summaryById = new Map(
    summaryBenchmarks(summary).map(benchmark => [benchmark.id, benchmark]),
  );
  const rawById = new Map(rawBenchmarks(raw).map(benchmark => [benchmark.id, benchmark]));
  const summaryIds = [...summaryById.keys()].sort();
  const rawIds = [...rawById.keys()].sort();
  if (!stableEqual(summaryIds, rawIds)) {
    return ["benchmark id set differs between summary and raw reports"];
  }
  for (const id of summaryIds) {
    const summaryBenchmark = summaryById.get(id);
    const rawBenchmark = rawById.get(id);
    for (const field of ["name", "sampleCount", "mean", "min", "max"]) {
      if (summaryBenchmark[field] !== rawBenchmark[field]) {
        problems.push(`benchmark summary differs for ${id}: ${field}`);
      }
    }
  }
  return problems;
};

const readArtifact = async name => {
  let raw;
  try {
    raw = await readFile(resolve(outputDirectory, name), "utf8");
  } catch (error) {
    throw new Error(`missing benchmark artifact ${name}`, { cause: error });
  }
  try {
    return { raw, report: JSON.parse(raw) };
  } catch (error) {
    throw new Error(`benchmark artifact ${name} is not valid JSON`, { cause: error });
  }
};

const artifactHashes = async () => {
  const hashes = {};
  for (const { id } of await benchmarkMods()) {
    const summaryName = `${id}.json`;
    const samplesName = `${id}.samples.json`;
    const summary = await readArtifact(summaryName);
    const samples = await readArtifact(samplesName);
    if (!Array.isArray(summary.report.files) || summary.report.files.length === 0) {
      throw new Error(`benchmark artifact ${summaryName} contains no benchmark files`);
    }
    assertRawBenchmarkReport(samples.report);
    const problems = benchmarkArtifactProblems(summary.report, samples.report);
    if (problems.length > 0) {
      throw new Error(
        `${id} benchmark artifacts disagree:\n${problems
          .map(problem => `- ${problem}`)
          .join("\n")}`,
      );
    }
    hashes[summaryName] = sha256(summary.raw);
    hashes[samplesName] = sha256(samples.raw);
  }
  return hashes;
};

const runtimeAndMachine = async packageManifest => {
  const cpuList = cpus();
  const runtime = {
    node: process.version,
    pnpm: optionalCommand("pnpm", ["--version"]),
    v8: process.versions.v8,
    vitest: packageManifest.devDependencies?.vitest ?? null,
    esbuild: packageManifest.devDependencies?.esbuild ?? null,
  };
  const machine = {
    architecture: arch(),
    cpu: cpuList[0]?.model ?? null,
    logicalCpuCount: cpuList.length,
    memoryBytes: totalmem(),
    platform: platform(),
    release: release(),
  };
  return {
    compatibility: {
      architecture: machine.architecture,
      cpu: machine.cpu,
      logicalCpuCount: machine.logicalCpuCount,
      node: runtime.node,
      nodeOptions: process.env.NODE_OPTIONS ?? null,
      platform: machine.platform,
      release: machine.release,
      v8: runtime.v8,
      vitest: runtime.vitest,
    },
    machine,
    runtime,
  };
};

const stableEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export const baselineCompatibilityProblems = (recorded, current) => {
  const problems = [];
  if (recorded.schemaVersion !== 2) {
    problems.push(`unsupported metadata schema ${recorded.schemaVersion ?? "missing"}`);
  }
  if (recorded.state !== "complete") {
    problems.push("benchmark recording did not complete");
  }
  if (recorded.definition?.sha256 !== current.definition.sha256) {
    problems.push("benchmark definitions changed since the baseline was recorded");
  }
  if (!stableEqual(recorded.compatibility, current.compatibility)) {
    problems.push("runtime or machine differs from the recorded baseline");
  }
  const recordedArtifacts = recorded.artifacts ?? {};
  const recordedNames = Object.keys(recordedArtifacts).sort();
  const currentNames = Object.keys(current.artifacts).sort();
  if (!stableEqual(recordedNames, currentNames)) {
    problems.push("benchmark artifact set differs from the recorded baseline");
  } else {
    for (const name of currentNames) {
      if (recordedArtifacts[name] !== current.artifacts[name]) {
        problems.push(`benchmark artifact changed after recording: ${name}`);
      }
    }
  }
  return problems;
};

const writeMetadata = async (metadata, destination = metadataPath) => {
  await mkdir(dirname(destination), { recursive: true });
  const temporaryPath = `${destination}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`);
    await rename(temporaryPath, destination);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
};

export const expectedBenchmarkArtifactNames = modIds =>
  [
    ...new Set(
      modIds.flatMap(id => {
        const label = portableBundleLabel(id);
        return [`${label}.json`, `${label}.samples.json`];
      }),
    ),
  ].sort();

export const prepareBenchmarkRecording = async ({ directory, metadata, modIds }) => {
  await writeMetadata(metadata, resolve(directory, "environment.json"));
  await Promise.all(
    expectedBenchmarkArtifactNames(modIds).map(name =>
      rm(resolve(directory, name), { force: true }),
    ),
  );
};

const currentContext = async ({ includeArtifacts }) => {
  const packageManifest = JSON.parse(
    await readFile(resolve(repository, "package.json"), "utf8"),
  );
  const context = {
    definition: await benchmarkDefinition(),
    ...(await runtimeAndMachine(packageManifest)),
  };
  if (includeArtifacts) {
    context.artifacts = await artifactHashes();
  }
  return context;
};

const readMetadata = async () => {
  try {
    return JSON.parse(await readFile(metadataPath, "utf8"));
  } catch (error) {
    throw new Error("benchmark baseline metadata is missing; run pnpm run bench:record", {
      cause: error,
    });
  }
};

const beginRecording = async () => {
  const context = await currentContext({ includeArtifacts: false });
  const mods = await benchmarkMods();
  await prepareBenchmarkRecording({
    directory: outputDirectory,
    modIds: mods.map(mod => mod.id),
    metadata: {
      schemaVersion: 2,
      state: "recording",
      recordedAt: new Date().toISOString(),
      command: "pnpm run bench:record",
      definition: context.definition,
      compatibility: context.compatibility,
      git: {
        commit: command("git", ["rev-parse", "HEAD"]),
        status: optionalCommand("git", ["status", "--short"]) ?? "unavailable",
      },
      runtime: context.runtime,
      machine: context.machine,
      zen: await zenMetadata(),
    },
  });
  console.log("benchmark baseline: recording started");
};

const completeRecording = async () => {
  const recorded = await readMetadata();
  const current = await currentContext({ includeArtifacts: true });
  const problems = baselineCompatibilityProblems(
    { ...recorded, artifacts: current.artifacts, state: "complete" },
    current,
  );
  if (recorded.state !== "recording") {
    problems.unshift("benchmark baseline was not in the recording state");
  }
  if (problems.length > 0) {
    throw new Error(`cannot complete benchmark baseline:\n${problems.join("\n")}`);
  }
  await writeMetadata({
    ...recorded,
    artifacts: current.artifacts,
    completedAt: new Date().toISOString(),
    state: "complete",
  });
  console.log("benchmark baseline: recording complete");
};

const validateBaseline = async () => {
  const recorded = await readMetadata();
  if (recorded.state !== "complete") {
    throw new Error(
      "benchmark baseline is not comparable; the last recording did not complete. Run pnpm run bench:record",
    );
  }
  const current = await currentContext({ includeArtifacts: true });
  const problems = baselineCompatibilityProblems(recorded, current);
  if (problems.length > 0) {
    throw new Error(
      `benchmark baseline is not comparable; run pnpm run bench:record:\n${problems
        .map(problem => `- ${problem}`)
        .join("\n")}`,
    );
  }
  console.log("benchmark baseline: definitions, environment, and artifacts match");
};

const main = async () => {
  const operation = process.argv[2] ?? "--begin";
  if (operation === "--begin") {
    await beginRecording();
  } else if (operation === "--complete") {
    await completeRecording();
  } else if (operation === "--validate") {
    await validateBaseline();
  } else {
    throw new Error(`unknown benchmark metadata operation: ${operation}`);
  }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
