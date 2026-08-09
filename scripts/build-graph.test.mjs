import { describe, expect, it } from "vitest";

import {
  assertProductionBundleGraph,
  forbiddenProductionInputs,
  portableBundleLabel,
} from "./build-graph.mjs";

const outputPath = "dist/keep-loaded.uc.mjs";
const graphWith = (...inputs) => ({
  inputs: Object.fromEntries(inputs.map(input => [input, { bytes: 1, imports: [] }])),
  outputs: {
    [outputPath]: {
      bytes: 1,
      entryPoint: "src/main.ts",
      exports: [],
      imports: [],
      inputs: Object.fromEntries(inputs.map(input => [input, { bytesInOutput: 1 }])),
    },
  },
});

const graphOptions = {
  label: "keep-loaded",
  entryPoint: "src/main.ts",
  outputPath,
  developmentOnlyPackages: ["esbuild", "vitest"],
};

describe("portableBundleLabel", () => {
  it.each(["keep-loaded", "mod_2", "mod.id", "A1-B2"])(
    "accepts portable mod id %s",
    id => {
      expect(portableBundleLabel(id)).toBe(id);
    },
  );

  it.each([undefined, "", ".", "../escape", "nested/id", String.raw`nested\id`])(
    "rejects unsafe mod id %s",
    id => {
      expect(() => portableBundleLabel(id)).toThrow(
        "theme.json id must be a portable bundle-report name",
      );
    },
  );
});

describe("forbiddenProductionInputs", () => {
  it.each([
    "src/core/policy.test.ts",
    "src/core/policy.spec.ts",
    "bench/policy.ts",
    "benches/policy.ts",
    "benchmark/policy.ts",
    "benchmarks/duplicates.ts",
    "src/__tests__/fake-window.ts",
    "src/__mocks__/browser.ts",
    "src/fixture/tabs.ts",
    "src/fixtures/tabs.ts",
    "src/mock/browser.ts",
    "src/mocks/browser.ts",
    "src/test/browser.ts",
    "src/test-support/browser.ts",
    "src/tests/browser.ts",
    "tools/harness/probe.mjs",
    String.raw`src\benchmarks\menu.ts`,
  ])("rejects production input %s", input => {
    expect(forbiddenProductionInputs(graphWith(input))).toEqual([
      input.replaceAll("\\", "/"),
    ]);
  });

  it.each([
    "src/main.ts",
    "../../packages/browser-chrome-ui/src/anchored-editor-panel.ts",
    "src/core/benchmark-result.ts",
    "src/core/contest.ts",
    "src/core/latest-specification.ts",
    "src/platform/mockup.ts",
    "src/platform/toolshed.ts",
  ])("allows production input %s", input => {
    expect(forbiddenProductionInputs(graphWith(input))).toEqual([]);
  });

  it("returns forbidden inputs in deterministic path order", () => {
    const graph = graphWith(
      "tools/probe.mjs",
      "src/main.ts",
      "benchmarks/policy.ts",
      "src/core/policy.test.ts",
    );

    expect(forbiddenProductionInputs(graph)).toEqual([
      "benchmarks/policy.ts",
      "src/core/policy.test.ts",
      "tools/probe.mjs",
    ]);
  });

  it("rejects a development-only import edge even when no input was emitted", () => {
    const graph = graphWith("src/main.ts");
    graph.inputs["src/main.ts"].imports.push({
      external: true,
      kind: "import-statement",
      original: "./policy.test.ts",
      path: "./policy.test.ts",
    });

    expect(forbiddenProductionInputs(graph)).toEqual(["src/main.ts -> ./policy.test.ts"]);
  });

  it("rejects a reachable input even when it contributes zero output bytes", () => {
    const graph = graphWith("src/main.ts", "benchmarks/policy.ts");
    graph.outputs[outputPath].inputs["benchmarks/policy.ts"].bytesInOutput = 0;

    expect(forbiddenProductionInputs(graph)).toEqual(["benchmarks/policy.ts"]);
  });
});

describe("assertProductionBundleGraph", () => {
  it("reports every forbidden input and the bundle label", () => {
    const graph = graphWith("src/main.ts", "benchmarks/policy.ts", "src/fake.test.ts");

    expect(() => assertProductionBundleGraph(graph, graphOptions)).toThrow(
      [
        "keep-loaded production bundle graph is invalid:",
        "- development-only path: benchmarks/policy.ts",
        "- development-only path: src/fake.test.ts",
      ].join("\n"),
    );
  });

  it("accepts a production-only graph", () => {
    const graph = graphWith(
      "src/main.ts",
      "src/core/policy.ts",
      "../../packages/browser-chrome-ui/src/anchored-editor-panel.ts",
    );

    expect(() => assertProductionBundleGraph(graph, graphOptions)).not.toThrow();
  });

  it.each([
    [
      "vitest",
      "../../node_modules/.pnpm/vitest@4.1.10/node_modules/vitest/dist/index.js",
    ],
    [
      "@vitest/expect",
      "../../node_modules/.pnpm/@vitest+expect@4.1.10/node_modules/@vitest/expect/dist/index.js",
    ],
    [
      "tinybench",
      "../../node_modules/.pnpm/tinybench@2.9.0/node_modules/tinybench/dist/index.js",
    ],
  ])("rejects development-only dependency %s", (packageName, input) => {
    const graph = graphWith("src/main.ts", input);

    expect(() => assertProductionBundleGraph(graph, graphOptions)).toThrow(
      `development-only dependency: ${packageName}`,
    );
  });

  it("rejects a bare development dependency import edge", () => {
    const graph = graphWith("src/main.ts");
    graph.inputs["src/main.ts"].imports.push({
      external: true,
      kind: "import-statement",
      original: "vitest",
      path: "vitest",
    });

    expect(() => assertProductionBundleGraph(graph, graphOptions)).toThrow(
      "development-only dependency: vitest",
    );
  });

  it("rejects residual output imports", () => {
    const graph = graphWith("src/main.ts");
    graph.outputs[outputPath].imports.push({
      external: true,
      kind: "dynamic-import",
      path: "some-runtime-package",
    });

    expect(() => assertProductionBundleGraph(graph, graphOptions)).toThrow(
      "external output import: some-runtime-package",
    );
  });

  it("requires exactly the manifest output from the production entry point", () => {
    const graph = graphWith("src/main.ts");
    graph.outputs["dist/extra.uc.mjs"] = {
      bytes: 1,
      entryPoint: "src/other.ts",
      exports: [],
      imports: [],
      inputs: {},
    };

    expect(() => assertProductionBundleGraph(graph, graphOptions)).toThrow(
      [
        "keep-loaded production bundle graph is invalid:",
        "- unexpected output: dist/extra.uc.mjs",
      ].join("\n"),
    );

    graph.outputs = {
      [outputPath]: {
        ...graph.outputs[outputPath],
        entryPoint: "src/other.ts",
      },
    };

    expect(() => assertProductionBundleGraph(graph, graphOptions)).toThrow(
      "unexpected entry point for dist/keep-loaded.uc.mjs: src/other.ts",
    );
  });

  it("sorts different failures into stable diagnostics", () => {
    const graph = graphWith("tools/probe.mjs", "benchmarks/policy.ts", "src/main.ts");
    graph.outputs[outputPath].imports.push({
      external: true,
      kind: "import-statement",
      path: "z-runtime",
    });

    expect(() => assertProductionBundleGraph(graph, graphOptions)).toThrow(
      [
        "keep-loaded production bundle graph is invalid:",
        "- development-only path: benchmarks/policy.ts",
        "- development-only path: tools/probe.mjs",
        "- external output import: z-runtime",
      ].join("\n"),
    );
  });
});
