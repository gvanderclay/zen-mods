import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  REQUIRED_ASSERTIONS,
  REQUIRED_FORCE_KEYS,
  validateMultiWindowEvidence,
} from "./production-multi-window-core.mjs";

const owner = ({ registrations, phase = "present", protocol = 10 } = {}) => ({
  activeCount: 0,
  activeKind: null,
  applicationId: "application-1",
  desiredOnDemand: true,
  drainingCount: 0,
  keyRecords: 0,
  protocol,
  readyCount: 0,
  registrationCount: registrations.length,
  registrationIds: registrations,
  statusWidgetLeaseIds: registrations,
  statusWidgetLeases: registrations.length,
  statusWidgetPhase: phase,
  sweepRecords: 0,
  trailingCount: 0,
  wakeAttempt: null,
  wakeCandidates: 0,
  wakePhase: "idle",
});

const current = (registrations = ["window-3", "window-4"]) => ({
  owner: owner({ registrations }),
  widget: { placement: true, provider: "api" },
  windows: Object.fromEntries(
    registrations.map((registrationId, index) => [
      index === 0 ? "a" : "b",
      {
        controller: true,
        facade: true,
        panel: { action: "All kept tabs are awake", heading: "Nothing to wake" },
        registrationId,
        view: true,
      },
    ]),
  ),
});

const force = () => ({
  after: current(),
  before: current(),
  error: null,
  invoked: true,
  mutationDelta: 0,
  mutationDeltas: { a: 0, b: 0 },
  stable: true,
});

const heldOwner = (registrations, desiredOnDemand = false) => ({
  ...owner({ registrations }),
  activeCount: 1,
  activeKind: "sweep",
  desiredOnDemand,
  keyRecords: 1,
  wakeCandidates: 1,
  wakePhase: "waiting",
});

const heldCandidate = () => ({
  callDelta: 1,
  calls: 1,
  connected: true,
  inserted: true,
  linkedPanel: true,
  pending: true,
});

const validEvidence = () => ({
  capture: {
    g1Facade: true,
    g1PanelDisposer: true,
    g1View: true,
    g1WakeCompletion: true,
    g1WidgetViewShowing: true,
    passthroughSettleCalls: 2,
    priorSettleCalls: 2,
  },
  close: {
    closedController: {
      pendingTimers: 0,
      pendingWaits: 0,
      reason: "window-unload",
      stopped: true,
    },
    events: {
      beforeUnloadSeen: false,
      domwindowclosedAt: 10,
      domwindowclosedSeq: 3,
      unloadAt: 10,
      unloadSeq: 4,
    },
    heldCandidate: heldCandidate(),
    closedRegistrationId: "window-4",
    secondaryClosed: true,
    owner: owner({ registrations: ["window-3"] }),
    creator: {
      panelFills: true,
      registrationId: "window-3",
      widgetPreserved: true,
    },
  },
  disable: {
    activeBeforeDisable: {
      aRegistrationId: "window-3",
      aWidgetPresent: true,
      bTerminal: true,
      heldCandidate: heldCandidate(),
      owner: heldOwner(["window-3"]),
    },
    actualSineDisable: {
      callbackAt: 20,
      callbackBeforeFixtureRelease: true,
      callbackDelivered: true,
      enabledAfter: false,
      enabledBefore: true,
      fixtureReleasedAt: 20,
    },
    controllers: {
      a: { pendingTimers: 0, pendingWaits: 0, stopped: true },
      b: { pendingTimers: 0, pendingWaits: 0, stopped: true },
    },
    firstDrain: {
      owner: owner({ registrations: [], phase: "absent" }),
      widget: { placement: false, present: false },
      windows: { aPanel: false, bPanel: false },
    },
    sentinels: {
      a: { deferCalls: 1, timerFired: false, waitStopped: true },
      b: { deferCalls: 1, timerFired: false, waitStopped: true },
    },
  },
  forces: Object.fromEntries(
    REQUIRED_FORCE_KEYS.map(key => [
      key,
      {
        ...force(),
        ...(key === "panelDisposer" ? { held: true, stopCalls: 1 } : {}),
        ...(key === "wakeCompletion"
          ? {
              completion: {
                errorCalls: 0,
                readyCalls: 0,
                released: true,
                settleFinished: true,
                workSettled: true,
              },
            }
          : {}),
      },
    ]),
  ),
  ownership: {
    creatorRegistrationId: "window-1",
    owner: owner({ registrations: ["window-1", "window-2"] }),
    registrationIds: ["window-1", "window-2"],
    sharedWidget: true,
    viewsDistinct: true,
  },
  manifest: { supportsUnload: true },
  preferences: {
    falseOriginal: {
      expectedRegistrationIds: ["window-1", "window-2"],
      final: false,
      heldCandidate: heldCandidate(),
      initial: false,
      ownerAfter: {
        ...owner({ registrations: ["window-1", "window-2"] }),
        desiredOnDemand: false,
      },
      ownerDuring: heldOwner(["window-1", "window-2"], false),
      transitions: [],
      wakeObserved: true,
    },
    trueOriginal: {
      bHeldCandidate: heldCandidate(),
      bHeldOnDemand: false,
      bHeldOnDemandBeforeRelease: false,
      expectedRegistrationIds: ["window-1", "window-2"],
      final: true,
      heldCandidate: heldCandidate(),
      initial: true,
      ownerAfter: {
        ...owner({ registrations: ["window-1", "window-2"] }),
        desiredOnDemand: true,
      },
      ownerDuring: heldOwner(["window-1", "window-2"], true),
      transitions: [false, true, false, true],
      wakeObserved: true,
    },
  },
  reload: {
    applicationPreserved: true,
    controllersReplaced: true,
    current: current(),
    g1Stopped: true,
    g1ApplicationId: "application-1",
    g1RegistrationIds: ["window-1", "window-2"],
    g2ARegistrationId: "window-3",
    g2ApplicationId: "application-1",
    g2BRegistrationId: "window-4",
    g2RegistrationIds: ["window-3", "window-4"],
    owner: owner({ registrations: ["window-3", "window-4"] }),
    registrationsReplaced: true,
    viewsReplaced: true,
  },
  serialization: {
    expectedRegistrationIds: ["window-1", "window-2"],
    fanoutCalls: { a: 1, b: 1 },
    idle: owner({ registrations: ["window-1", "window-2"] }),
    maxActive: 1,
    maxHeld: 1,
    maxTrailing: 1,
    ownerTrace: [
      {
        phase: "held-a",
        owner: {
          ...owner({ registrations: ["window-1", "window-2"] }),
          activeCount: 1,
          activeKind: "sweep",
          keyRecords: 1,
          wakeCandidates: 1,
          wakePhase: "waiting",
        },
      },
      {
        phase: "held-b",
        owner: {
          ...owner({ registrations: ["window-1", "window-2"] }),
          activeCount: 1,
          activeKind: "sweep",
          keyRecords: 1,
          wakeCandidates: 1,
          wakePhase: "waiting",
        },
      },
      {
        phase: "trailing",
        owner: {
          ...owner({ registrations: ["window-1", "window-2"] }),
          activeCount: 1,
          activeKind: "sweep",
          keyRecords: 1,
          trailingCount: 1,
          wakeCandidates: 1,
          wakePhase: "waiting",
        },
      },
      {
        phase: "idle",
        owner: owner({ registrations: ["window-1", "window-2"] }),
      },
    ],
    trailingObserved: true,
  },
  pulse: {
    finalController: { pendingTimers: 0, pendingWaits: 0, stopped: true },
    finalOwner: owner({ registrations: [], phase: "absent" }),
    finalSineDisable: {
      callbackDelivered: true,
      enabledAfter: false,
      enabledBefore: true,
    },
    finalWidget: { placement: false, present: false },
    finalWindows: { aPanel: false, bPanel: false },
    oldDeadlineQuiet: true,
    oldDeadlineObservation: {
      activeSamples: 0,
      activeStarts: 0,
      activeTransitions: 0,
      endAt: 9_250,
      samples: 4,
      startAt: 8_000,
    },
    released: true,
    replacementEarlyObservation: {
      activeSamples: 0,
      activeStarts: 0,
      activeTransitions: 0,
      endAt: 12_000,
      samples: 4,
      startAt: 4_500,
    },
    replacementSentinel: {
      baselineInactive: true,
      readyAt: 5_000,
    },
    replacementNormalAfterDeadline: true,
    timing: {
      disabledAt: 1_000,
      firstActiveAt: 0,
      firstEnableAt: 0,
      firstReleasedAt: 500,
      normalActiveAt: 13_000,
      oldDeadlineEarliestAt: 8_000,
      oldDeadlineLatestAt: 8_000,
      replacementActiveAt: 4_000,
      replacementDeadlineEarliestAt: 12_000,
      replacementEnableAt: 4_000,
      replacementReleasedAt: 4_500,
      replacementSentinelReadyAt: 5_000,
    },
  },
});

describe("production multi-window evidence", () => {
  it("accepts the complete staged-bundle matrix record", () => {
    expect(validateMultiWindowEvidence(validEvidence())).toEqual({
      failures: [],
      ok: true,
    });
  });

  it.each([
    [
      "a missing original-false lane",
      evidence => (evidence.preferences.falseOriginal.transitions = [true]),
      /preferences\.falseOriginal\.transitions/,
    ],
    [
      "an early true-pref restore while B is still held",
      evidence => (evidence.preferences.trueOriginal.bHeldOnDemandBeforeRelease = true),
      /preferences\.trueOriginal\.bHeldOnDemandBeforeRelease/,
    ],
    [
      "a missing physical B hold fixture",
      evidence => (evidence.preferences.trueOriginal.bHeldCandidate.pending = false),
      /preferences\.trueOriginal\.bHeldCandidate/,
    ],
    [
      "a second active owner operation",
      evidence => (evidence.serialization.maxActive = 2),
      /serialization\.maxActive/,
    ],
    [
      "a trace snapshot from a different G1 lease set",
      evidence =>
        (evidence.serialization.ownerTrace[0].owner.registrationIds = ["window-1"]),
      /serialization\.ownerTrace\[0\]\.owner\.registrationIds/,
    ],
    [
      "a missing held-B trace phase",
      evidence => (evidence.serialization.ownerTrace[1].phase = "poll"),
      /serialization\.ownerTrace/,
    ],
    [
      "a one-registration preference idle snapshot",
      evidence =>
        (evidence.preferences.trueOriginal.ownerAfter = owner({
          registrations: ["window-1"],
        })),
      /preferences\.trueOriginal\.ownerAfter\.registrationCount/,
    ],
    [
      "a one-registration serialization idle snapshot",
      evidence =>
        (evidence.serialization.idle = owner({
          registrations: ["window-1"],
        })),
      /serialization\.idle\.registrationCount/,
    ],
    [
      "a stale mutation in the survivor",
      evidence => (evidence.forces.viewShowing.after.windows.b.panel.heading = "stale"),
      /forces\.viewShowing/,
    ],
    [
      "a reload that changes the stable G1 owner identity",
      evidence => {
        evidence.reload.g1ApplicationId = "application-2";
        evidence.reload.g2ApplicationId = "application-2";
      },
      /reload\.g1ApplicationId/,
    ],
    [
      "a swapped named G2 window mapping",
      evidence => {
        evidence.reload.g2ARegistrationId = "window-4";
        evidence.reload.g2BRegistrationId = "window-3";
      },
      /reload\.current\.windows\.a\.registrationId/,
    ],
    [
      "a leaked widget lease after disable",
      evidence => (evidence.disable.firstDrain.owner.statusWidgetLeases = 1),
      /disable\.firstDrain\.owner\.statusWidgetLeases/,
    ],
    [
      "a timer delivered after disable",
      evidence => (evidence.disable.sentinels.b.timerFired = true),
      /disable\.sentinels\.b\.timerFired/,
    ],
  ])("fails closed on %s", (_name, mutate, expected) => {
    const evidence = validEvidence();
    mutate(evidence);

    const result = validateMultiWindowEvidence(evidence);

    expect(result.ok).toBe(false);
    expect(result.failures.map(failure => failure.path).join("\n")).toMatch(expected);
  });

  it("keeps the aggregate probe tied to real production and Sine seams", async () => {
    const source = await readFile(
      new URL("./probe-production-multi-window.mjs", import.meta.url),
      "utf8",
    );

    expect(REQUIRED_ASSERTIONS).toHaveLength(19);
    expect(source).toContain("launchLiveZen");
    expect(source).toContain('"dist/keep-loaded.sys.mjs"');
    expect(source).toContain('"dist/keep-loaded.uc.mjs"');
    expect(source).toContain("manager.rebuildMods(true, false)");
    expect(source).toContain("manager.toggleTheme");
    expect(source).toContain("cmd_closeWindow");
    expect(source).toContain("controller.defer");
    expect(source).toContain("controller.schedule");
    expect(source).toContain("controller.settlePanel");
    expect(source).toContain("retained.viewShowing");
    expect(source).toContain("restore_pinned_tabs_on_demand");
    expect(source).toContain(
      "value: hadUserValue ? Services.prefs.getBoolPref(name) : null",
    );
    expect(source).toContain(
      "value: hadUserValue ? Services.prefs.getStringPref(name) : null",
    );
    const probe = source.match(/const PROBE = `([\s\S]*?)`;\n\nconst atomicWriteJson/);
    expect(probe?.[1]).toBeTruthy();
    expect(() => new Function(probe[1])).not.toThrow();
  });
});
