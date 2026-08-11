import { describe, expect, it } from "vitest";
import { panelPresentation } from "./panel-presentation.ts";
import type { PanelReport } from "./rows.ts";

const report = (state: "alive" | "crashed" = "alive"): PanelReport => ({
  total: "1 kept tab",
  summary: state === "crashed" ? "1 needs attention" : "1 awake",
  groups: [
    {
      space: "Work",
      rows: [
        {
          detail: state === "crashed" ? "crashed just now" : "changed its title just now",
          state,
          stateLabel: state === "crashed" ? "Crashed" : "Awake",
          title: "mail.example.test",
          url: "https://mail.example.test/",
        },
      ],
    },
  ],
});

describe("panelPresentation", () => {
  it("starts with a complete loading state", () => {
    expect(panelPresentation({ kind: "loading" })).toEqual({
      action: { disabled: true, label: "Checking…", visible: true },
      content: { kind: "lines", lines: ["Checking kept tabs…"] },
      feedback: null,
      kind: "loading",
      reset: {
        disabled: true,
        label: "Reset crash recovery history",
        visible: false,
      },
    });
  });

  it("builds a ready report and enabled wake action from one snapshot", () => {
    expect(
      panelPresentation({
        busy: false,
        busyActionLabel: "Waking…",
        feedback: null,
        hasRecoveryAttempts: false,
        kept: 1,
        kind: "snapshot",
        report: report(),
        sleeping: 1,
        progress: null,
      }),
    ).toEqual({
      action: { disabled: false, label: "Wake 1 sleeping tab", visible: true },
      content: { kind: "report", report: report() },
      feedback: null,
      kind: "ready",
      reset: {
        disabled: true,
        label: "Reset crash recovery history",
        visible: false,
      },
    });
  });

  it("distinguishes an empty inventory from healthy kept tabs", () => {
    const emptyReport: PanelReport = {
      groups: [],
      summary: "Add sites in Sine settings, or use Keep loaded in a pinned tab’s menu.",
      total: "Keep a pinned tab awake",
    };
    expect(
      panelPresentation({
        busy: false,
        busyActionLabel: "Waking…",
        feedback: null,
        hasRecoveryAttempts: false,
        kept: 0,
        kind: "snapshot",
        report: emptyReport,
        sleeping: 0,
        progress: null,
      }),
    ).toEqual({
      action: { disabled: true, label: "", visible: false },
      content: { kind: "report", report: emptyReport },
      feedback: null,
      kind: "empty",
      reset: {
        disabled: true,
        label: "Reset crash recovery history",
        visible: false,
      },
    });
  });

  it("makes busy outrank a stale sleeping count", () => {
    expect(
      panelPresentation({
        busy: true,
        busyActionLabel: "Waking…",
        feedback: null,
        hasRecoveryAttempts: false,
        kept: 1,
        kind: "snapshot",
        report: report(),
        sleeping: 0,
        progress: "Waking 1 sleeping tab…",
      }),
    ).toMatchObject({
      action: { disabled: true, label: "Waking…", visible: true },
      feedback: "Waking 1 sleeping tab…",
      kind: "busy",
    });
  });

  it("marks a report with a crashed row as recovery", () => {
    expect(
      panelPresentation({
        busy: false,
        busyActionLabel: "Waking…",
        feedback: null,
        hasRecoveryAttempts: false,
        kept: 1,
        kind: "snapshot",
        report: report("crashed"),
        sleeping: 0,
        progress: null,
      }).kind,
    ).toBe("recovery");
  });

  it("offers process-wide crash-history reset only while history exists", () => {
    const withHistory = panelPresentation({
      busy: true,
      busyActionLabel: "Recovering…",
      feedback: "Recovering mail.example.test…",
      hasRecoveryAttempts: true,
      kept: 1,
      kind: "snapshot",
      report: report("crashed"),
      sleeping: 0,
      progress: "Recovering mail.example.test…",
    });
    expect(withHistory).toMatchObject({
      action: { disabled: true, label: "Recovering…", visible: true },
      feedback: "Recovering mail.example.test…",
      reset: {
        disabled: false,
        label: "Reset crash recovery history",
        visible: true,
      },
    });

    const afterReset = panelPresentation({
      busy: false,
      busyActionLabel: "Waking…",
      feedback: "Crash recovery history reset for this Zen session",
      hasRecoveryAttempts: false,
      kept: 1,
      kind: "snapshot",
      report: report("crashed"),
      sleeping: 0,
      progress: null,
    });
    expect(afterReset).toMatchObject({
      feedback: "Crash recovery history reset for this Zen session",
      reset: { visible: false },
    });
  });

  it("hides the wake action rather than calling a crashed-only panel awake", () => {
    const state = panelPresentation({
      busy: false,
      busyActionLabel: "Waking…",
      feedback: null,
      hasRecoveryAttempts: true,
      kept: 1,
      kind: "snapshot",
      progress: null,
      report: report("crashed"),
      sleeping: 0,
    });

    expect(state).toMatchObject({
      action: { disabled: true, label: "", visible: false },
      kind: "recovery",
    });
  });

  it("returns a complete unavailable state without retaining report data", () => {
    expect(panelPresentation({ kind: "unavailable" })).toEqual({
      action: { disabled: true, label: "Unavailable", visible: true },
      content: {
        kind: "lines",
        lines: [
          "Status unavailable",
          "Keep Loaded couldn’t inspect tabs. Check the Browser Console for details.",
        ],
      },
      kind: "unavailable",
      feedback: null,
      reset: {
        disabled: true,
        label: "Reset crash recovery history",
        visible: false,
      },
    });
  });

  it("represents a stopped generation as an intentional no-render state", () => {
    expect(panelPresentation({ kind: "stopped" })).toEqual({ kind: "stopped" });
  });
});
