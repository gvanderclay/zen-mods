import { describe, expect, it } from "vitest";
import { parseMatchList } from "./match.ts";
import { shouldKeep, sweepSummary, type TabFacts, wakeSummary } from "./policy.ts";

const matchers = parseMatchList("mail.google.com,calendar.google.com,slack.com");

const facts = (overrides: Partial<TabFacts> = {}): TabFacts => ({
  space: "e6c3b400",
  url: "https://news.ycombinator.com/",
  pending: false,
  flagged: false,
  ...overrides,
});

describe("shouldKeep", () => {
  it("keeps an allowlisted url", () => {
    expect(
      shouldKeep(facts({ url: "https://mail.google.com/mail/u/0/#inbox" }), matchers),
    ).toBe(true);
  });

  it("drops an unrelated url", () => {
    expect(shouldKeep(facts(), matchers)).toBe(false);
  });

  it("keeps a flagged tab even when the allowlist is empty", () => {
    expect(shouldKeep(facts({ flagged: true }), [])).toBe(true);
  });

  it("keeps a flagged tab with no recorded url", () => {
    expect(shouldKeep(facts({ url: "", flagged: true }), matchers)).toBe(true);
  });

  it("drops an unflagged tab with no recorded url", () => {
    expect(shouldKeep(facts({ url: "" }), matchers)).toBe(false);
  });
});

describe("sweepSummary", () => {
  it("reproduces the observed startup line", () => {
    // 13 pinned across two spaces, five of them kept — the real session this
    // was built against.
    const spaces = ["e6c3b400", "adfc1ace"];
    const pinned = Array.from({ length: 13 }, (_, i) =>
      facts({ space: spaces[i % 2] as string }),
    );
    const kept = [
      facts({ space: "e6c3b400", url: "https://mail.google.com/mail/u/0/#inbox" }),
      facts({ space: "e6c3b400", url: "https://calendar.google.com/calendar/u/0/r" }),
      facts({ space: "e6c3b400", url: "https://app.slack.com/client/T07KM2SEAV6" }),
      facts({ space: "adfc1ace", url: "https://mail.google.com/mail/u/0/#inbox" }),
      facts({
        space: "adfc1ace",
        url: "https://calendar.google.com/calendar/u/0/r?pli=1",
      }),
    ];

    expect(sweepSummary(pinned, kept)).toEqual({
      message: "13 pinned tab(s) across 2 space(s), 5 matched",
      kept: [
        "e6c3b400 https://mail.google.com/mail/u/0/#inbox",
        "e6c3b400 https://calendar.google.com/calendar/u/0/r",
        "e6c3b400 https://app.slack.com/client/T07KM2SEAV6",
        "adfc1ace https://mail.google.com/mail/u/0/#inbox",
        "adfc1ace https://calendar.google.com/calendar/u/0/r?pli=1",
      ],
    });
  });

  it("counts one space when every tab shares it", () => {
    expect(sweepSummary([facts(), facts()], []).message).toBe(
      "2 pinned tab(s) across 1 space(s), 0 matched",
    );
  });

  it("reports zero spaces for no pinned tabs", () => {
    expect(sweepSummary([], []).message).toBe(
      "0 pinned tab(s) across 0 space(s), 0 matched",
    );
  });
});

describe("wakeSummary", () => {
  it("reports a clean wake", () => {
    expect(wakeSummary(5, [])).toBe("woke 5 tab(s)");
  });

  it("names the tabs that never came back", () => {
    expect(wakeSummary(5, ["https://a.example/", "https://b.example/"])).toBe(
      "3/5 woke, still pending: https://a.example/,https://b.example/",
    );
  });
});
