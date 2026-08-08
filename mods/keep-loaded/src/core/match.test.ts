import { describe, expect, it } from "vitest";
import { matchesAllowlist, parseMatchList } from "./match.ts";

const DEFAULT_MATCH = "mail.google.com,calendar.google.com,slack.com";

describe("parseMatchList", () => {
  it("splits the default pref value", () => {
    expect(parseMatchList(DEFAULT_MATCH)).toEqual([
      "mail.google.com",
      "calendar.google.com",
      "slack.com",
    ]);
  });

  it("tolerates whitespace, newlines, and empty entries", () => {
    expect(parseMatchList(" a.com ,\n b.com ,,")).toEqual(["a.com", "b.com"]);
  });

  it("lowercases entries", () => {
    expect(parseMatchList("Mail.Google.COM")).toEqual(["mail.google.com"]);
  });

  it("returns nothing for an empty pref", () => {
    expect(parseMatchList("")).toEqual([]);
    expect(parseMatchList("  ,  ")).toEqual([]);
  });
});

describe("matchesAllowlist", () => {
  const matchers = parseMatchList(DEFAULT_MATCH);

  it("matches a real pinned tab url", () => {
    expect(matchesAllowlist("https://mail.google.com/mail/u/0/#inbox", matchers)).toBe(
      true,
    );
  });

  it("matches regardless of url case", () => {
    expect(matchesAllowlist("https://MAIL.GOOGLE.COM/mail", matchers)).toBe(true);
  });

  it("matches a deep path, as a woken Slack tab reports", () => {
    const url = "https://app.slack.com/client/T07KM2SEAV6/D099GM2L7LP";
    expect(matchesAllowlist(url, matchers)).toBe(true);
  });

  it("rejects an unrelated url", () => {
    expect(matchesAllowlist("https://news.ycombinator.com/", matchers)).toBe(false);
  });

  it("rejects an empty url rather than matching everything", () => {
    expect(matchesAllowlist("", matchers)).toBe(false);
  });

  it("matches nothing when the allowlist is empty", () => {
    expect(matchesAllowlist("https://mail.google.com/", [])).toBe(false);
  });
});
