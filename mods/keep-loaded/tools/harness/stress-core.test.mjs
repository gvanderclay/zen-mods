import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildStressSchedule,
  parseStressArguments,
  resolveBrowserReloadCounts,
  STRESS_PROFILES,
  validateStressArtifact,
} from "./stress-core.mjs";

const directory = new URL("./", import.meta.url);
const read = path => readFile(new URL(path, directory), "utf8");

const owner = ({ active = false, registrations = 0 } = {}) => ({
  activeCount: active ? 1 : 0,
  activeKind: active ? "sweep" : null,
  applicationId: "stress-owner",
  desiredOnDemand: true,
  drainingCount: 0,
  keyRecords: active ? 1 : 0,
  protocol: 9,
  readyCount: 0,
  recoveryAttempts: 0,
  registrationCount: registrations,
  registrationIds: Array.from({ length: registrations }, (_, index) => `r${index}`),
  statusWidgetLeaseIds: [],
  statusWidgetLeases: 0,
  statusWidgetPhase: "absent",
  sweepRecords: active ? 1 : 0,
  trailingCount: 0,
  wakeAttempt: active ? 1 : null,
  wakeCandidates: active ? 1 : 0,
  wakePhase: active ? "waiting" : "idle",
  wakeRetryScheduled: false,
});

const validArtifact = () => {
  const configuration = parseStressArguments(["--profile", "quick", "--seed", "184467"]);
  const fastEvents = Array.from({ length: 25 }, (_, index) => ({
    id: index + 1,
    sequence: index + 1,
    type: "fast-request",
  }));
  const holdEvents = [26, 27, 29].map((id, index) => ({
    id,
    sequence: fastEvents.length + index + 1,
    type: "hold-request",
  }));
  const stagedFiles = Object.fromEntries(
    [
      "dist/keep-loaded.sys.mjs",
      "dist/keep-loaded.uc.mjs",
      "preferences.json",
      "styles/chrome.css",
      "theme.json",
    ].map(path => [path, { bytes: 1, sha256: "a".repeat(64) }]),
  );
  return {
    configuration,
    diagnostics: {
      httpFixture: { events: [...fastEvents, ...holdEvents], pending: {}, released: [] },
      zenOutputTail: "",
    },
    evidence: {
      browser: {
        activeDisable: {
          afterOwner: owner(),
          beforeOwner: owner({ active: true, registrations: 2 }),
          heldCandidates: 4,
          prefHeld: false,
        },
        completedEvents: 7,
        controllers: { pendingTimers: 0, pendingWaits: 0, retained: 4, stopped: 4 },
        eventLoop: { maxDelayMs: 2, samples: 20 },
        expectedEvents: 7,
        finalOwner: owner(),
        maxActive: 1,
        maxKeyRecords: 1,
        platform: {
          buildId: "build",
          geckoVersion: "153.0.3",
          sineVersion: "2.3.3.0",
          zenVersion: "1.21.13b",
        },
        preferenceDrift: false,
        processSamples: [
          { label: "initial", residentBytes: 1 },
          { label: "round-1", residentBytes: 2 },
          { label: "final", residentBytes: 1 },
        ],
        reloadLatenciesMs: [1, 2, 3, 4, 5],
        resourcesDrained: true,
        rounds: [
          {
            expectedReloads: 5,
            fastRequests: 25,
            index: 1,
            lazyBeforeWake: 25,
            reloads: 5,
            tabs: 25,
            windows: 2,
          },
        ],
      },
      cleanup: { profileRemoved: true, serverStopped: true, zenStopped: true },
      fatal: null,
      model: {
        completedEvents: 1_000,
        errors: [],
        expectedEvents: 1_000,
        finalOwner: owner(),
        maxActive: 1,
        maxKeyRecords: 66,
        preferenceDrift: false,
        receipts: { canceled: 1, completed: 2, failed: 0 },
        scheduleHash: "12345678",
        schedulePrefixHash: "12345678",
        schedulePrefixHashes: Array.from({ length: 1_000 }, () => "12345678"),
      },
      profile: "quick",
      seed: 184467,
    },
    runner: { ownerProtocol: 9 },
    stagedProduction: {
      files: stagedFiles,
      manifest: {
        ...stagedFiles["theme.json"],
        value: { id: "keep-loaded", supportsUnload: true },
      },
      relativePaths: [
        "dist/keep-loaded.sys.mjs",
        "dist/keep-loaded.uc.mjs",
        "preferences.json",
        "styles/chrome.css",
      ],
    },
    stamp: {
      sine: { version: "2.3.3.0" },
      zen: {
        buildId: "build",
        geckoVersion: "153.0.3",
        version: "1.21.13b",
      },
    },
  };
};

describe("M17 Keep Loaded stress contracts", () => {
  it("defines bounded quick, standard, and soak profiles", () => {
    expect(STRESS_PROFILES).toEqual({
      quick: expect.objectContaining({
        browserRounds: [{ tabs: 25, windows: 2 }],
        modelEvents: 1_000,
        reloads: 5,
      }),
      standard: expect.objectContaining({
        browserRounds: [
          { tabs: 25, windows: 3 },
          { tabs: 100, windows: 3 },
          { tabs: 250, windows: 3 },
        ],
        modelEvents: 25_000,
        reloads: 25,
      }),
      soak: expect.objectContaining({
        browserRounds: [{ tabs: 100, windows: 3 }],
        minutes: 60,
      }),
    });
  });

  it("parses overrides and refuses ambiguous or unsafe input", () => {
    expect(
      parseStressArguments([
        "--profile",
        "soak",
        "--minutes",
        "2",
        "--seed",
        "184467",
        "--events",
        "500",
        "--replay-event",
        "123",
        "--tabs",
        "40",
        "--windows",
        "4",
        "--reloads",
        "7",
        "--model-only",
      ]),
    ).toMatchObject({
      browser: false,
      events: 500,
      minutes: 2,
      profile: "soak",
      replayEvent: 123,
      reloads: 7,
      seed: 184467,
      browserRounds: [{ tabs: 40, windows: 4 }],
    });
    expect(() => parseStressArguments(["--profile", "huge"])).toThrow(
      /unknown stress profile/,
    );
    expect(() => parseStressArguments(["--profile", "toString"])).toThrow(
      /unknown stress profile/,
    );
    expect(() => parseStressArguments(["--minutes", "0"])).toThrow(/positive/);
    expect(() => parseStressArguments(["--model-only", "--browser-only"])).toThrow(
      /mutually exclusive/,
    );
    expect(() =>
      parseStressArguments(["--events", "10", "--replay-event", "11"]),
    ).toThrow(/cannot exceed/);
    expect(() => parseStressArguments(["--tabs", "1001"])).toThrow(/safety/);
    expect(() => parseStressArguments(["--windows", "9"])).toThrow(/safety/);
  });

  it("derives exact browser reload counts from the selected profile", () => {
    expect(
      resolveBrowserReloadCounts(
        parseStressArguments(["--profile", "standard", "--seed", "184467"]),
      ),
    ).toEqual([9, 8, 8]);
    expect(
      resolveBrowserReloadCounts(
        parseStressArguments(["--profile", "soak", "--minutes", "1", "--seed", "184467"]),
      ),
    ).toEqual([6]);
  });

  it("generates a deterministic, replayable event schedule", () => {
    const first = buildStressSchedule({ count: 1_000, seed: 184467, tabs: 64 });
    const second = buildStressSchedule({ count: 1_000, seed: 184467, tabs: 64 });
    const other = buildStressSchedule({ count: 1_000, seed: 184468, tabs: 64 });

    expect(first).toEqual(second);
    expect(first).not.toEqual(other);
    expect(first).toHaveLength(1_000);
    expect(new Set(first.map(event => event.kind))).toEqual(
      new Set(["cancel", "invalidate", "preference", "pulse", "recovery", "sweep"]),
    );
    expect(first.every((event, index) => event.index === index + 1)).toBe(true);
  });

  it("fails closed on missing lanes, unknown profiles, raw drift, or cleanup gaps", () => {
    expect(validateStressArtifact(validArtifact())).toEqual({ failures: [], ok: true });
    for (const mutate of [
      value => {
        value.evidence.model = null;
      },
      value => {
        value.evidence.browser = null;
      },
      value => {
        value.configuration.profile = "toString";
        value.evidence.profile = "toString";
      },
      value => {
        value.evidence.model.maxActive = 2;
      },
      value => {
        value.evidence.browser.preferenceDrift = true;
      },
      value => {
        value.evidence.cleanup.profileRemoved = false;
      },
      value => {
        value.evidence.browser.completedEvents = 6;
      },
      value => {
        value.evidence.browser.rounds[0].tabs = 24;
      },
      value => {
        value.diagnostics.httpFixture.events.shift();
      },
      value => {
        value.stagedProduction.files["dist/keep-loaded.uc.mjs"].sha256 = "bad";
      },
      value => {
        value.evidence.browser.platform.buildId = "other";
      },
    ]) {
      const broken = structuredClone(validArtifact());
      mutate(broken);
      expect(validateStressArtifact(broken).ok).toBe(false);
    }
  });

  it("accepts either explicitly requested single lane without weakening its proof", () => {
    const modelOnly = structuredClone(validArtifact());
    modelOnly.configuration.browser = false;
    modelOnly.evidence.browser = null;
    modelOnly.evidence.cleanup = null;
    modelOnly.diagnostics = null;
    modelOnly.stagedProduction = null;
    modelOnly.stamp = null;
    expect(validateStressArtifact(modelOnly)).toEqual({ failures: [], ok: true });

    const browserOnly = structuredClone(validArtifact());
    browserOnly.configuration.model = false;
    browserOnly.evidence.model = null;
    expect(validateStressArtifact(browserOnly)).toEqual({ failures: [], ok: true });
  });

  it("keeps the CLI tied to production staging and exact cleanup machinery", async () => {
    const runner = await read("stress-keep-loaded.mjs");
    const packageJson = JSON.parse(await read("../../package.json"));
    const probe = runner.match(
      /const BROWSER_PROBE = String\.raw`([\s\S]*?)`;\n\nconst/,
    )?.[1];

    expect(packageJson.scripts.stress).toBe("node tools/harness/stress-keep-loaded.mjs");
    expect(probe).toBeTypeOf("string");
    expect(() => new Function(probe)).not.toThrow();
    expect(runner).toContain("launchLiveZen");
    expect(runner).toContain("startWakeTransactionServer");
    expect(runner).toContain("manager.toggleTheme");
    expect(runner).toContain("manager.rebuildMods");
    expect(runner).toContain("await shutdown()");
  });
});
