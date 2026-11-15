import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repository = resolve(import.meta.dirname, "..");
const biome = join(repository, "node_modules/@biomejs/biome/bin/biome");
let fixtureRoot;

// Generate fixtures in ignored scratch space, so normal repository lint never sees
// intentionally failing examples. Copy the real config to test its plugin includes too.
beforeAll(async () => {
  const scratch = join(repository, ".scratch/tmp");
  await mkdir(scratch, { recursive: true });
  fixtureRoot = await mkdtemp(join(scratch, "timing-readiness-"));
  const config = JSON.parse(await readFile(join(repository, "biome.json"), "utf8"));
  config.vcs.enabled = false;
  config.plugins = config.plugins.map(plugin => ({
    ...plugin,
    path: resolve(repository, plugin.path),
  }));
  await writeFile(join(fixtureRoot, "biome.json"), JSON.stringify(config));
});

afterAll(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

const lint = async fixtures => {
  for (const [path, code] of Object.entries(fixtures)) {
    const absolute = join(fixtureRoot, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, code);
  }
  const result = spawnSync(
    process.execPath,
    [
      biome,
      "lint",
      "--only=plugin",
      "--reporter=json",
      "--max-diagnostics=none",
      ...Object.keys(fixtures),
    ],
    { cwd: fixtureRoot, encoding: "utf8" },
  );
  expect(result.error).toBeUndefined();
  const report = JSON.parse(result.stdout);
  return { result, report, output: result.stdout + result.stderr };
};

const calls = [
  "",
  "window.",
  "destination.",
  "owner.window.",
  "this.",
  "getWindow().",
  "windows[index].",
].flatMap(receiver => [
  `${receiver}addEventListener("MozAfterPaint", callback);`,
  `${receiver}setTimeout(callback);`,
  `${receiver}setTimeout(callback, 0);`,
  `${receiver}requestAnimationFrame(callback);`,
]);

describe("timing-readiness Biome plugin", () => {
  it("reports every timing pattern on bare calls and arbitrary receivers in both source trees", async () => {
    const fixtures = Object.fromEntries(
      ["mods/example/src", "packages/example/src"].flatMap(directory =>
        calls.map((call, index) => [`${directory}/pattern-${index}.ts`, call]),
      ),
    );
    const { result, report, output } = await lint(fixtures);
    expect(result.status, output).toBe(1);
    expect(report.diagnostics).toHaveLength(Object.keys(fixtures).length);
    for (const path of Object.keys(fixtures)) {
      const diagnostics = report.diagnostics.filter(diagnostic =>
        diagnostic.location.path.endsWith(path),
      );
      expect(diagnostics, path).toHaveLength(1);
      expect(diagnostics[0].category).toBe("plugin");
      expect(diagnostics[0].severity).toBe("error");
      expect(diagnostics[0].message).toContain("platform's readiness signal");
      expect(diagnostics[0].message).toContain("lint/plugin/timing-readiness");
    }
  });

  it("matches single quotes, listener options, multiline calls, and timer callback arguments", async () => {
    const { result, report, output } = await lint({
      "mods/example/src/variants.ts": [
        "destination.addEventListener(",
        "  'MozAfterPaint',",
        "  callback,",
        "  { once: true },",
        ");",
        "window.setTimeout(callback, 0, argument);",
        "setTimeout(callback, 0, argument);",
        "window.requestAnimationFrame(() => callback());",
      ].join("\n"),
    });
    expect(result.status, output).toBe(1);
    expect(report.diagnostics).toHaveLength(4);
  });

  it("accepts rule-specific reasons, including nested multiline paint and timer calls", async () => {
    const suppressed = calls
      .flatMap(call => [
        "// biome-ignore lint/plugin/timing-readiness: deliberate layout scheduling, not startup readiness",
        call,
      ])
      .join("\n");
    const { result, report, output } = await lint({
      "packages/example/src/suppressed.ts": suppressed,
      "mods/example/src/nested.ts": [
        "// biome-ignore lint/plugin/timing-readiness: compatibility fallback for windows with no startup promise",
        "destination.addEventListener(",
        '  "MozAfterPaint",',
        "  // biome-ignore lint/plugin/timing-readiness: defer restoration outside the paint callback",
        "  () => destination.setTimeout(restore, 0),",
        "  { once: true },",
        ");",
      ].join("\n"),
    });
    expect(result.status, output).toBe(0);
    expect(report.diagnostics).toEqual([]);
  });

  it("does not report nonzero or variable delays, other events, or cancellation", async () => {
    const { result, report, output } = await lint({
      "mods/example/src/allowed.ts": [
        'window.addEventListener("before-initial-tab-adopted", callback);',
        'window.addEventListener("popupshown", callback);',
        "setTimeout(callback, 1);",
        "destination.setTimeout(callback, delay);",
        "window.setTimeout(callback, 100, argument);",
        "setTimeout(callback, 1, 0);",
        "destination.setTimeout(callback, delay, 0);",
        "window.setTimeout(() => callback(a, b), 1);",
        'window.setTimeout(callback, "0");',
        "window.cancelAnimationFrame(frame);",
        "window.clearTimeout(timer);",
      ].join("\n"),
    });
    expect(result.status, output).toBe(0);
    expect(report.diagnostics).toEqual([]);
  });

  it("excludes tests and files outside mod/package source", async () => {
    const fixtures = Object.fromEntries(
      [
        "mods/example/src/runtime.test.ts",
        "packages/example/src/runtime.test.mjs",
        "mods/example/src/runtime.spec.ts",
        "packages/example/src/__tests__/runtime.ts",
        "mods/example/tests/runtime.ts",
        "packages/example/tests/runtime.ts",
        "scripts/example.ts",
      ].map(path => [path, calls.join("\n")]),
    );
    const { result, report, output } = await lint(fixtures);
    expect(result.status, output).toBe(0);
    expect(report.diagnostics).toEqual([]);
  });
});
