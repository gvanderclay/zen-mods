import { describe, expect, it } from "vitest";
import { type Probe, reportCapabilities } from "./capabilities.ts";

const probe = (name: string, present: boolean, required = true): Probe => ({
  name,
  present,
  required,
});

describe("reportCapabilities", () => {
  it("passes silently when everything is present", () => {
    expect(
      reportCapabilities([
        probe("gBrowser._insertBrowser", true),
        probe("x", true, false),
      ]),
    ).toEqual({
      ok: true,
      missingRequired: [],
      missingOptional: [],
      message: "",
    });
  });

  it("fails and names what is gone when a required capability is missing", () => {
    const report = reportCapabilities([
      probe("gBrowser._insertBrowser", false),
      probe("SessionStore.getLazyTabValue", true),
    ]);
    expect(report.ok).toBe(false);
    expect(report.missingRequired).toEqual(["gBrowser._insertBrowser"]);
    expect(report.message).toBe(
      "Zen no longer provides gBrowser._insertBrowser — not sweeping. This mod depends on private APIs; see DECISIONS.md.",
    );
  });

  it("lists every missing required capability in the order probed", () => {
    const report = reportCapabilities([
      probe("b", false),
      probe("a", true),
      probe("c", false),
    ]);
    expect(report.missingRequired).toEqual(["b", "c"]);
    expect(report.message).toBe(
      "Zen no longer provides b, c — not sweeping. This mod depends on private APIs; see DECISIONS.md.",
    );
  });

  it("still runs when only optional capabilities are missing, but says so", () => {
    const report = reportCapabilities([
      probe("gZenWorkspaces.allStoredTabs", false, false),
      probe("gBrowser._insertBrowser", true),
    ]);
    expect(report.ok).toBe(true);
    expect(report.missingOptional).toEqual(["gZenWorkspaces.allStoredTabs"]);
    expect(report.message).toBe(
      "running degraded, gZenWorkspaces.allStoredTabs is missing",
    );
  });

  it("reports required failures even when optional ones are also missing", () => {
    const report = reportCapabilities([probe("a", false), probe("b", false, false)]);
    expect(report.ok).toBe(false);
    expect(report.missingRequired).toEqual(["a"]);
    expect(report.missingOptional).toEqual(["b"]);
    expect(report.message).toContain("Zen no longer provides a");
  });

  it("treats an empty probe list as nothing to complain about", () => {
    expect(reportCapabilities([])).toEqual({
      ok: true,
      missingRequired: [],
      missingOptional: [],
      message: "",
    });
  });
});
