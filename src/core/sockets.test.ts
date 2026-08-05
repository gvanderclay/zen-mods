import { describe, expect, it } from "vitest";
import { type SocketRecord, socketSummary } from "./sockets.ts";

const NOW = 1_000_000;

const record = (over: Partial<SocketRecord> = {}): SocketRecord => ({
  space: "a1b2",
  url: "https://app.slack.com/client/T07/D09",
  watching: true,
  open: 1,
  framesIn: 12,
  framesOut: 4,
  lastFrameAt: NOW - 30_000,
  ...over,
});

describe("socketSummary", () => {
  it("reports nothing when nothing is kept", () => {
    const summary = socketSummary([], NOW);
    expect(summary.message).toContain("nothing kept");
    expect(summary.lines).toEqual([]);
  });

  it("says plainly when no frames have been seen at all", () => {
    // The whole point of the spike: silence here is the answer, not a bug to
    // debug, so it has to be stated rather than shown as a row of zeroes.
    const summary = socketSummary(
      [record({ framesIn: 0, framesOut: 0, lastFrameAt: null })],
      NOW,
    );
    expect(summary.message).toContain("no frames");
  });

  it("counts what is watched, what is receiving, and how many frames", () => {
    const summary = socketSummary(
      [
        record(),
        record({ url: "https://mail.google.com", framesIn: 8, framesOut: 0 }),
        record({ url: "https://calendar.google.com", watching: false, open: 0 }),
      ],
      NOW,
    );
    expect(summary.message).toContain("2 watched");
    expect(summary.message).toContain("2 receiving");
    expect(summary.message).toContain("24 frame(s)");
  });

  it("renders a row per tab, with counts and the age of the last frame", () => {
    const [line] = socketSummary([record()], NOW).lines;
    expect(line).toContain("https://app.slack.com/client/T07/D09");
    expect(line).toContain("12 in");
    expect(line).toContain("4 out");
    expect(line).toContain("30s ago");
  });

  it("marks a tab it could not watch, which is not the same as a quiet one", () => {
    const [line] = socketSummary([record({ watching: false })], NOW).lines;
    expect(line).toContain("not watched");
  });

  it("says a watched tab has no frames yet rather than dating them to the epoch", () => {
    const { lines } = socketSummary(
      [record({ framesIn: 0, framesOut: 0, lastFrameAt: null })],
      NOW,
    );
    const [line] = lines;
    expect(line).toContain("no frames yet");
  });

  it("puts the quietest tab first, since that is the one worth looking at", () => {
    const summary = socketSummary(
      [
        record({ url: "https://loud", lastFrameAt: NOW - 1000 }),
        record({ url: "https://quiet", lastFrameAt: NOW - 3 * 3600_000 }),
        record({ url: "https://silent", lastFrameAt: null, framesIn: 0, framesOut: 0 }),
      ],
      NOW,
    );
    expect(summary.lines[0]).toContain("https://silent");
    expect(summary.lines[1]).toContain("https://quiet");
    expect(summary.lines[2]).toContain("https://loud");
  });

  it("names the freshest frame, so a live socket is obvious at a glance", () => {
    const summary = socketSummary(
      [record({ lastFrameAt: NOW - 2000 }), record({ lastFrameAt: NOW - 60_000 })],
      NOW,
    );
    expect(summary.message).toContain("freshest 2s ago");
  });
});
