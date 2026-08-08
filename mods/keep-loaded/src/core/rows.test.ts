import { describe, expect, it } from "vitest";
import { panelReport, QUIET_MS, type RowFacts } from "./rows.ts";

const NOW = 10_000_000;

const facts = (over: Partial<RowFacts> = {}): RowFacts => ({
  space: "🕵 Work",
  url: "https://mail.google.com/mail/u/0/#inbox",
  pending: false,
  last: { kind: "label", at: NOW - 5_000 },
  frames: { in: 10, out: 5, lastAt: NOW - 7_000 },
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
    expect(report.heading).toContain("nothing kept");
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
  });

  it("calls an unloaded tab asleep whatever its last sign was", () => {
    const report = panelReport(
      [facts({ pending: true, last: { kind: "label", at: NOW - 1_000 } })],
      NOW,
    );
    expect(states(report)).toEqual(["asleep"]);
  });

  it("reports a crash ahead of the unloading its own recovery does", () => {
    // `recover` resets a crashed tab to lazy before waking it, so a tab mid-recovery
    // is pending *and* crashed. The crash is the thing worth saying.
    const report = panelReport(
      [facts({ pending: true, last: { kind: "crashed", at: NOW - 1_000 } })],
      NOW,
    );
    expect(states(report)).toEqual(["crashed"]);
    expect(details(report)[0]).toContain("crashed");
  });

  it("distinguishes a restart-required crash in the detail", () => {
    const report = panelReport(
      [facts({ last: { kind: "restart-required", at: NOW - 1_000 } })],
      NOW,
    );
    expect(states(report)).toEqual(["crashed"]);
    expect(details(report)[0]).toContain("restart");
  });

  it("calls a tab with no sign at all unseen", () => {
    const report = panelReport([facts({ last: null })], NOW);
    expect(states(report)).toEqual(["unseen"]);
    expect(details(report)[0]).toContain("nothing seen yet");
  });

  it("names the sign it last saw, and how long ago", () => {
    const report = panelReport(
      [facts({ last: { kind: "label", at: NOW - 90_000 } })],
      NOW,
    );
    expect(details(report)[0]).toContain("title");
    expect(details(report)[0]).toContain("1m ago");
  });

  it("folds the frame counts into the same row", () => {
    expect(details(panelReport([facts()], NOW))[0]).toContain("10 in, 5 out");
    expect(details(panelReport([facts()], NOW))[0]).toContain("7s ago");
  });

  it("says a watched tab has had no frames rather than showing zeroes", () => {
    const report = panelReport([facts({ frames: { in: 0, out: 0, lastAt: null } })], NOW);
    expect(details(report)[0]).toContain("no frames yet");
    expect(details(report)[0]).not.toContain("0 in");
  });

  it("mentions an unwatched awake tab, but not an unwatched sleeping one", () => {
    // A lazy tab has no inner window to attach a listener to, so nothing is wrong.
    // An awake tab that is not watched means the attach failed, which is worth saying.
    expect(details(panelReport([facts({ frames: null })], NOW))[0]).toContain(
      "not watching",
    );
    expect(
      details(panelReport([facts({ frames: null, pending: true })], NOW))[0],
    ).not.toContain("not watching");
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

  it("counts the states in the heading", () => {
    const report = panelReport(
      [
        facts({ url: "https://a.test/" }),
        facts({ url: "https://b.test/" }),
        facts({ url: "https://c.test/", pending: true }),
      ],
      NOW,
    );
    expect(report.heading).toContain("3 kept");
    expect(report.heading).toContain("2 alive");
    expect(report.heading).toContain("1 asleep");
  });
});
