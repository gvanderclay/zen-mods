import { describe, expect, it } from "vitest";
import { panelReport, QUIET_MS, type RowFacts } from "./rows.ts";

const NOW = 10_000_000;

const facts = (over: Partial<RowFacts> = {}): RowFacts => ({
  space: "🕵 Work",
  url: "https://mail.google.com/mail/u/0/#inbox",
  pending: false,
  last: { kind: "label", at: NOW - 5_000 },
  frames: { in: 10, out: 5, lastAt: NOW - 7_000 },
  recovery: { active: false, attempts: 0, maxAttempts: 3 },
  ...over,
});

const states = (report: ReturnType<typeof panelReport>) =>
  report.groups.flatMap(group => group.rows.map(row => row.state));

const details = (report: ReturnType<typeof panelReport>) =>
  report.groups.flatMap(group => group.rows.map(row => row.detail));

const onlyRow = (report: ReturnType<typeof panelReport>) => {
  const [row] = report.groups.flatMap(group => group.rows);
  if (!row) {
    throw new Error("expected one row");
  }
  return row;
};

describe("panelReport", () => {
  it("says nothing is kept rather than showing an empty table", () => {
    const report = panelReport([], NOW);
    expect(report.total).toBe("Keep a pinned tab awake");
    expect(report.summary).toBe(
      "Add sites in Sine settings, or use Keep loaded in a pinned tab’s menu.",
    );
    expect(report.groups).toEqual([]);
  });

  it("calls a fresh sign alive and an old one quiet", () => {
    const report = panelReport(
      [
        facts({ url: "https://fresh.test/", last: { kind: "label", at: NOW - 1_000 } }),
        facts({
          url: "https://stale.test/",
          last: { kind: "label", at: NOW - QUIET_MS - 1 },
        }),
      ],
      NOW,
    );
    expect(states(report)).toEqual(["quiet", "alive"]);
    expect(report.groups[0]?.rows.map(row => row.stateLabel)).toEqual(["Quiet", "Awake"]);
  });

  it("calls an unloaded tab asleep whatever its last sign was", () => {
    const report = panelReport(
      [facts({ pending: true, last: { kind: "label", at: NOW - 1_000 } })],
      NOW,
    );
    expect(states(report)).toEqual(["asleep"]);
    expect(onlyRow(report).stateLabel).toBe("Sleeping");
  });

  it("reports a crash ahead of the unloading its own recovery does", () => {
    // `recover` resets a crashed tab to lazy before waking it, so a tab mid-recovery
    // is pending *and* crashed. The crash is the thing worth saying.
    const report = panelReport(
      [
        facts({
          pending: true,
          last: { kind: "crashed", at: NOW - 1_000 },
          recovery: { active: true, attempts: 1, maxAttempts: 3 },
        }),
      ],
      NOW,
    );
    expect(states(report)).toEqual(["crashed"]);
    expect(details(report)[0]).toBe("Recovering · attempt 1 of 3");
  });

  it("distinguishes a restart-required crash in the detail", () => {
    const report = panelReport(
      [
        facts({
          last: { kind: "restart-required", at: NOW - 1_000 },
          recovery: { active: false, attempts: 0, maxAttempts: 3 },
        }),
      ],
      NOW,
    );
    expect(states(report)).toEqual(["crashed"]);
    expect(details(report)[0]).toBe("Restart Zen to recover this tab");
  });

  it("calls a tab with no sign at all unseen", () => {
    const report = panelReport([facts({ last: null })], NOW);
    expect(states(report)).toEqual(["unseen"]);
    expect(onlyRow(report).stateLabel).toBe("No signal yet");
    expect(details(report)[0]).toContain("No sign yet");
  });

  it("names the sign it last saw, and how long ago", () => {
    const report = panelReport(
      [facts({ last: { kind: "label", at: NOW - 90_000 } })],
      NOW,
    );
    expect(details(report)[0]).toContain("Title changed");
    expect(details(report)[0]).toContain("1m ago");
  });

  it("folds the frame counts into the same row", () => {
    expect(details(panelReport([facts()], NOW))[0]).toContain(
      "WebSocket activity 7s ago",
    );
    expect(details(panelReport([facts()], NOW))[0]).not.toContain("10 in");
  });

  it("says a watched tab has had no frames rather than showing zeroes", () => {
    const report = panelReport([facts({ frames: { in: 0, out: 0, lastAt: null } })], NOW);
    expect(details(report)[0]).not.toContain("frame");
    expect(details(report)[0]).not.toContain("0 in");
  });

  it("mentions an unwatched awake tab, but not an unwatched sleeping one", () => {
    // A lazy tab has no inner window to attach a listener to, so nothing is wrong.
    // An awake tab that is not watched means the attach failed, which is worth saying.
    expect(details(panelReport([facts({ frames: null })], NOW))[0]).toContain(
      "WebSocket status unavailable",
    );
    expect(
      details(panelReport([facts({ frames: null, pending: true })], NOW))[0],
    ).not.toContain("WebSocket");
  });

  it("shortens the url for reading and keeps the whole one for the tooltip", () => {
    const url = `https://www.example.test/${"deep/".repeat(20)}end`;
    const row = onlyRow(panelReport([facts({ url })], NOW));
    expect(row.url).toBe(url);
    expect(row.title.length).toBeLessThan(50);
    expect(row.title.startsWith("example.test/")).toBe(true);
  });

  it("still labels a tab whose url could not be resolved", () => {
    expect(onlyRow(panelReport([facts({ url: "" })], NOW)).title).not.toBe("");
  });

  it("groups by space, in the order the spaces first appear", () => {
    const report = panelReport(
      [
        facts({ space: "🕵 Work", url: "https://a.test/" }),
        facts({ space: "🐟 Home", url: "https://b.test/" }),
        facts({ space: "🕵 Work", url: "https://c.test/" }),
      ],
      NOW,
    );
    expect(report.groups.map(group => group.space)).toEqual(["🕵 Work", "🐟 Home"]);
    expect(report.groups.map(group => group.rows.map(row => row.url))).toEqual([
      ["https://a.test/", "https://c.test/"],
      ["https://b.test/"],
    ]);
  });

  it("puts the tabs needing attention first inside a space", () => {
    const report = panelReport(
      [
        facts({ space: "one", url: "https://alive.test/" }),
        facts({ space: "one", url: "https://unseen.test/", last: null }),
        facts({
          space: "one",
          url: "https://crashed.test/",
          last: { kind: "crashed", at: NOW },
        }),
        facts({ space: "one", url: "https://asleep.test/", pending: true }),
      ],
      NOW,
    );
    expect(states(report)).toEqual(["crashed", "asleep", "unseen", "alive"]);
  });

  it("separates the kept total from a glanceable visible-state summary", () => {
    const report = panelReport(
      [
        facts({ url: "https://a.test/" }),
        facts({ url: "https://b.test/" }),
        facts({ url: "https://c.test/", pending: true }),
      ],
      NOW,
    );
    expect(report.total).toBe("3 kept tabs");
    expect(report.summary).toBe("1 sleeping · 2 awake");
  });

  it("distinguishes active, exhausted, disabled, and restart-bound recovery", () => {
    const active = onlyRow(
      panelReport(
        [
          facts({
            last: { kind: "crashed", at: NOW },
            recovery: { active: true, attempts: 2, maxAttempts: 3 },
          }),
        ],
        NOW,
      ),
    );
    const exhausted = onlyRow(
      panelReport(
        [
          facts({
            last: { kind: "crashed", at: NOW },
            recovery: { active: false, attempts: 3, maxAttempts: 3 },
          }),
        ],
        NOW,
      ),
    );
    const disabled = onlyRow(
      panelReport(
        [
          facts({
            last: { kind: "crashed", at: NOW },
            recovery: { active: false, attempts: 0, maxAttempts: 0 },
          }),
        ],
        NOW,
      ),
    );

    expect(active.detail).toBe("Recovering · attempt 2 of 3");
    expect(exhausted.detail).toBe("Recovery limit reached · 3 of 3 attempts used");
    expect(disabled.detail).toBe("Automatic recovery is off");
  });
});
