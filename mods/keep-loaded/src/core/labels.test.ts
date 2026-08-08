import { describe, expect, it } from "vitest";
import { type LabelFacts, type LabelOutcome, labelStep, labelSummary } from "./labels.ts";

/** A kept tab whose page has moved on and whose label has not: the case this is for. */
const facts = (over: Partial<LabelFacts> = {}): LabelFacts => ({
  url: "https://mail.google.com/mail/u/0/",
  kept: true,
  pending: false,
  title: "Inbox (3) - gage@getbrick.app - Gmail",
  label: "Inbox - gage@getbrick.app - Gmail",
  renamed: false,
  managed: false,
  ...over,
});

describe("labelStep, deciding whether to write a label", () => {
  it("writes when a kept tab's label is behind its page", () => {
    const step = labelStep(facts());
    expect(step.action).toBe("write");
    expect(step.reason).toContain("behind its page");
  });

  it("leaves a tab the mod does not keep alone", () => {
    const step = labelStep(facts({ kept: false }));
    expect(step.action).toBe("skip");
    expect(step.reason).toContain("not a tab the mod keeps");
  });

  it("leaves a sleeping tab alone, since it has no page to ask", () => {
    const step = labelStep(facts({ pending: true }));
    expect(step.action).toBe("skip");
    expect(step.reason).toContain("asleep");
  });

  it("never overwrites a tab the user renamed", () => {
    const step = labelStep(facts({ renamed: true }));
    expect(step.action).toBe("skip");
    expect(step.reason).toContain("renamed");
  });

  it("stays out of the way when Zen is keeping the label itself", () => {
    const step = labelStep(facts({ managed: true }));
    expect(step.action).toBe("skip");
    expect(step.reason).toContain("Zen");
  });

  it("waits for a page that has not said what it is called", () => {
    const step = labelStep(facts({ title: "" }));
    expect(step.action).toBe("skip");
    expect(step.reason).toContain("no title");
  });

  it("treats a whitespace-only title as no title at all", () => {
    expect(labelStep(facts({ title: "   " })).action).toBe("skip");
  });

  it("does nothing when the label already matches the page", () => {
    const step = labelStep(facts({ label: "Inbox (3)", title: "Inbox (3)" }));
    expect(step.action).toBe("skip");
    expect(step.reason).toContain("already matches");
  });

  it("ignores the whitespace Zen trims off a label", () => {
    expect(labelStep(facts({ title: " Inbox (3) ", label: "Inbox (3)" })).action).toBe(
      "skip",
    );
  });

  it("writes for a tab that has never had a label at all", () => {
    expect(labelStep(facts({ label: "" })).action).toBe("write");
  });

  /**
   * The order matters more than any single case: a renamed tab is skipped for being
   * renamed, not for whatever else is true of it, or the log would say the wrong thing.
   */
  it("reports the first reason that applies, not the last", () => {
    expect(
      labelStep(facts({ kept: false, pending: true, renamed: true })).reason,
    ).toContain("not a tab the mod keeps");
    expect(labelStep(facts({ pending: true, renamed: true })).reason).toContain("asleep");
    expect(labelStep(facts({ renamed: true, managed: true })).reason).toContain(
      "renamed",
    );
  });
});

describe("labelSummary", () => {
  const outcome = (url: string, action: "write" | "skip"): LabelOutcome => ({
    url,
    step: { action, reason: action === "write" ? "its label is behind its page" : "no" },
  });

  it("says nothing when no label was written", () => {
    expect(labelSummary([outcome("a", "skip"), outcome("b", "skip")])).toBeNull();
  });

  it("says nothing at all for an empty pass", () => {
    expect(labelSummary([])).toBeNull();
  });

  it("counts what it wrote and names the tabs it wrote for", () => {
    const report = labelSummary([
      outcome("https://mail.google.com/", "write"),
      outcome("https://calendar.google.com/", "skip"),
      outcome("https://app.slack.com/", "write"),
    ]);
    expect(report?.message).toBe("titles: 2 relabelled");
    expect(report?.lines).toEqual([
      "https://mail.google.com/: its label is behind its page",
      "https://app.slack.com/: its label is behind its page",
    ]);
  });
});
