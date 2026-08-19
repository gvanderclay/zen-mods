import { describe, expect, it } from "vitest";
import { parseProfileProcessIds, startTrackedProcess } from "./tracked-process.mjs";

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
