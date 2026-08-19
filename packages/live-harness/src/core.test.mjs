import { describe, expect, it } from "vitest";
import {
  auditLifecycle,
  collectVerdicts,
  summarizeTimings,
  validateAssertionManifest,
} from "./core.mjs";

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
  it("retains samples and reports median, nearest-rank p95, and spread", () => {
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

  it("uses nulls for an empty run and rejects invalid samples", () => {
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
