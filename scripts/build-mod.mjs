import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { build, context } from "esbuild";

import { assertProductionBundleGraph, portableBundleLabel } from "./build-graph.mjs";

const workingDirectory = process.cwd();
const repositoryDirectory = resolve(import.meta.dirname, "..");
const manifestPath = resolve(workingDirectory, "theme.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const modId = portableBundleLabel(manifest.id);
const packageManifest = JSON.parse(
  await readFile(resolve(workingDirectory, "package.json"), "utf8"),
);
const repositoryManifest = JSON.parse(
  await readFile(resolve(repositoryDirectory, "package.json"), "utf8"),
);
const outputs = Object.keys(manifest.scripts ?? {});

if (outputs.length !== 1 || !outputs[0]?.endsWith(".uc.mjs")) {
  throw new Error(`${manifestPath} must declare exactly one .uc.mjs entry in scripts`);
}

const output = resolve(workingDirectory, outputs[0]);
const outputFromWorkspace = relative(workingDirectory, output);
if (isAbsolute(outputFromWorkspace) || outputFromWorkspace.startsWith("..")) {
  throw new Error(`script output must stay inside its mod directory: ${outputs[0]}`);
}

const productionDependencies = new Set([
  ...Object.keys(packageManifest.dependencies ?? {}),
  ...Object.keys(packageManifest.optionalDependencies ?? {}),
  ...Object.keys(packageManifest.peerDependencies ?? {}),
]);
const developmentOnlyPackages = [
  ...Object.keys(repositoryManifest.devDependencies ?? {}),
  ...Object.keys(packageManifest.devDependencies ?? {}),
].filter(packageName => !productionDependencies.has(packageName));
const writeMetafile = process.argv.includes("--metafile");
const metafileOutput = resolve(
  repositoryDirectory,
  ".benchmarks/bundles",
  `${modId}.metafile.json`,
);

const atomicWrite = async (path, contents) => {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, contents);
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
};

const guardedWriter = {
  name: "zen-production-bundle-guard",
  setup(buildApi) {
    buildApi.onEnd(async result => {
      if (result.errors.length > 0) {
        return;
      }
      try {
        if (!result.metafile || !result.outputFiles) {
          throw new Error("esbuild did not return the requested bundle graph and output");
        }
        assertProductionBundleGraph(result.metafile, {
          label: modId,
          entryPoint: "src/main.ts",
          outputPath: outputFromWorkspace,
          developmentOnlyPackages,
        });

        const outputFile = result.outputFiles.find(file => resolve(file.path) === output);
        if (!outputFile || result.outputFiles.length !== 1) {
          throw new Error(
            `${modId} produced ${result.outputFiles.length} in-memory outputs instead of ${outputFromWorkspace}`,
          );
        }

        await atomicWrite(output, outputFile.contents);
        if (writeMetafile) {
          await atomicWrite(
            metafileOutput,
            `${JSON.stringify(result.metafile, null, 2)}\n`,
          );
          console.log(`bundle graph: ${relative(workingDirectory, metafileOutput)}`);
        }
      } catch (error) {
        return {
          errors: [
            {
              text: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      }
    });
  },
};

const options = {
  absWorkingDir: workingDirectory,
  entryPoints: ["src/main.ts"],
  outfile: output,
  bundle: true,
  format: "esm",
  target: "firefox153",
  platform: "browser",
  charset: "utf8",
  banner: { js: "// Generated from src/ by build.mjs — do not edit." },
  logLevel: "info",
  metafile: true,
  plugins: [guardedWriter],
  treeShaking: true,
  write: false,
};

if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
