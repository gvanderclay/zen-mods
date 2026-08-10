import { describe, expect, it } from "vitest";
import {
  parseProfileProcessIds,
  startTrackedProcess,
  validateStagedMod,
} from "./live-zen.mjs";

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
});

describe("live Zen process ownership", () => {
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
});
