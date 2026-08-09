const DEVELOPMENT_DIRECTORIES = new Set([
  "__mocks__",
  "__tests__",
  "bench",
  "benches",
  "benchmark",
  "benchmarks",
  "fixture",
  "fixtures",
  "harness",
  "mock",
  "mocks",
  "test",
  "test-support",
  "tests",
  "tools",
]);

const DEVELOPMENT_FILE = /\.(?:bench|benchmark|spec|test)\.[cm]?[jt]sx?$/i;
const isTestRuntimePackage = packageName =>
  packageName === "tinybench" ||
  packageName === "vitest" ||
  packageName.startsWith("@vitest/");

const normalizePath = value => value.replaceAll("\\", "/");

const isDevelopmentPath = value => {
  const normalized = normalizePath(value);
  const segments = normalized.split("/").filter(Boolean);
  const basename = segments.at(-1) ?? "";
  return (
    DEVELOPMENT_FILE.test(basename) ||
    segments.some(segment => DEVELOPMENT_DIRECTORIES.has(segment.toLowerCase()))
  );
};

const importReference = imported => imported.original ?? imported.path;

const PORTABLE_BUNDLE_LABEL = /^[a-z0-9][a-z0-9._-]*$/i;

export const portableBundleLabel = value => {
  if (typeof value !== "string" || !PORTABLE_BUNDLE_LABEL.test(value)) {
    throw new Error("theme.json id must be a portable bundle-report name");
  }
  return value;
};

/**
 * Return every development-only file made structurally reachable from the entry.
 * Import edges are inspected as well as resolved inputs because esbuild can erase an
 * unused TypeScript import before resolving it into `metafile.inputs`.
 */
export const forbiddenProductionInputs = metafile => {
  const forbidden = new Set();
  for (const [inputPath, input] of Object.entries(metafile.inputs)) {
    const normalizedInput = normalizePath(inputPath);
    if (isDevelopmentPath(normalizedInput)) {
      forbidden.add(normalizedInput);
    }
    for (const imported of input.imports) {
      const reference = normalizePath(importReference(imported));
      if (isDevelopmentPath(reference)) {
        forbidden.add(`${normalizedInput} -> ${reference}`);
      }
    }
  }
  return [...forbidden].sort();
};

const packageNameFromSpecifier = specifier => {
  const normalized = normalizePath(specifier);
  if (
    normalized.startsWith(".") ||
    normalized.startsWith("/") ||
    /^[a-z][a-z+.-]*:/i.test(normalized)
  ) {
    return null;
  }
  const [first, second] = normalized.split("/");
  if (!first) {
    return null;
  }
  return first.startsWith("@") && second ? `${first}/${second}` : first;
};

const packagesFromNodeModulesPath = inputPath => {
  const names = [];
  const sections = `/${normalizePath(inputPath)}`.split("/node_modules/").slice(1);
  for (const section of sections) {
    const packageName = packageNameFromSpecifier(section);
    if (packageName && packageName !== ".pnpm") {
      names.push(packageName);
    }
  }
  return names;
};

const developmentDependencyReferences = (metafile, developmentOnlyPackages) => {
  const references = new Map(developmentOnlyPackages.map(name => [name, new Set()]));
  const recordPackage = (packageName, reference) => {
    if (!references.has(packageName) && !isTestRuntimePackage(packageName)) {
      return;
    }
    const matches = references.get(packageName) ?? new Set();
    matches.add(normalizePath(reference));
    references.set(packageName, matches);
  };
  const recordSpecifier = specifier => {
    const packageName = packageNameFromSpecifier(specifier);
    if (packageName) {
      recordPackage(packageName, specifier);
    }
  };

  for (const [inputPath, input] of Object.entries(metafile.inputs)) {
    for (const packageName of packagesFromNodeModulesPath(inputPath)) {
      recordPackage(packageName, inputPath);
    }
    for (const imported of input.imports) {
      recordSpecifier(importReference(imported));
    }
  }
  for (const output of Object.values(metafile.outputs)) {
    for (const imported of output.imports) {
      recordSpecifier(importReference(imported));
    }
  }

  return [...references.entries()]
    .filter(([, matches]) => matches.size > 0)
    .map(([packageName]) => packageName)
    .sort();
};

export const productionBundleProblems = (
  metafile,
  { entryPoint, outputPath, developmentOnlyPackages = [] },
) => {
  const expectedEntry = normalizePath(entryPoint);
  const expectedOutput = normalizePath(outputPath);
  const outputs = new Map(
    Object.entries(metafile.outputs).map(([path, output]) => [
      normalizePath(path),
      output,
    ]),
  );
  const problems = forbiddenProductionInputs(metafile).map(
    path => `development-only path: ${path}`,
  );

  for (const packageName of developmentDependencyReferences(
    metafile,
    developmentOnlyPackages,
  )) {
    problems.push(`development-only dependency: ${packageName}`);
  }

  for (const path of outputs.keys()) {
    if (path !== expectedOutput) {
      problems.push(`unexpected output: ${path}`);
    }
  }

  const output = outputs.get(expectedOutput);
  if (!output) {
    problems.push(`missing output: ${expectedOutput}`);
  } else {
    const actualEntry = output.entryPoint ? normalizePath(output.entryPoint) : null;
    if (actualEntry !== expectedEntry) {
      problems.push(
        `unexpected entry point for ${expectedOutput}: ${actualEntry ?? "none"}`,
      );
    }
    for (const imported of output.imports) {
      problems.push(
        `external output import: ${normalizePath(importReference(imported))}`,
      );
    }
  }

  return [...new Set(problems)].sort();
};

export const assertProductionBundleGraph = (metafile, options) => {
  const problems = productionBundleProblems(metafile, options);
  if (problems.length > 0) {
    throw new Error(
      `${options.label} production bundle graph is invalid:\n${problems
        .map(problem => `- ${problem}`)
        .join("\n")}`,
    );
  }
};
