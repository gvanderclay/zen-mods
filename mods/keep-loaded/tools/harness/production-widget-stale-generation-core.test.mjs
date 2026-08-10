import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  REQUIRED_ASSERTIONS,
  REQUIRED_FORCE_KEYS,
  validateStaleGenerationEvidence,
} from "./production-widget-stale-generation-core.mjs";

const owner = registrationId => ({
  activeCount: 0,
  applicationId: "application-1",
  keyRecords: 0,
  registrationCount: 1,
  registrationIds: [registrationId],
  statusWidgetLeaseIds: [registrationId],
  statusWidgetLeases: 1,
  statusWidgetPhase: "present",
});

const currentState = registrationId => ({
  body: { heading: "Nothing to wake", wakeLabel: "Wake 0 tabs" },
  current: { controller: true, facade: true, view: true, widget: true },
  owner: owner(registrationId),
  registrationId,
  widget: {
    placement: { area: "zen-sidebar-foot-buttons", position: 0 },
    provider: "api",
  },
});

const validEvidence = () => {
  const state = currentState("window-2");
  return {
    capture: {
      g1Facade: true,
      g1PanelDisposer: true,
      g1View: true,
      g1WakeCompletion: true,
      g1WidgetViewShowing: true,
    },
    forces: Object.fromEntries(
      REQUIRED_FORCE_KEYS.map(key => [
        key,
        {
          after: structuredClone(state),
          before: structuredClone(state),
          error: null,
          invoked: true,
          mutationDelta: 0,
          stable: true,
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
    generation: {
      controllerReplaced: true,
      g1Stopped: true,
      g2Current: true,
      ownerApplicationPreserved: true,
      registrationReplaced: true,
    },
  };
};

describe("production stale-widget-generation evidence", () => {
  it("accepts an exact no-mutation record for every retained G1 path", () => {
    expect(validateStaleGenerationEvidence(validEvidence())).toEqual({
      ok: true,
      failures: [],
    });
  });

  it.each([
    [
      "missing G1 panel disposer",
      evidence => (evidence.capture.g1PanelDisposer = false),
      /capture\.g1PanelDisposer/,
    ],
    [
      "a replacement widget identity",
      evidence => (evidence.forces.facadeFill.after.current.widget = false),
      /forces\.facadeFill\.after\.current\.widget/,
    ],
    [
      "a G2 DOM mutation",
      evidence => (evidence.forces.viewShowing.mutationDelta = 1),
      /forces\.viewShowing\.mutationDelta/,
    ],
    [
      "a changed owner lease",
      evidence => (evidence.forces.panelDisposer.after.owner.statusWidgetLeases = 0),
      /forces\.panelDisposer/,
    ],
    [
      "a terminal wake callback delivery",
      evidence => (evidence.forces.wakeCompletion.completion.readyCalls = 1),
      /forces\.wakeCompletion\.completion\.readyCalls/,
    ],
  ])("fails closed on %s", (_name, mutate, expected) => {
    const evidence = validEvidence();
    mutate(evidence);

    const result = validateStaleGenerationEvidence(evidence);

    expect(result.ok).toBe(false);
    expect(result.failures.map(failure => failure.path).join("\n")).toMatch(expected);
  });

  it("keeps the probe tied to real production reload seams", async () => {
    const source = await readFile(
      new URL("./probe-production-widget-stale-generation.mjs", import.meta.url),
      "utf8",
    );

    expect(REQUIRED_ASSERTIONS).toHaveLength(11);
    expect(source).toContain("launchLiveZen");
    expect(source).toContain('"dist/keep-loaded.sys.mjs"');
    expect(source).toContain('"dist/keep-loaded.uc.mjs"');
    expect(source).toContain("manager.rebuildMods(true, false)");
    expect(source).toContain("ui.createWidget");
    expect(source).toContain('Object.defineProperty(window, "CustomizableUI"');
    expect(source).not.toContain("ui.createWidget =");
    expect(source).toContain("controller.defer");
    expect(source).toContain("controller.settlePanel");
    expect(source).toContain("oldFacade.fillPanel");
    expect(source).toContain("retained.viewShowing");
    expect(source).toContain("retained.panelDisposerHeld");
  });
});
