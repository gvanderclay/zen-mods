import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  auditLifecycle,
  collectVerdicts,
  validateAssertionManifest,
  validatePlatformStamp,
} from "./live-core.mjs";

describe("validateAssertionManifest", () => {
  const required = ["alpha", "beta"];

  it("accepts exactly one boolean verdict for every required assertion", () => {
    const assertions = validateAssertionManifest(
      {
        assertions: [
          { name: "alpha", ok: true, detail: "first" },
          { name: "beta", ok: false },
        ],
        fatal: null,
      },
      required,
    );

    expect(assertions).toEqual([
      { name: "alpha", ok: true, detail: "first" },
      { name: "beta", ok: false, detail: null },
    ]);
  });

  it.each([
    ["empty", { assertions: [], fatal: null }, /must not be empty/],
    [
      "missing",
      { assertions: [{ name: "alpha", ok: true }], fatal: null },
      /missing: beta/,
    ],
    [
      "extra",
      {
        assertions: [
          { name: "alpha", ok: true },
          { name: "beta", ok: true },
          { name: "gamma", ok: true },
        ],
        fatal: null,
      },
      /unexpected: gamma/,
    ],
    [
      "duplicate",
      {
        assertions: [
          { name: "alpha", ok: true },
          { name: "alpha", ok: true },
          { name: "beta", ok: true },
        ],
        fatal: null,
      },
      /duplicate assertion name: alpha/,
    ],
    [
      "nonboolean",
      {
        assertions: [
          { name: "alpha", ok: "yes" },
          { name: "beta", ok: true },
        ],
        fatal: null,
      },
      /assertions\[0\]\.ok must be a boolean/,
    ],
    [
      "fatal",
      {
        assertions: [
          { name: "alpha", ok: true },
          { name: "beta", ok: true },
        ],
        fatal: "boom",
      },
      /probe reported a fatal error: boom/,
    ],
  ])("fails closed on a %s result", (_name, result, expected) => {
    expect(() => validateAssertionManifest(result, required)).toThrow(expected);
  });
});

describe("auditLifecycle", () => {
  const clean = {
    resources: [
      { owner: "A", kind: "listener", active: false },
      { owner: "A", kind: "timer", active: false },
      { owner: "B", kind: "listener", active: false },
      { owner: "B", kind: "timer", active: false },
    ],
    events: [
      { type: "continuation-skipped", owner: "A", generation: 1, stopped: true },
      { type: "mutation", owner: "B", targetOwner: "B", generation: 2, stopped: false },
    ],
  };

  it("accepts owner-clean resources and correctly routed live work", () => {
    expect(auditLifecycle(clean)).toEqual({ ok: true, violations: [] });
  });

  it.each([
    [
      "leaked listener",
      {
        ...clean,
        resources: [...clean.resources, { owner: "A", kind: "listener", active: true }],
      },
      "leaked-listener",
    ],
    [
      "leaked timer",
      {
        ...clean,
        resources: [...clean.resources, { owner: "B", kind: "timer", active: true }],
      },
      "leaked-timer",
    ],
    [
      "stale continuation",
      {
        ...clean,
        events: [
          ...clean.events,
          {
            type: "mutation",
            owner: "A",
            targetOwner: "A",
            generation: 1,
            stopped: true,
          },
        ],
      },
      "stale-continuation",
    ],
    [
      "wrong-window mutation",
      {
        ...clean,
        events: [
          ...clean.events,
          {
            type: "mutation",
            owner: "A",
            targetOwner: "B",
            generation: 1,
            stopped: false,
          },
        ],
      },
      "wrong-window-mutation",
    ],
    [
      "self-cleared stale callback",
      {
        ...clean,
        events: [
          ...clean.events,
          {
            type: "callback-delivered",
            owner: "B",
            stopped: true,
            guarded: false,
          },
        ],
      },
      "stale-callback",
    ],
    [
      "resource that was active when its owner stopped",
      {
        ...clean,
        events: [
          ...clean.events,
          {
            type: "resource-at-stop",
            owner: "A",
            kind: "timer",
            active: true,
          },
        ],
      },
      "resource-active-at-stop",
    ],
  ])("detects an injected %s", (_name, evidence, code) => {
    const result = auditLifecycle(evidence);

    expect(result.ok).toBe(false);
    expect(result.violations.map(violation => violation.code)).toContain(code);
  });
});

describe("collectVerdicts", () => {
  it("derives an immutable aggregate without changing order", () => {
    const result = collectVerdicts([
      { name: "alpha", ok: true },
      { name: "beta", ok: false, detail: "broken" },
    ]);

    expect(result.counts).toEqual({ total: 2, passed: 1, failed: 1 });
    expect(result.failures).toEqual([{ name: "beta", ok: false, detail: "broken" }]);
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe("validatePlatformStamp", () => {
  it("accepts the committed exact Zen/Sine stamp", async () => {
    const stamp = JSON.parse(
      await readFile(new URL("./platform-stamp.json", import.meta.url), "utf8"),
    );

    expect(validatePlatformStamp(stamp)).toEqual({ ok: true, errors: [], stamp });
  });
});
