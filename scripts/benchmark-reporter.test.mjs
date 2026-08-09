import { describe, expect, it } from "vitest";

import {
  assertRawBenchmarkReport,
  rawBenchmarkReport,
  rawSampleOutputPath,
} from "./benchmark-reporter.mjs";

describe("rawBenchmarkReport", () => {
  it("retains samples with their benchmark and suite identity", () => {
    const modules = [
      {
        task: {
          file: {
            filepath: "/repo/mods/example/benchmarks/core.bench.ts",
            tasks: [
              {
                name: "100 tabs",
                tasks: [
                  {
                    id: "benchmark-id",
                    meta: { benchmark: true },
                    name: "plan duplicates",
                    result: {
                      benchmark: {
                        max: 2,
                        mean: 1.5,
                        min: 1,
                        sampleCount: 2,
                        samples: [1, 2],
                      },
                    },
                  },
                ],
                type: "suite",
              },
            ],
          },
        },
      },
    ];

    expect(rawBenchmarkReport(modules)).toEqual({
      files: [
        {
          benchmarks: [
            {
              fullName: "100 tabs > plan duplicates",
              id: "benchmark-id",
              max: 2,
              mean: 1.5,
              min: 1,
              name: "plan duplicates",
              sampleCount: 2,
              samples: [1, 2],
            },
          ],
          filepath: "/repo/mods/example/benchmarks/core.bench.ts",
        },
      ],
    });
  });

  it("fails closed on a benchmark task without a result", () => {
    const modules = [
      {
        task: {
          file: {
            filepath: "/repo/example.bench.ts",
            tasks: [
              { id: "test", meta: {}, name: "ordinary test", result: {}, type: "test" },
              {
                id: "pending",
                meta: { benchmark: true },
                name: "pending benchmark",
                type: "test",
              },
            ],
          },
        },
      },
    ];

    expect(() => rawBenchmarkReport(modules)).toThrow(
      "pending benchmark is marked as a benchmark but has no result",
    );
  });
});

describe("rawSampleOutputPath", () => {
  it("places raw samples beside the comparison report", () => {
    expect(rawSampleOutputPath("/tmp/keep-loaded.json")).toBe(
      "/tmp/keep-loaded.samples.json",
    );
    expect(rawSampleOutputPath("/tmp/keep-loaded")).toBe("/tmp/keep-loaded.samples.json");
  });
});

describe("assertRawBenchmarkReport", () => {
  it("accepts non-empty samples whose count matches", () => {
    const report = {
      files: [
        {
          benchmarks: [
            {
              fullName: "suite > work",
              id: "benchmark-id",
              max: 2,
              mean: 1.5,
              min: 1,
              name: "work",
              sampleCount: 2,
              samples: [1, 2],
            },
          ],
          filepath: "/repo/work.bench.ts",
        },
      ],
    };

    expect(() => assertRawBenchmarkReport(report)).not.toThrow();
  });

  it("fails closed when Vitest returns no benchmark samples", () => {
    expect(() => assertRawBenchmarkReport({ files: [] })).toThrow(
      "raw benchmark report contains no benchmark results",
    );
    expect(() =>
      assertRawBenchmarkReport({
        files: [
          {
            benchmarks: [
              {
                fullName: "suite > work",
                id: "benchmark-id",
                max: 0,
                mean: 0,
                min: 0,
                name: "work",
                sampleCount: 0,
                samples: [],
              },
            ],
            filepath: "/repo/work.bench.ts",
          },
        ],
      }),
    ).toThrow("suite > work has no raw samples");
  });

  it("rejects a sample-count mismatch", () => {
    expect(() =>
      assertRawBenchmarkReport({
        files: [
          {
            benchmarks: [
              {
                fullName: "suite > work",
                id: "benchmark-id",
                max: 2,
                mean: 1.5,
                min: 1,
                name: "work",
                sampleCount: 3,
                samples: [1, 2],
              },
            ],
            filepath: "/repo/work.bench.ts",
          },
        ],
      }),
    ).toThrow("suite > work recorded 2 raw samples but reports 3");
  });

  it("rejects duplicate ids and non-finite samples", () => {
    const benchmark = {
      fullName: "suite > work",
      id: "duplicate",
      max: 2,
      mean: 1.5,
      min: 1,
      name: "work",
      sampleCount: 2,
      samples: [1, 2],
    };

    expect(() =>
      assertRawBenchmarkReport({
        files: [
          {
            benchmarks: [benchmark, { ...benchmark, fullName: "suite > other" }],
            filepath: "/repo/work.bench.ts",
          },
        ],
      }),
    ).toThrow("duplicate raw benchmark id duplicate");
    expect(() =>
      assertRawBenchmarkReport({
        files: [
          {
            benchmarks: [
              { ...benchmark, max: Number.POSITIVE_INFINITY, samples: [1, NaN] },
            ],
            filepath: "/repo/work.bench.ts",
          },
        ],
      }),
    ).toThrow("suite > work contains a non-finite raw sample");
  });
});
