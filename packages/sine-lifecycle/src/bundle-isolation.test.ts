import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const packageRoot = decodeURIComponent(new URL("../", import.meta.url).pathname);

const bundledInputs = async (
  subpath: string,
  symbol: string,
  usage: "exported" | "unused" = "exported",
) => {
  const result = await build({
    absWorkingDir: packageRoot,
    bundle: true,
    format: "esm",
    logLevel: "silent",
    metafile: true,
    platform: "browser",
    stdin: {
      contents:
        usage === "exported"
          ? `export { ${symbol} } from "@zen-mods/sine-lifecycle/${subpath}";`
          : `import { ${symbol} } from "@zen-mods/sine-lifecycle/${subpath}"; export const marker = 1;`,
      resolveDir: packageRoot,
      sourcefile: `${subpath}-consumer.ts`,
    },
    target: "firefox153",
    treeShaking: true,
    write: false,
  });
  const output = Object.values(result.metafile.outputs)[0];
  return Object.entries(output?.inputs ?? {})
    .filter(
      ([path, contribution]) =>
        path.startsWith("dist/") && contribution.bytesInOutput > 0,
    )
    .map(([path]) => path.slice("dist/".length))
    .sort();
};

describe("published subpath isolation", () => {
  it.each([
    ["disposable-scope", "DisposableScope", ["disposable-scope.js", "errors.js"]],
    [
      "generation-scope",
      "GenerationScope",
      ["disposable-scope.js", "errors.js", "generation-scope.js"],
    ],
    ["sine-window", "bindSineWindowLifecycle", ["sine-window.js"]],
  ])(
    "bundles only %s and its direct implementation dependencies",
    async (subpath, symbol, expected) => {
      await expect(bundledInputs(subpath, symbol)).resolves.toEqual(expected);
    },
  );

  it.each([
    ["disposable-scope", "DisposableScope"],
    ["generation-scope", "GenerationScope"],
    ["sine-window", "bindSineWindowLifecycle"],
  ])("contributes zero bytes when %s is imported but unused", async (subpath, symbol) => {
    await expect(bundledInputs(subpath, symbol, "unused")).resolves.toEqual([]);
  });
});
