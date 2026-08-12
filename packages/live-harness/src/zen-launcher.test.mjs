import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectStagedModEvidence,
  createZenArguments,
  installShutdownSignals,
  LIFECYCLE_FIXTURE_PATHS,
  parseProfileProcessIds,
  startTrackedProcess,
  validateStagedMod,
} from "./zen-launcher.mjs";

const stagedMod = {
  enabled: false,
  manifest: {
    id: "keep-loaded",
    name: "Keep Loaded",
    scripts: { "dist/keep-loaded.uc.mjs": {} },
  },
  relativePaths: ["dist/keep-loaded.uc.mjs", "styles/chrome.css"],
  sourceDirectory: "/tmp/keep-loaded",
};

describe("live Zen staged mod boundary", () => {
  it("exposes the exact synthetic lifecycle fixture files", async () => {
    expect(Object.keys(LIFECYCLE_FIXTURE_PATHS)).toEqual(["carrier", "window"]);
    await expect(
      Promise.all(Object.values(LIFECYCLE_FIXTURE_PATHS).map(path => access(path))),
    ).resolves.toEqual([undefined, undefined]);
  });

  it("accepts an explicit allowlist and resolves its source root", () => {
    expect(validateStagedMod(stagedMod)).toEqual(stagedMod);
  });

  it.each([
    ["parent traversal", { ...stagedMod, relativePaths: ["../outside"] }],
    ["absolute path", { ...stagedMod, relativePaths: ["/tmp/outside"] }],
    ["duplicate path", { ...stagedMod, relativePaths: ["dist/a", "dist/a"] }],
    ["nested id", { ...stagedMod, manifest: { ...stagedMod.manifest, id: "a/b" } }],
  ])("rejects a %s", (_label, value) => {
    expect(() => validateStagedMod(value)).toThrow();
  });

  it("hashes the exact staged bytes rather than a mutable source snapshot", async () => {
    const target = await mkdtemp(join(tmpdir(), "zen-staged-evidence-"));
    try {
      await mkdir(join(target, "dist"));
      await mkdir(join(target, "styles"));
      await writeFile(join(target, "dist/keep-loaded.uc.mjs"), "// staged\n");
      await writeFile(join(target, "styles/chrome.css"), "/* staged */\n");
      await writeFile(
        join(target, "theme.json"),
        `${JSON.stringify(stagedMod.manifest)}\n`,
      );
      const evidence = await collectStagedModEvidence({
        manifest: stagedMod.manifest,
        relativePaths: stagedMod.relativePaths,
        target,
      });
      await writeFile(join(target, "dist/keep-loaded.uc.mjs"), "// changed later\n");

      const expected = createHash("sha256").update("// staged\n").digest("hex");
      expect(evidence.files["dist/keep-loaded.uc.mjs"]).toEqual({
        bytes: Buffer.byteLength("// staged\n"),
        sha256: expected,
      });
    } finally {
      await rm(target, { force: true, recursive: true });
    }
  });
});

describe("live Zen process ownership", () => {
  it("builds exact headless and headed argument lists", () => {
    expect(createZenArguments({ headless: true, profile: "/tmp/profile" })).toEqual([
      "--headless",
      "--no-remote",
      "--marionette",
      "--remote-allow-system-access",
      "--profile",
      "/tmp/profile",
      "about:blank",
    ]);
    expect(createZenArguments({ headless: false, profile: "/tmp/profile" })).toEqual([
      "-foreground",
      "--no-remote",
      "--marionette",
      "--remote-allow-system-access",
      "--profile",
      "/tmp/profile",
      "about:blank",
    ]);
  });

  it("matches only the exact Zen binary and profile argument", () => {
    const binary = "/Applications/Zen.app/Contents/MacOS/zen";
    const profile = "/tmp/zen-keep-loaded-lifecycle-safe";
    const output = [
      `101 ${binary} --headless --profile ${profile} about:blank`,
      `102 ${binary} --profile=${profile} --headless`,
      `103 ${binary} --profile /tmp/a-different-profile ${profile}`,
      `104 /bin/sh -c ${binary} --profile ${profile}`,
      `105 /usr/bin/helper --profile ${profile} ${binary}`,
      `106 ${binary} --profiled ${profile}`,
      `107 ${binary} -profile ${profile}`,
      "not a process row",
    ].join("\n");

    expect(parseProfileProcessIds(output, { binary, profile })).toEqual([101, 102, 107]);
  });

  it("observes a spawn failure instead of emitting an unhandled child error", async () => {
    const missing = `/definitely-missing-zen-${process.pid}`;
    const { child, started } = startTrackedProcess(missing, [], {
      stdio: "ignore",
    });

    await expect(started).rejects.toMatchObject({ code: "ENOENT" });
    expect(child.pid).toBeUndefined();
  });

  it("keeps signal handlers installed until one idempotent shutdown finishes", async () => {
    const emitter = new EventEmitter();
    let finishShutdown;
    const shutdown = new Promise(resolve => {
      finishShutdown = resolve;
    });
    let shutdownCalls = 0;
    const exits = [];
    const remove = installShutdownSignals({
      emitter,
      exit: code => exits.push(code),
      label: "test probe",
      shutdown: () => {
        shutdownCalls += 1;
        return shutdown;
      },
    });

    emitter.emit("SIGINT");
    emitter.emit("SIGTERM");
    expect(shutdownCalls).toBe(1);
    expect(exits).toEqual([]);
    finishShutdown();
    await Promise.resolve();
    await Promise.resolve();
    expect(exits).toEqual([130]);

    remove();
    expect(emitter.listenerCount("SIGINT")).toBe(0);
    expect(emitter.listenerCount("SIGTERM")).toBe(0);
  });
});
