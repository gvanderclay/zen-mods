import { describe, expect, it } from "vitest";
import { panelPresentation } from "./panel-presentation.ts";
import type { PanelReport } from "./rows.ts";

const report = (state: "alive" | "crashed" = "alive"): PanelReport => ({
  heading: `1 kept — 1 ${state}`,
  groups: [
    {
      space: "Work",
      rows: [
        {
          detail: state === "crashed" ? "crashed just now" : "changed its title just now",
          state,
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
      action: { disabled: true, label: "Checking…" },
      content: { kind: "lines", lines: ["Checking kept tabs…"] },
      kind: "loading",
    });
  });

  it("builds a ready report and enabled wake action from one snapshot", () => {
    expect(
      panelPresentation({
        busy: false,
        kept: 1,
        kind: "snapshot",
        report: report(),
        sleeping: 1,
      }),
    ).toEqual({
      action: { disabled: false, label: "Wake 1 sleeping tab" },
      content: { kind: "report", report: report() },
      kind: "ready",
    });
  });

  it("distinguishes an empty inventory from healthy kept tabs", () => {
    const emptyReport: PanelReport = { heading: "nothing kept", groups: [] };
    expect(
      panelPresentation({
        busy: false,
        kept: 0,
        kind: "snapshot",
        report: emptyReport,
        sleeping: 0,
      }),
    ).toEqual({
      action: { disabled: true, label: "Nothing to wake" },
      content: { kind: "report", report: emptyReport },
      kind: "empty",
    });
  });

  it("makes busy outrank a stale sleeping count", () => {
    expect(
      panelPresentation({
        busy: true,
        kept: 1,
        kind: "snapshot",
        report: report(),
        sleeping: 0,
      }),
    ).toMatchObject({
      action: { disabled: true, label: "Waking…" },
      kind: "busy",
    });
  });

  it("marks a report with a crashed row as recovery", () => {
    expect(
      panelPresentation({
        busy: false,
        kept: 1,
        kind: "snapshot",
        report: report("crashed"),
        sleeping: 0,
      }).kind,
    ).toBe("recovery");
  });

  it("returns a complete unavailable state without retaining report data", () => {
    expect(panelPresentation({ kind: "unavailable" })).toEqual({
      action: { disabled: true, label: "Unavailable" },
      content: {
        kind: "lines",
        lines: [
          "Status unavailable",
          "Keep Loaded couldn’t inspect tabs. Check the Browser Console for details.",
        ],
      },
      kind: "unavailable",
    });
  });

  it("represents a stopped generation as an intentional no-render state", () => {
    expect(panelPresentation({ kind: "stopped" })).toEqual({ kind: "stopped" });
  });
});
