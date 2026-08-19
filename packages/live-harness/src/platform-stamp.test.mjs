import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { validatePlatformStamp } from "./platform-stamp.mjs";

describe("validatePlatformStamp", () => {
  it("accepts the committed exact Zen/Sine stamp", async () => {
    const stamp = JSON.parse(
      await readFile(new URL("./platform-stamp.json", import.meta.url), "utf8"),
    );

    expect(validatePlatformStamp(stamp)).toEqual({ ok: true, errors: [], stamp });
  });

  it("returns deterministic checksum and safe-path errors", () => {
    const sha256 = character => character.repeat(64);
    const result = validatePlatformStamp({
      zen: {
        version: "Zen",
        buildId: "tomorrow",
        geckoVersion: "Gecko",
        sourceStamp: "UPPERCASE",
        applicationIniSha256: "short",
        browserOmniSha256: sha256("b"),
        configSha256: sha256("c"),
        configPrefsSha256: sha256("d"),
      },
      sine: {
        version: "Sine",
        jsTreeSha256: sha256("e"),
        utilsTreeSha256: sha256("f"),
        files: {
          "../escape": sha256("a"),
          "JS/valid.mjs": "bad hash",
        },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      { path: "zen.buildId", message: "must be a 14-digit build ID" },
      { path: "zen.sourceStamp", message: "must be a lowercase SHA-1" },
      {
        path: "zen.applicationIniSha256",
        message: "must be a lowercase SHA-256",
      },
      { path: "sine.files.../escape", message: "path must be safe and relative" },
      {
        path: "sine.files.JS/valid.mjs",
        message: "must be a lowercase SHA-256",
      },
    ]);
  });
});
