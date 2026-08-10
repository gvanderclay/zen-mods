import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const workspace = process.cwd();
const repository = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: workspace,
  encoding: "utf8",
}).trim();
const manifest = JSON.parse(await readFile(resolve(workspace, "theme.json"), "utf8"));
const declaredOutputs = Object.keys(manifest.scripts ?? {});
const portable = path => path.replaceAll("\\", "/");
const declaredRepositoryOutputs = new Set();

for (const output of declaredOutputs) {
  const absolute = resolve(workspace, output);
  const fromWorkspace = relative(workspace, absolute);
  if (isAbsolute(fromWorkspace) || fromWorkspace.startsWith("..")) {
    throw new Error(`declared script output leaves its mod directory: ${output}`);
  }
  const fromRepository = portable(relative(repository, absolute));
  declaredRepositoryOutputs.add(fromRepository);
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", fromRepository], {
      cwd: repository,
      stdio: "ignore",
    });
  } catch {
    throw new Error(
      `declared bundle is not tracked by Git: ${fromRepository}; add it before committing`,
    );
  }
}

const distFromRepository = portable(relative(repository, resolve(workspace, "dist")));
const trackedDist = execFileSync(
  "git",
  ["ls-files", "--cached", "--full-name", "-z", "--", distFromRepository],
  { cwd: repository, encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const unexpectedTracked = trackedDist.filter(
  output => !declaredRepositoryOutputs.has(output),
);
if (unexpectedTracked.length > 0) {
  throw new Error(
    `tracked dist file(s) not declared by the manifest: ${unexpectedTracked.join(", ")}`,
  );
}

const untracked = execFileSync(
  "git",
  ["ls-files", "--others", "--exclude-standard", "-z", "--", "dist"],
  { cwd: workspace, encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
if (untracked.length > 0) {
  throw new Error(`untracked dist file(s): ${untracked.join(", ")}`);
}

const diff = spawnSync("git", ["diff", "--exit-code", "--", "dist"], {
  cwd: workspace,
  stdio: "inherit",
});
if (diff.error) {
  throw diff.error;
}
if (diff.status !== 0) {
  process.exitCode = diff.status ?? 1;
}

const pushedCommitBase = process.env.ZEN_VERIFY_DIST_BASE?.trim();
if (pushedCommitBase) {
  try {
    execFileSync("git", ["rev-parse", "--verify", `${pushedCommitBase}^{commit}`], {
      cwd: repository,
      stdio: "ignore",
    });
  } catch {
    throw new Error(`bundle comparison base is not a commit: ${pushedCommitBase}`);
  }
  const committedDiff = spawnSync(
    "git",
    ["diff", "--exit-code", pushedCommitBase, "--", "dist"],
    { cwd: workspace, stdio: "inherit" },
  );
  if (committedDiff.error) {
    throw committedDiff.error;
  }
  if (committedDiff.status !== 0) {
    process.exitCode = committedDiff.status ?? 1;
  }
}
