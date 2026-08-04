import { describe, expect, it } from "vitest";
import {
  formatAge,
  isLifeSign,
  type LivenessRecord,
  livenessSummary,
} from "./liveness.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const record = (over: Partial<LivenessRecord> = {}): LivenessRecord => ({
  space: "a1b2",
  url: "https://mail.google.com/",
  last: { kind: "label", at: 0 },
  ...over,
});

describe("formatAge", () => {
  it("calls anything under a second just now", () => {
    expect(formatAge(0)).toBe("just now");
    expect(formatAge(999)).toBe("just now");
  });

  it("reports a clock that went backwards as just now, not a negative age", () => {
    expect(formatAge(-5000)).toBe("just now");
  });

  it("counts seconds, then minutes, then hours", () => {
    expect(formatAge(9000)).toBe("9s ago");
    expect(formatAge(4 * MINUTE)).toBe("4m ago");
    expect(formatAge(3 * HOUR)).toBe("3h ago");
  });

  it("rolls over at the unit boundary rather than saying 60", () => {
    expect(formatAge(60_000)).toBe("1m ago");
    expect(formatAge(HOUR)).toBe("1h ago");
  });
});

describe("isLifeSign", () => {
  const loaded = { pending: false, crashedPage: false };

  it("trusts a label change from a tab that has content to change it", () => {
    expect(isLifeSign("label", loaded)).toBe(true);
  });

  it("rejects a label change from a pending tab, which cannot have run any", () => {
    expect(isLifeSign("label", { pending: true, crashedPage: false })).toBe(false);
  });

  it("rejects a label change from a tab showing a crash page", () => {
    expect(isLifeSign("label", { pending: false, crashedPage: true })).toBe(false);
  });

  it("still believes the signs that report a tab being taken away", () => {
    const dead = { pending: true, crashedPage: true };
    expect(isLifeSign("discarded", dead)).toBe(true);
    expect(isLifeSign("crashed", dead)).toBe(true);
    expect(isLifeSign("restart-required", dead)).toBe(true);
    expect(isLifeSign("awake", dead)).toBe(true);
  });
});

describe("livenessSummary", () => {
  it("says so plainly when nothing is kept", () => {
    const summary = livenessSummary([], 0);
    expect(summary.message).toBe("liveness: nothing kept");
    expect(summary.lines).toEqual([]);
  });

  it("counts kept tabs and names the oldest sign", () => {
    const summary = livenessSummary(
      [
        record({ last: { kind: "label", at: 0 } }),
        record({ last: { kind: "label", at: 9 * MINUTE } }),
      ],
      10 * MINUTE,
    );
    expect(summary.message).toBe("liveness: 2 kept, oldest sign 10m ago");
  });

  it("gives each tab a line naming its space, url, sign and age", () => {
    const summary = livenessSummary(
      [
        record({
          space: "a1b2",
          url: "https://slack.com/",
          last: { kind: "label", at: 0 },
        }),
      ],
      2 * MINUTE,
    );
    expect(summary.lines).toEqual(["a1b2 https://slack.com/ label 2m ago"]);
  });

  it("reports a tab that has shown no sign at all, and counts it separately", () => {
    const summary = livenessSummary([record({ last: null })], 5 * MINUTE);
    expect(summary.message).toBe("liveness: 1 kept, 1 with no sign yet");
    expect(summary.lines).toEqual(["a1b2 https://mail.google.com/ no sign yet"]);
  });

  it("leads with the tabs worth worrying about: no sign first, then oldest", () => {
    const summary = livenessSummary(
      [
        record({ url: "https://fresh.test/", last: { kind: "label", at: 9 * MINUTE } }),
        record({ url: "https://stale.test/", last: { kind: "awake", at: 1 * MINUTE } }),
        record({ url: "https://unseen.test/", last: null }),
      ],
      10 * MINUTE,
    );
    expect(summary.lines.map(line => line.split(" ")[1])).toEqual([
      "https://unseen.test/",
      "https://stale.test/",
      "https://fresh.test/",
    ]);
  });

  it("keeps both counts when some tabs have signs and some do not", () => {
    const summary = livenessSummary(
      [record({ last: { kind: "label", at: 0 } }), record({ last: null })],
      MINUTE,
    );
    expect(summary.message).toBe(
      "liveness: 2 kept, oldest sign 1m ago, 1 with no sign yet",
    );
  });

  it("distinguishes a tab last seen dying from one last seen alive", () => {
    const summary = livenessSummary(
      [
        record({ url: "https://gone.test/", last: { kind: "discarded", at: 0 } }),
        record({ url: "https://dead.test/", last: { kind: "crashed", at: 0 } }),
      ],
      MINUTE,
    );
    expect(summary.lines).toEqual([
      "a1b2 https://gone.test/ discarded 1m ago",
      "a1b2 https://dead.test/ crashed 1m ago",
    ]);
  });

  it("separates a build-id mismatch from an ordinary crash, since only one is retryable", () => {
    const summary = livenessSummary(
      [record({ url: "https://stale.test/", last: { kind: "restart-required", at: 0 } })],
      MINUTE,
    );
    expect(summary.lines).toEqual(["a1b2 https://stale.test/ restart-required 1m ago"]);
  });
});
