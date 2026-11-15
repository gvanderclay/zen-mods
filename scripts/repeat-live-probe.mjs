#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { withoutRepositoryGitEnvironment } from "./git-environment.mjs";

export const USAGE =
  "usage: live:repeat <package> <script> [--max N] [--until-fail | --streak N]";

export const parseArguments = args => {
  const [packageName, script, ...flags] = args;
  if (!packageName || packageName.startsWith("-") || !script?.startsWith("test:live")) {
    throw new Error(
      "usage: live:repeat <package> <test:live script> [--max N] [--until-fail | --streak N]",
    );
  }
  let max;
  let streak = null;
  let mode;
  const seen = new Set();
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (seen.has(flag)) throw new Error(`duplicate option: ${flag}`);
    seen.add(flag);
    if (flag === "--until-fail" || flag === "--streak") {
      if (mode) throw new Error("--until-fail and --streak are mutually exclusive");
      mode = flag;
    }
    if (flag === "--until-fail") continue;
    if (flag !== "--max" && flag !== "--streak")
      throw new Error(`unknown option: ${flag}`);
    const value = flags[++index];
    if (!/^[1-9]\d*$/.test(value ?? "") || !Number.isSafeInteger(Number(value))) {
      throw new Error(`${flag} requires a positive safe integer`);
    }
    if (flag === "--max") max = Number(value);
    else streak = Number(value);
  }
  return { packageName, script, max: max ?? streak ?? 10, streak };
};

const findPackage = async (root, options) => {
  for (const directory of ["mods", "packages"]) {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(root, directory, entry.name, "package.json");
      let manifest;
      try {
        manifest = JSON.parse(await readFile(path, "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (manifest.name !== options.packageName) continue;
      if (!Object.hasOwn(manifest.scripts ?? {}, options.script)) {
        throw new Error(`no existing ${options.script} script in ${path}`);
      }
      return relative(root, path);
    }
  }
  throw new Error(`unknown workspace package: ${options.packageName}`);
};

/** Include staged + unstaged changes, binary diffs, and untracked source contents. */
export const sourceFingerprint = async root => {
  const git = args =>
    execFileSync("git", args, {
      cwd: root,
      env: withoutRepositoryGitEnvironment(process.env),
      maxBuffer: 64 * 1024 * 1024,
    });
  const hash = createHash("sha256");
  hash.update(git(["rev-parse", "HEAD"]));
  hash.update(git(["diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD", "--"]));
  const paths = git([
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    "--",
    "mods/",
    "packages/",
  ])
    .toString()
    .split("\0")
    .filter(Boolean)
    .sort();
  for (const path of paths) {
    hash.update(path);
    hash.update("\0");
    hash.update(await readFile(join(root, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
};

// All live scripts (including headed/record variants) print this after writing raw
// evidence, before validation can fail. Only reported paths may supply this attempt.
export const reportedArtifacts = (output, root) => [
  ...new Set(
    [...output.matchAll(/^Raw [^\r\n]* evidence: (.+\.json)\s*$/gm)]
      .map(match => resolve(root, match[1].trim()))
      .filter(path => dirname(path) === join(root, ".benchmarks/live")),
  ),
];

const freshArtifact = async (paths, start) => {
  for (const path of paths) {
    try {
      const contents = await readFile(path, "utf8");
      const value = JSON.parse(contents);
      if (Date.parse(value.recordedAt) > start) return { path, contents, value };
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
  }
  return null;
};

const firstLine = value => String(value).split(/\r?\n/)[0];

const artifactDetails = artifact => {
  const assertions = artifact?.result?.assertions ?? [];
  const passed = assertions.filter(assertion => assertion.ok === true).length;
  return {
    assertionCounts: artifact
      ? { passed, failed: assertions.length - passed, total: assertions.length }
      : null,
    platformStamp: artifact?.stamp ?? null,
    failureSignature:
      assertions.find(assertion => assertion.ok === false)?.name ??
      (artifact?.result?.fatal ? firstLine(artifact.result.fatal) : null),
  };
};

const runAttempt = async ({ root, options, directory, number, onChild, env }) => {
  const logPath = join(directory, `attempt-${number}.log`);
  const log = createWriteStream(logPath);
  const paths = new Set();
  const pending = { stdout: "", stderr: "" };
  let tail = "";
  const consume = (chunk, stream = "stderr") => {
    log.write(chunk);
    const text = chunk.toString();
    tail = (tail + text).slice(-32_768);
    pending[stream] += text;
    const lines = pending[stream].split("\n");
    pending[stream] = lines.pop().slice(-16_384);
    for (const path of reportedArtifacts(lines.join("\n"), root)) paths.add(path);
  };
  const start = Date.now();
  const child = spawn("pnpm", ["--filter", options.packageName, "run", options.script], {
    cwd: root,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", chunk => consume(chunk, "stdout"));
  child.stderr.on("data", chunk => consume(chunk, "stderr"));
  onChild(child);
  let spawnError;
  child.once("error", error => {
    spawnError = error;
    consume(Buffer.from(error.stack));
  });
  const { exitCode, signal } = await new Promise(resolve =>
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal })),
  );
  onChild(null);
  for (const text of Object.values(pending)) {
    for (const path of reportedArtifacts(text, root)) paths.add(path);
  }
  await new Promise((resolve, reject) => {
    log.on("error", reject);
    log.end(resolve);
  });
  const end = Date.now();
  const fresh = await freshArtifact([...paths], start);
  const details = artifactDetails(fresh?.value);
  const artifactPath = fresh
    ? join(directory, `attempt-${number}-${basename(fresh.path)}`)
    : null;
  if (fresh) await writeFile(artifactPath, fresh.contents);
  const errorLine = tail
    .split(/\r?\n/)
    .find(line => /(?:Error:|failed:|fatal)/i.test(line));
  return {
    number,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    seconds: (end - start) / 1000,
    exitCode,
    signal,
    passed: exitCode === 0 && Boolean(fresh),
    ...details,
    failureSignature:
      details.failureSignature ??
      (spawnError ? firstLine(spawnError) : errorLine?.trim()) ??
      (!fresh
        ? "no fresh artifact"
        : exitCode !== 0
          ? `probe exited ${exitCode ?? signal}`
          : null),
    artifactStatus: fresh ? "fresh" : "no fresh artifact",
    recordedAt: fresh?.value.recordedAt ?? null,
    originalArtifact: fresh ? relative(root, fresh.path) : null,
    artifact: artifactPath ? basename(artifactPath) : null,
    log: basename(logPath),
  };
};

export const runRepeat = async ({
  root = process.cwd(),
  args = process.argv.slice(2),
  env = process.env,
  output = console.log,
  signals = process,
} = {}) => {
  root = resolve(root);
  const options = parseArguments(args);
  const packageManifest = await findPackage(root, options);
  const baseline = await sourceFingerprint(root);
  const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const directory = join(root, ".benchmarks/live/repeat", runId);
  await mkdir(directory, { recursive: true });
  const manifest = {
    runId,
    ...options,
    packageManifest,
    command: ["pnpm", "--filter", options.packageName, "run", options.script],
    startedAt: new Date().toISOString(),
    sourceFingerprint: baseline,
    attempts: [],
    verdict: "running",
  };
  const save = async () => {
    const path = join(directory, "manifest.json");
    await writeFile(`${path}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(`${path}.tmp`, path);
  };
  let child;
  let interrupted;
  let escalation;
  const signalChild = signal => {
    if (!child?.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  const interrupt = signal => {
    if (interrupted) return;
    interrupted = signal;
    signalChild(signal);
    // Leave the existing launcher's asynchronous shutdown/profile cleanup time to
    // finish (two five-second profile-exit waits) before forcibly stopping the group.
    escalation = setTimeout(() => signalChild("SIGKILL"), 15_000);
    escalation.unref();
  };
  const onInterrupt = () => interrupt("SIGINT");
  const onTerminate = () => interrupt("SIGTERM");
  signals.on("SIGINT", onInterrupt);
  signals.on("SIGTERM", onTerminate);
  let exitCode = 1;
  try {
    await save();
    for (let number = 1; number <= options.max; number += 1) {
      if (interrupted) break;
      const fingerprint = await sourceFingerprint(root);
      if (fingerprint !== baseline) {
        manifest.verdict = "sources changed";
        break;
      }
      const attempt = await runAttempt({
        root,
        options,
        directory,
        number,
        env,
        onChild: value => {
          child = value;
          if (child && interrupted) signalChild(interrupted);
        },
      });
      attempt.sourceFingerprint = fingerprint;
      manifest.attempts.push(attempt);
      output(
        `attempt ${number}: ${attempt.passed ? "PASS" : "FAIL"} exit=${attempt.exitCode ?? attempt.signal} ${attempt.seconds.toFixed(1)}s ${attempt.assertionCounts ? `${attempt.assertionCounts.passed}/${attempt.assertionCounts.total} assertions` : "assertions unavailable"}; ${attempt.artifactStatus}${attempt.failureSignature ? `; ${attempt.failureSignature}` : ""}`,
      );
      await save();
      if (interrupted) break;
      if ((await sourceFingerprint(root)) !== baseline) {
        manifest.verdict = "sources changed";
        break;
      }
      if (!attempt.passed) {
        manifest.verdict = "failed";
        break;
      }
      if (options.streak && number >= options.streak) {
        manifest.verdict = "streak passed";
        exitCode = 0;
        break;
      }
      if (number === options.max) {
        manifest.verdict = options.streak
          ? "max attempts exhausted"
          : "max attempts passed";
        exitCode = options.streak ? 1 : 0;
      }
    }
  } catch (error) {
    manifest.verdict = "runner error";
    manifest.error = String(error.stack ?? error);
  } finally {
    clearTimeout(escalation);
    signals.removeListener("SIGINT", onInterrupt);
    signals.removeListener("SIGTERM", onTerminate);
    if (interrupted) {
      manifest.verdict = `interrupted (${interrupted})`;
      exitCode = interrupted === "SIGINT" ? 130 : 143;
    }
    manifest.endedAt = new Date().toISOString();
    manifest.exitCode = exitCode;
    await save();
    output(
      `${manifest.verdict}: ${manifest.attempts.filter(attempt => attempt.passed).length}/${manifest.attempts.length} passed; ${join(directory, "manifest.json")}`,
    );
  }
  return { exitCode, manifest, directory };
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (process.argv.length === 3 && ["--help", "-h"].includes(process.argv[2])) {
    console.log(
      `${USAGE}\n\nOnly existing test:live* scripts are accepted. Runs serially; first failure stops.\nDefault: --until-fail --max 10. --streak N defaults --max to N.\nEvidence: .benchmarks/live/repeat/<run-id>/manifest.json and per-attempt logs/artifacts.`,
    );
  } else {
    try {
      process.exitCode = (await runRepeat()).exitCode;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
