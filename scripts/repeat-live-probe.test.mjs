import { execFileSync, spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  boundedSnapshot,
  PROBE,
  runNativePhases,
  SET_MOD_ENABLED,
} from "../mods/extended-tab-shortcuts/tools/harness/probe-lifecycle.mjs";
import { withoutRepositoryGitEnvironment } from "./git-environment.mjs";
import {
  parseArguments,
  reportedArtifacts,
  runRepeat,
  sourceFingerprint,
} from "./repeat-live-probe.mjs";

const runner = resolve(import.meta.dirname, "repeat-live-probe.mjs");
const temporaryDirectories = [];
let root;
let env;
const packageName = "@zen-mods/fake";
const script = "test:live-fake";
const git = (...args) =>
  execFileSync("git", args, {
    cwd: root,
    env: withoutRepositoryGitEnvironment(process.env),
    encoding: "utf8",
  });

beforeEach(async () => {
  const temporaryRoot = resolve(".scratch/tmp");
  await mkdir(temporaryRoot, { recursive: true });
  root = await mkdtemp(join(temporaryRoot, "repeat-test-"));
  temporaryDirectories.push(root);
  await mkdir(join(root, "mods/fake"), { recursive: true });
  await mkdir(join(root, "packages/shared"), { recursive: true });
  await mkdir(join(root, "bin"));
  await writeFile(
    join(root, ".gitignore"),
    ".benchmarks/\nbin/\nplan.json\ncount\n*.signal\nready\n",
  );
  await writeFile(
    join(root, "mods/fake/package.json"),
    JSON.stringify({
      name: packageName,
      scripts: { [script]: "node fake-probe.mjs" },
    }),
  );
  await writeFile(join(root, "packages/shared/source.txt"), "source\n");
  // This executable is both fake pnpm and fake probe: the runner still has to use
  // exactly the production pnpm filter/run argv. No browser or profile is used.
  await writeFile(
    join(root, "bin/pnpm"),
    `#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const args = process.argv.slice(2);
if (JSON.stringify(args) !== JSON.stringify(["--filter", "@zen-mods/fake", "run", "test:live-fake"])) throw new Error("wrong pnpm argv");
const number = existsSync("count") ? Number(readFileSync("count", "utf8")) + 1 : 1;
writeFileSync("count", String(number));
const plans = JSON.parse(readFileSync("plan.json", "utf8"));
const plan = plans[number - 1] ?? plans.at(-1);
console.log("probe stdout " + number);
console.error("probe stderr " + number);
if (plan.change) writeFileSync(plan.change, "changed-" + number);
if (plan.signal) {
  const descendant = spawn(process.execPath, [resolve("bin/descendant.mjs")], { stdio: "inherit" });
  process.on("SIGINT", () => { writeFileSync("parent.signal", "SIGINT"); });
  process.on("SIGTERM", () => { writeFileSync("parent.signal", "SIGTERM"); });
  descendant.on("exit", () => process.exit(0));
} else {
  if (!plan.missing) {
    mkdirSync(".benchmarks/live", { recursive: true });
    const path = resolve(".benchmarks/live/fake.json");
    const artifact = {
      recordedAt: plan.stale ? "2000-01-01T00:00:00.000Z" : new Date().toISOString(),
      stamp: { zen: { version: "fake" }, sine: { version: "fake" } },
      result: {
        assertions: [{ name: "fake assertion", ok: !plan.fail }],
        fatal: plan.fatal ?? null,
      },
    };
    writeFileSync(path, JSON.stringify(artifact));
    console.log("Raw fake evidence: " + path);
  }
  if (plan.exit) console.error("Error: fake fatal setup");
  process.exitCode = plan.exit ?? (plan.fail ? 1 : 0);
}
`,
  );
  await writeFile(
    join(root, "bin/descendant.mjs"),
    `
import { writeFileSync } from "node:fs";
setInterval(() => {}, 1000);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    writeFileSync("descendant.signal", signal);
    setTimeout(() => process.exit(0), 50);
  });
}
writeFileSync("ready", String(process.pid));
`,
  );
  await chmod(join(root, "bin/pnpm"), 0o755);
  git("init", "--quiet");
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  );
  env = {
    ...withoutRepositoryGitEnvironment(process.env),
    PATH: `${join(root, "bin")}:${process.env.PATH}`,
  };
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(path => rm(path, { recursive: true, force: true })),
  );
});

const run = async (plans, flags = []) => {
  await writeFile(join(root, "plan.json"), JSON.stringify(plans));
  return runRepeat({
    root,
    env,
    args: [packageName, script, ...flags],
    output: () => {},
  });
};

describe("repeat live probe", () => {
  it("defaults to a bounded until-fail run and validates arguments and exact package scripts", async () => {
    expect(parseArguments([packageName, script])).toMatchObject({
      max: 10,
      streak: null,
    });
    expect(parseArguments([packageName, script, "--streak", "3"]).max).toBe(3);
    for (const flags of [
      ["--max", "0"],
      ["--streak", "x"],
      ["--max", "1.5"],
      ["--max", "2", "--max", "3"],
      ["--until-fail", "--streak", "2"],
      ["--unknown"],
    ]) {
      expect(() => parseArguments([packageName, script, ...flags])).toThrow();
    }
    await expect(runRepeat({ root, args: [packageName, "build"] })).rejects.toThrow(
      "usage",
    );
    await expect(
      runRepeat({ root, args: [packageName, "test:live-not-defined"] }),
    ).rejects.toThrow("no existing");
    await expect(
      runRepeat({ root, args: ["@zen-mods/nonexistent", script] }),
    ).rejects.toThrow("unknown workspace");
  });

  it.each(["stale", "missing"])(
    "rejects a %s artifact without copying an old result",
    async kind => {
      await mkdir(join(root, ".benchmarks/live"), { recursive: true });
      await writeFile(
        join(root, ".benchmarks/live/fake.json"),
        JSON.stringify({ recordedAt: "2000-01-01" }),
      );
      const result = await run([{ [kind]: true }], ["--max", "3"]);
      expect(result.exitCode).toBe(1);
      expect(result.manifest.attempts).toHaveLength(1);
      expect(result.manifest.attempts[0]).toMatchObject({
        exitCode: 0,
        passed: false,
        artifactStatus: "no fresh artifact",
        artifact: null,
        failureSignature: "no fresh artifact",
      });
      expect(
        (await readdir(result.directory)).filter(path => path.includes("fake.json")),
      ).toEqual([]);
    },
  );

  it("fails on nonzero exit even with a fresh artifact, captures logs, stamps and fatal signatures", async () => {
    const result = await run(
      [{ exit: 2, fatal: "Error: fatal first line\nstack second line" }],
      ["--max", "3"],
    );
    expect(result.exitCode).toBe(1);
    expect(result.manifest.attempts).toHaveLength(1);
    const attempt = result.manifest.attempts[0];
    expect(attempt).toMatchObject({
      exitCode: 2,
      passed: false,
      artifactStatus: "fresh",
      assertionCounts: { passed: 1, failed: 0, total: 1 },
      platformStamp: { zen: { version: "fake" } },
      failureSignature: "Error: fatal first line",
    });
    expect(attempt.seconds).toBeGreaterThanOrEqual(0);
    expect(Date.parse(attempt.recordedAt)).toBeGreaterThan(Date.parse(attempt.start));
    const log = await readFile(join(result.directory, attempt.log), "utf8");
    expect(log).toContain("probe stdout 1");
    expect(log).toContain("probe stderr 1");
    expect(
      JSON.parse(await readFile(join(result.directory, "manifest.json"), "utf8")),
    ).toEqual(result.manifest);
    expect(
      JSON.parse(await readFile(join(result.directory, attempt.artifact), "utf8"))
        .recordedAt,
    ).toBe(attempt.recordedAt);
  });

  it("stops at the first failing assertion rather than running the rest of the batch", async () => {
    const result = await run([{}, { fail: true }, {}], ["--max", "3"]);
    expect(result.manifest.verdict).toBe("failed");
    expect(result.manifest.attempts).toHaveLength(2);
    expect(result.manifest.attempts[1].failureSignature).toBe("fake assertion");
    expect(await readFile(join(root, "count"), "utf8")).toBe("2");
  });

  it("succeeds when an until-fail batch reaches its max without failure", async () => {
    const result = await run([{}], ["--max", "2"]);
    expect(result.exitCode).toBe(0);
    expect(result.manifest.verdict).toBe("max attempts passed");
    expect(result.manifest.attempts).toHaveLength(2);
    expect(Date.parse(result.manifest.attempts[1].start)).toBeGreaterThanOrEqual(
      Date.parse(result.manifest.attempts[0].end),
    );
  });

  it("fails on max-run exhaustion before the requested streak", async () => {
    const result = await run([{}], ["--max", "2", "--streak", "3"]);
    expect(result.exitCode).toBe(1);
    expect(result.manifest.verdict).toBe("max attempts exhausted");
    expect(result.manifest.attempts).toHaveLength(2);
  });

  it("succeeds after the requested streak without filling the maximum", async () => {
    const result = await run([{}], ["--max", "5", "--streak", "3"]);
    expect(result.exitCode).toBe(0);
    expect(result.manifest.verdict).toBe("streak passed");
    expect(result.manifest.attempts).toHaveLength(3);
  });

  it("does not restart a streak broken by failure", async () => {
    const result = await run([{}, { fail: true }, {}, {}], ["--streak", "3"]);
    expect(result.exitCode).toBe(1);
    expect(result.manifest.attempts).toHaveLength(2);
  });

  it.each(["packages/shared/source.txt", "mods/fake/untracked.txt"])(
    "stops when %s changes mid-run, even after the last required pass",
    async change => {
      const result = await run([{ change }], ["--streak", "1"]);
      expect(result.exitCode).toBe(1);
      expect(result.manifest.verdict).toBe("sources changed");
      expect(result.manifest.attempts).toHaveLength(1);
    },
  );

  it("fingerprints staged, unstaged, and untracked source contents, not ignored artifacts", async () => {
    const baseline = await sourceFingerprint(root);
    await writeFile(join(root, "mods/fake/new.txt"), "a");
    const untracked = await sourceFingerprint(root);
    expect(untracked).not.toBe(baseline);
    await writeFile(join(root, "mods/fake/new.txt"), "b");
    expect(await sourceFingerprint(root)).not.toBe(untracked);
    git("add", "mods/fake/new.txt");
    const staged = await sourceFingerprint(root);
    await mkdir(join(root, ".benchmarks/live"), { recursive: true });
    await writeFile(join(root, ".benchmarks/live/ignored.json"), "{}");
    expect(await sourceFingerprint(root)).toBe(staged);
  });

  it.each(["SIGINT", "SIGTERM"])(
    "cleans the child process group and writes a manifest on %s",
    async signal => {
      await writeFile(join(root, "plan.json"), JSON.stringify([{ signal: true }]));
      const child = spawn(process.execPath, [runner, packageName, script, "--max", "3"], {
        cwd: root,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", chunk => {
        output += chunk;
      });
      child.stderr.on("data", chunk => {
        output += chunk;
      });
      const exited = new Promise(resolve => child.once("close", code => resolve(code)));
      // Wait only for the fake descendant's explicit ready handshake, not a browser.
      const deadline = Date.now() + 5000;
      while (true) {
        try {
          await readFile(join(root, "ready"));
          break;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        if (Date.now() > deadline) {
          child.kill("SIGKILL");
          throw new Error(output || "fake probe did not become ready");
        }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      child.kill(signal);
      expect(await exited, output).toBe(signal === "SIGINT" ? 130 : 143);
      expect(await readFile(join(root, "parent.signal"), "utf8")).toBe(signal);
      expect(await readFile(join(root, "descendant.signal"), "utf8")).toBe(signal);
      const [runId] = await readdir(join(root, ".benchmarks/live/repeat"));
      const manifest = JSON.parse(
        await readFile(
          join(root, ".benchmarks/live/repeat", runId, "manifest.json"),
          "utf8",
        ),
      );
      expect(manifest.verdict).toBe(`interrupted (${signal})`);
      expect(manifest.attempts).toHaveLength(1);
      const descendantPid = Number(await readFile(join(root, "ready"), "utf8"));
      expect(() => process.kill(descendantPid, 0)).toThrow();
    },
    10_000,
  );

  it("checks the artifact reporting contract of every installed live script", async () => {
    const repository = resolve(import.meta.dirname, "..");
    for (const entry of await readdir(join(repository, "mods"), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const mod = join(repository, "mods", entry.name);
      const manifest = JSON.parse(await readFile(join(mod, "package.json"), "utf8"));
      for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
        if (!name.startsWith("test:live")) continue;
        const probe = command.match(/node (tools\/harness\/\S+\.mjs)/)?.[1];
        expect(probe, `${manifest.name} ${name}`).toBeTruthy();
        const source = await readFile(join(mod, probe), "utf8");
        const label = source.match(
          /Raw ([^\n`]+) evidence: \$\{(?:OUTPUT|output)\}/,
        )?.[1];
        expect(label, `${manifest.name} ${name} raw evidence report`).toBeTruthy();
        expect(source).toContain("recordedAt:");
        expect(
          reportedArtifacts(
            `Raw ${label} evidence: ${root}/.benchmarks/live/example.json\n`,
            root,
          ),
        ).toEqual([join(root, ".benchmarks/live/example.json")]);
      }
    }
  });

  it("recognizes every current live probe's reported evidence label, not unrelated JSON", () => {
    const labels = [
      "lifecycle",
      "hot-reload",
      "Load Bar",
      "Load Bar pane",
      "Load Bar settings",
      "Load Bar visible-pane",
      "production close",
      "widget ownership",
      "creator-close",
      "production widget stale-generation",
      "production multi-window",
      "production wake-transaction",
      "production crash-reload",
    ];
    for (const label of labels) {
      expect(
        reportedArtifacts(
          `Raw ${label} evidence: ${root}/.benchmarks/live/example.json\n`,
          root,
        ),
      ).toEqual([join(root, ".benchmarks/live/example.json")]);
    }
    expect(
      reportedArtifacts(
        `Raw fake evidence: ${root}/.benchmarks/live/repeat/old.json\n`,
        root,
      ),
    ).toEqual([]);
  });
});

describe("Extended Tab Shortcuts failure snapshots", () => {
  it("bounds snapshots even with oversized Unicode URLs", () => {
    const value = boundedSnapshot({ urls: Array(100).fill("😀".repeat(1000)) });
    expect(Buffer.byteLength(value)).toBeLessThanOrEqual(3600);
  });

  it("includes a snapshot in a wait timeout, not in a passing wait", async () => {
    const helper = PROBE.slice(
      PROBE.indexOf("  const waitFor ="),
      PROBE.indexOf("  const windows ="),
    );
    let now = 0;
    const waitFor = runInNewContext(`${helper}; waitFor`, {
      report: {},
      boundedSnapshot,
      Date: { now: () => now },
      wait: async delay => {
        now += delay;
      },
    });
    await expect(
      waitFor(
        "completed pop-out adoption",
        () => false,
        50,
        () => ({
          expectedUrls: ["a", "b"],
          destination: [
            { url: "b", selected: true, multiselected: true, placeholder: false },
          ],
          windowCount: 2,
        }),
      ),
    ).rejects.toThrow(
      'snapshot: {"expectedUrls":["a","b"],"destination":[{"url":"b","selected":true,"multiselected":true,"placeholder":false}],"windowCount":2}',
    );
    let described = false;
    await expect(
      waitFor(
        "completed pop-out adoption",
        () => true,
        50,
        () => {
          described = true;
        },
      ),
    ).resolves.toBe(true);
    expect(described).toBe(false);
  });

  it("tracks adoption and deferred startup settlement without changing tab state", async () => {
    let settle;
    const candidate = new EventTarget();
    candidate.gZenStartup = {
      promiseInitialized: new Promise(resolve => {
        settle = resolve;
      }),
    };
    candidate.gBrowser = {
      selectedTab: null,
      tabs: [
        {
          linkedBrowser: { currentURI: { spec: "about:blank" } },
          hasAttribute: name => name === "zen-empty-tab",
        },
        {
          linkedBrowser: { currentURI: { spec: "a" } },
          multiselected: true,
          hasAttribute: () => false,
        },
      ],
    };
    candidate.gBrowser.selectedTab = candidate.gBrowser.tabs[1];
    candidate.document = { documentElement: { hasAttribute: () => true } };
    const helper = PROBE.slice(
      PROBE.indexOf("      const tabSnapshot ="),
      PROBE.indexOf("      failureState = popOutSnapshot;"),
    );
    const state = runInNewContext(
      `${helper}; popOutObserver(candidate); ({ snapshot: popOutSnapshot })`,
      {
        candidate,
        window: candidate,
        openedWindow: candidate,
        popOutWatches: new Map(),
        popOutObserver: null,
        report: { currentWait: "completed pop-out adoption" },
        windows: () => [candidate, {}],
        popOutTestUrls: ["a"],
        Services: { focus: { activeWindow: candidate } },
        Date,
      },
    );
    expect(state.snapshot().startup.promiseSettled).toBe("pending");
    candidate.dispatchEvent(new Event("before-initial-tab-adopted"));
    settle();
    await Promise.resolve();
    const snapshot = state.snapshot();
    expect(snapshot.startup).toMatchObject({ promiseSettled: "fulfilled" });
    expect(snapshot.startup.adoptionAt).toBeGreaterThan(0);
    expect(snapshot.startup.promiseSettledAt).toBeGreaterThanOrEqual(
      snapshot.startup.promiseObservedAt,
    );
    expect(snapshot.destination).toEqual([
      { url: "about:blank", selected: false, multiselected: false, placeholder: true },
      { url: "a", selected: true, multiselected: true, placeholder: false },
    ]);
    expect(snapshot.expectedUrls).toEqual(["a"]);
    expect(snapshot.windowCount).toBe(2);
  });

  it("captures enabled/live/generation/stopReason/toggles when disable fails to settle", async () => {
    let now = 0;
    const window = { zenExtendedTabShortcuts: { isLive: () => true, stopReason: null } };
    const result = await new Promise(resolve => {
      const execute = runInNewContext(`(function () { ${SET_MOD_ENABLED} })`, {
        window,
        Date: { now: () => now },
        setTimeout: (callback, delay) => {
          now += delay;
          callback();
        },
        ChromeUtils: {
          importESModule: path => ({
            default: path.includes("manager")
              ? { toggleTheme: async () => {} }
              : { getMods: async () => ({ fake: { enabled: false } }) },
          }),
        },
      });
      execute({ enabled: false, modId: "fake" }, resolve);
    });
    expect(result.error).toContain(
      "timed out waiting for mod enable/liveness; snapshot:",
    );
    const snapshot = JSON.parse(result.error.split("; snapshot: ")[1].split(" | ")[0]);
    expect(snapshot).toMatchObject({
      enabled: false,
      live: true,
      generation: 1,
      stopReason: null,
      toggles: 3,
    });
    expect(snapshot.steps.at(-1).name).toBe("toggle-3-settled");
    expect(window.__etsProbeDisableSnapshot).toMatchObject({
      enabled: false,
      live: true,
      toggles: 3,
    });
  });

  it("recovers pre-await state on a Marionette disable timeout into the failing assertion", async () => {
    const snapshot = {
      enabled: false,
      live: true,
      generation: 7,
      stopReason: null,
      toggles: 1,
      steps: [{ name: "toggle-1-begin" }],
    };
    const client = {
      executeAsync: async source => {
        if (source === SET_MOD_ENABLED) throw new Error("script timeout");
        if (source.includes("...window.__etsProbeDisableSnapshot")) return snapshot;
        return { ok: false, error: "unrelated phase not simulated" };
      },
    };
    const result = await runNativePhases(client, { assertions: [] }, "fake");
    const failure = result.assertions.find(
      assertion => assertion.name === "shortcut screen keeps stale rows until reopened",
    );
    expect(failure.ok).toBe(false);
    expect(failure.detail).toContain("script timeout; snapshot:");
    expect(failure.detail).toContain('"generation":7');
    expect(failure.detail).toContain('"toggles":1');
    expect(result.evidence.disableSteps).toEqual(snapshot.steps);
  });
});
