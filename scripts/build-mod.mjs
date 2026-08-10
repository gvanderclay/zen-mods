import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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
const declaredOutputs = Object.keys(manifest.scripts ?? {});
const ucOutputs = declaredOutputs.filter(output => output.endsWith(".uc.mjs"));
const systemOutputs = declaredOutputs.filter(output => output.endsWith(".sys.mjs"));

if (
  ucOutputs.length !== 1 ||
  systemOutputs.length > 1 ||
  declaredOutputs.length !== ucOutputs.length + systemOutputs.length
) {
  throw new Error(
    `${manifestPath} must declare exactly one .uc.mjs entry and at most one .sys.mjs entry in scripts`,
  );
}

const entryFor = output =>
  output.endsWith(".sys.mjs") ? "src/application.ts" : "src/main.ts";
const entries = declaredOutputs.map(outputPath => {
  const output = resolve(workingDirectory, outputPath);
  const outputFromWorkspace = relative(workingDirectory, output);
  if (isAbsolute(outputFromWorkspace) || outputFromWorkspace.startsWith("..")) {
    throw new Error(`script output must stay inside its mod directory: ${outputPath}`);
  }
  return {
    entryPoint: entryFor(outputPath),
    output,
    outputFromWorkspace,
    outputStem: outputFromWorkspace.slice(0, -".mjs".length),
  };
});

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
const injectedPublicationPause = process.env.ZEN_BUILD_TEST_PAUSE_BEFORE_PUBLICATION;
const injectedPublicationFailureAfter = (() => {
  const raw = process.env.ZEN_BUILD_TEST_FAIL_PUBLICATION_AFTER;
  if (raw === undefined) {
    return null;
  }
  const count = Number(raw);
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error("ZEN_BUILD_TEST_FAIL_PUBLICATION_AFTER must be a positive integer");
  }
  return count;
})();
const injectedBackupCleanupFailureAfter = (() => {
  const raw = process.env.ZEN_BUILD_TEST_FAIL_BACKUP_CLEANUP_AFTER;
  if (raw === undefined) {
    return null;
  }
  const count = Number(raw);
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error(
      "ZEN_BUILD_TEST_FAIL_BACKUP_CLEANUP_AFTER must be a positive integer",
    );
  }
  return count;
})();
const metafileOutput = resolve(
  repositoryDirectory,
  ".benchmarks/bundles",
  `${modId}.metafile.json`,
);

/** Stage the complete set before atomically replacing each last-good destination. */
const publishWriteSet = async writes => {
  const nonce = `${process.pid}-${Date.now()}`;
  const prepared = [];
  const backups = [];
  const published = [];
  try {
    for (const [path, contents] of writes) {
      await mkdir(dirname(path), { recursive: true });
      const temporaryPath = `${path}.tmp-${nonce}`;
      await writeFile(temporaryPath, contents);
      prepared.push({ path, temporaryPath });
    }
    for (const { path } of prepared) {
      const backupPath = `${path}.bak-${nonce}`;
      try {
        // Keep the last-good destination readable until its validated replacement is
        // atomically renamed over it. The copy exists only for in-process rollback.
        await copyFile(path, backupPath);
        backups.push({ backupPath, path });
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
    }
    if (injectedPublicationPause) {
      await writeFile(`${injectedPublicationPause}.ready`, "");
      const deadline = Date.now() + 10_000;
      while (true) {
        try {
          await access(`${injectedPublicationPause}.release`);
          break;
        } catch (error) {
          if (error?.code !== "ENOENT" || Date.now() >= deadline) {
            throw error;
          }
          await delay(5);
        }
      }
    }
    for (const { path, temporaryPath } of prepared) {
      await rename(temporaryPath, path);
      published.push(path);
      if (injectedPublicationFailureAfter === published.length) {
        throw new Error(`injected publication failure after ${published.length} output`);
      }
    }
  } catch (error) {
    const rollbackErrors = [];
    const backupByPath = new Map(backups.map(backup => [backup.path, backup]));
    const preservedBackups = new Set();
    for (const path of published.reverse()) {
      const backup = backupByPath.get(path);
      try {
        if (backup) {
          await rename(backup.backupPath, path);
        } else {
          await rm(path, { force: true });
        }
      } catch (rollbackError) {
        if (backup) {
          preservedBackups.add(backup.backupPath);
        }
        rollbackErrors.push(
          new Error(`could not restore ${path}: ${rollbackError.message}`, {
            cause: rollbackError,
          }),
        );
      }
    }
    for (const { temporaryPath } of prepared) {
      try {
        await rm(temporaryPath, { force: true });
      } catch (cleanupError) {
        rollbackErrors.push(
          new Error(`could not remove ${temporaryPath}: ${cleanupError.message}`, {
            cause: cleanupError,
          }),
        );
      }
    }
    for (const { backupPath } of backups) {
      if (preservedBackups.has(backupPath)) {
        continue;
      }
      try {
        await rm(backupPath, { force: true });
      } catch (cleanupError) {
        rollbackErrors.push(
          new Error(`could not remove ${backupPath}: ${cleanupError.message}`, {
            cause: cleanupError,
          }),
        );
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        `bundle publication failed (${error.message}) and rollback was incomplete: ${rollbackErrors
          .map(rollbackError => rollbackError.message)
          .join("; ")}`,
      );
    }
    throw error;
  }

  // Every destination now contains its validated output. Backup removal is cleanup
  // after that commit point: reporting a cleanup failure must not roll back the new
  // set, especially when an earlier backup has already been removed.
  let removedBackups = 0;
  for (const { backupPath } of backups) {
    await rm(backupPath, { force: true });
    removedBackups += 1;
    if (injectedBackupCleanupFailureAfter === removedBackups) {
      throw new Error(`injected backup cleanup failure after ${removedBackups} removal`);
    }
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
          entries: entries.map(({ entryPoint, outputFromWorkspace }) => ({
            entryPoint,
            outputPath: outputFromWorkspace,
          })),
          developmentOnlyPackages,
        });

        const expectedOutputs = new Map(entries.map(entry => [entry.output, entry]));
        if (
          result.outputFiles.length !== expectedOutputs.size ||
          result.outputFiles.some(file => !expectedOutputs.has(resolve(file.path)))
        ) {
          throw new Error(
            `${modId} produced ${result.outputFiles.length} in-memory outputs instead of ${[
              ...expectedOutputs.values(),
            ]
              .map(entry => entry.outputFromWorkspace)
              .join(", ")}`,
          );
        }

        const writes = result.outputFiles.map(file => [
          resolve(file.path),
          file.contents,
        ]);
        if (writeMetafile) {
          writes.push([metafileOutput, `${JSON.stringify(result.metafile, null, 2)}\n`]);
        }
        await publishWriteSet(writes);
        if (writeMetafile) {
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
  entryPoints: entries.map(({ entryPoint, outputStem }) => ({
    in: entryPoint,
    out: outputStem,
  })),
  outdir: workingDirectory,
  outExtension: { ".js": ".mjs" },
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
