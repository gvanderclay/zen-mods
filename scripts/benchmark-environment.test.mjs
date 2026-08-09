import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  baselineCompatibilityProblems,
  benchmarkArtifactProblems,
  benchmarkDefinitionFiles,
  benchmarkDefinitionHash,
  expectedBenchmarkArtifactNames,
  prepareBenchmarkRecording,
} from "./benchmark-environment.mjs";

const current = {
  artifacts: {
    "one.json": "summary-hash",
    "one.samples.json": "samples-hash",
  },
  compatibility: {
    architecture: "arm64",
    cpu: "Example CPU",
    logicalCpuCount: 8,
    node: "v24.6.0",
    platform: "darwin",
    release: "25.5.0",
    v8: "13.6",
    vitest: "4.1.10",
  },
  definition: { sha256: "definition-hash" },
};

const recorded = {
  ...current,
  schemaVersion: 2,
  state: "complete",
};

describe("benchmarkDefinitionHash", () => {
  it("is stable across file enumeration order", () => {
    const first = benchmarkDefinitionHash([
      ["b.ts", "second"],
      ["a.ts", "first"],
    ]);
    const second = benchmarkDefinitionHash([
      ["a.ts", "first"],
      ["b.ts", "second"],
    ]);

    expect(first).toBe(second);
  });

  it("changes with either a path or its contents", () => {
    const baseline = benchmarkDefinitionHash([["a.ts", "first"]]);

    expect(benchmarkDefinitionHash([["b.ts", "first"]])).not.toBe(baseline);
    expect(benchmarkDefinitionHash([["a.ts", "second"]])).not.toBe(baseline);
  });

  it("includes the root and participant compiler configurations", async () => {
    const files = await benchmarkDefinitionFiles();
    const compilerConfigurations = [
      "tsconfig.base.json",
      "mods/keep-loaded/tsconfig.json",
      "mods/sidebar-context-menu-customizer/tsconfig.json",
      "mods/tab-deduplicator/tsconfig.json",
    ];

    expect(files).toEqual(expect.arrayContaining(compilerConfigurations));

    const entries = compilerConfigurations.map(path => [path, "unchanged"]);
    const baseline = benchmarkDefinitionHash(entries);
    for (const changedPath of compilerConfigurations) {
      const changed = benchmarkDefinitionHash(
        entries.map(([path, contents]) => [
          path,
          path === changedPath ? "changed" : contents,
        ]),
      );

      expect(changed).not.toBe(baseline);
      expect(
        baselineCompatibilityProblems(
          { ...recorded, definition: { sha256: baseline } },
          { ...current, definition: { sha256: changed } },
        ),
      ).toContain("benchmark definitions changed since the baseline was recorded");
    }
  });
});

describe("prepareBenchmarkRecording", () => {
  it("marks the generation as recording and clears only expected artifacts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "zen-benchmark-begin-"));
    const expectedArtifacts = expectedBenchmarkArtifactNames(["one", "two"]);
    try {
      await Promise.all(
        expectedArtifacts.map(name => writeFile(join(directory, name), "stale\n")),
      );
      await writeFile(join(directory, "environment.json"), '{"state":"complete"}\n');
      await writeFile(join(directory, "unrelated.json"), "preserve me\n");
      await mkdir(join(directory, "bundles"));
      await writeFile(join(directory, "bundles", "graph.json"), "preserve me too\n");

      await prepareBenchmarkRecording({
        directory,
        metadata: { schemaVersion: 2, state: "recording" },
        modIds: ["one", "two"],
      });

      expect((await readdir(directory)).sort()).toEqual([
        "bundles",
        "environment.json",
        "unrelated.json",
      ]);
      expect(
        JSON.parse(await readFile(join(directory, "environment.json"), "utf8")),
      ).toEqual({ schemaVersion: 2, state: "recording" });
      expect(await readFile(join(directory, "unrelated.json"), "utf8")).toBe(
        "preserve me\n",
      );
      expect(await readFile(join(directory, "bundles", "graph.json"), "utf8")).toBe(
        "preserve me too\n",
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

describe("baselineCompatibilityProblems", () => {
  it("accepts a complete matching generation", () => {
    expect(baselineCompatibilityProblems(recorded, current)).toEqual([]);
  });

  it("rejects an interrupted recording", () => {
    expect(
      baselineCompatibilityProblems({ ...recorded, state: "recording" }, current),
    ).toContain("benchmark recording did not complete");
  });

  it("rejects workload, environment, and artifact drift", () => {
    const changed = {
      artifacts: { ...current.artifacts, "one.samples.json": "changed" },
      compatibility: { ...current.compatibility, node: "v25.0.0" },
      definition: { sha256: "changed" },
    };

    expect(baselineCompatibilityProblems(recorded, changed)).toEqual([
      "benchmark definitions changed since the baseline was recorded",
      "runtime or machine differs from the recorded baseline",
      "benchmark artifact changed after recording: one.samples.json",
    ]);
  });

  it("rejects a mixed artifact generation", () => {
    const changed = {
      ...current,
      artifacts: { ...current.artifacts, "two.json": "new" },
    };

    expect(baselineCompatibilityProblems(recorded, changed)).toContain(
      "benchmark artifact set differs from the recorded baseline",
    );
  });
});

describe("benchmarkArtifactProblems", () => {
  const benchmark = {
    id: "benchmark-id",
    max: 2,
    mean: 1.5,
    min: 1,
    name: "work",
    sampleCount: 2,
  };
  const summary = {
    files: [
      {
        groups: [{ benchmarks: [{ ...benchmark, samples: [] }] }],
      },
    ],
  };
  const raw = {
    files: [
      {
        benchmarks: [{ ...benchmark, fullName: "suite > work", samples: [1, 2] }],
      },
    ],
  };

  it("accepts matching Vitest summary and raw reports", () => {
    expect(benchmarkArtifactProblems(summary, raw)).toEqual([]);
  });

  it("rejects dropped, extra, and mismatched benchmark results", () => {
    expect(benchmarkArtifactProblems(summary, { files: [] })).toContain(
      "benchmark id set differs between summary and raw reports",
    );
    expect(
      benchmarkArtifactProblems(summary, {
        files: [
          {
            benchmarks: [
              ...raw.files[0].benchmarks,
              { ...raw.files[0].benchmarks[0], id: "extra" },
            ],
          },
        ],
      }),
    ).toContain("benchmark id set differs between summary and raw reports");
    expect(
      benchmarkArtifactProblems(summary, {
        files: [
          {
            benchmarks: [{ ...raw.files[0].benchmarks[0], mean: 99 }],
          },
        ],
      }),
    ).toContain("benchmark summary differs for benchmark-id: mean");
  });
});
