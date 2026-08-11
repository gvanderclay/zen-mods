import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { collectVerdicts, summarizeTimings, validatePlatformStamp } from "./core.mjs";

const sha256 = character => character.repeat(64);

describe("collectVerdicts", () => {
  it("keeps probe order and derives an immutable pass/fail summary", () => {
    const result = collectVerdicts([
      { name: "identity restored", ok: true },
      { name: "listener released", ok: false, detail: "sentinel fired" },
      { name: "observer released", ok: true, detail: null },
    ]);

    expect(result).toEqual({
      ok: false,
      counts: { total: 3, passed: 2, failed: 1 },
      verdicts: [
        { name: "identity restored", ok: true, detail: null },
        { name: "listener released", ok: false, detail: "sentinel fired" },
        { name: "observer released", ok: true, detail: null },
      ],
      failures: [{ name: "listener released", ok: false, detail: "sentinel fired" }],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.verdicts[0])).toBe(true);
  });

  it("rejects duplicate or ambiguous verdicts", () => {
    expect(() =>
      collectVerdicts([
        { name: "same", ok: true },
        { name: "same", ok: false },
      ]),
    ).toThrow("duplicate verdict name: same");
    expect(() => collectVerdicts([{ name: "missing status" }])).toThrow(
      "verdicts[0].ok must be a boolean",
    );
  });
});

describe("summarizeTimings", () => {
  it("retains raw samples and reports median, nearest-rank p95, and spread", () => {
    const raw = [20, 1, 18, 2, 17, 3, 16, 4, 15, 5, 14, 6, 13, 7, 12, 8, 11, 9, 10, 19];

    expect(summarizeTimings(raw)).toEqual({
      raw,
      count: 20,
      median: 10.5,
      p95: 19,
      min: 1,
      max: 20,
      spread: 19,
    });
  });

  it("uses explicit nulls for an empty run and rejects invalid samples", () => {
    expect(summarizeTimings([])).toEqual({
      raw: [],
      count: 0,
      median: null,
      p95: null,
      min: null,
      max: null,
      spread: null,
    });
    expect(() => summarizeTimings([1, Number.NaN])).toThrow(
      "timings[1] must be a finite non-negative number",
    );
    expect(() => summarizeTimings([-1])).toThrow(
      "timings[0] must be a finite non-negative number",
    );
  });
});

describe("validatePlatformStamp", () => {
  it("accepts the checked-in exact Zen/Sine stamp", async () => {
    const stamp = JSON.parse(
      await readFile(new URL("./platform-stamp.json", import.meta.url), "utf8"),
    );

    const result = validatePlatformStamp(stamp);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.stamp.zen.version).toBe("1.21.13b");
    expect(result.stamp.sine.version).toBe("2.3.3.0");
  });

  it("returns deterministic schema, checksum, and safe-path errors", () => {
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
