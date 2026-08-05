import { describe, expect, it } from "vitest";
import { DEFAULT_FRESHEN_HOLD_SECONDS, DEFAULT_FRESHEN_SECONDS } from "./defaults.ts";
import {
  isPulsing,
  type PulseFacts,
  type PulseOutcome,
  parsePulseSettings,
  pulseStep,
  pulseSummary,
} from "./freshness.ts";

const NOW = 1_700_000_000_000;
const EVERY_MS = 120_000;
const HOLD_MS = 5000;

const settings = (everyMs = EVERY_MS, holdMs = HOLD_MS) => ({ everyMs, holdMs });

/** A kept, awake, unselected tab nothing else has claimed: the case pulsing is for. */
const facts = (over: Partial<PulseFacts> = {}): PulseFacts => ({
  url: "https://mail.google.com/mail/u/0/",
  kept: true,
  pending: false,
  selected: false,
  active: false,
  heldSince: null,
  lastPulseAt: null,
  ...over,
});

describe("pulseStep, deciding whether to activate", () => {
  it("activates a kept tab whose page is unselected and idle", () => {
    const step = pulseStep(facts(), settings(), NOW);
    expect(step.action).toBe("activate");
    expect(step.reason).toContain("5s");
  });

  it("does nothing at all while pulsing is turned off", () => {
    const step = pulseStep(facts(), settings(0), NOW);
    expect(step.action).toBe("skip");
    expect(step.reason).toContain("turned off");
  });

  it("leaves a sleeping tab alone, since it has no page to run", () => {
    const step = pulseStep(facts({ pending: true }), settings(), NOW);
    expect(step.action).toBe("skip");
    expect(step.reason).toContain("asleep");
  });

  it("leaves the selected tab alone, since the browser already runs it", () => {
    const step = pulseStep(facts({ selected: true }), settings(), NOW);
    expect(step.action).toBe("skip");
    expect(step.reason).toContain("selected");
  });

  it("never claims a docshell something else activated", () => {
    // Zen's glance, split view and window sync all set this. Claiming it would mean
    // deactivating it later on behalf of whoever actually owns it.
    const step = pulseStep(facts({ active: true }), settings(), NOW);
    expect(step.action).toBe("skip");
    expect(step.reason).toContain("not by us");
  });

  it("leaves a merely-pinned tab alone", () => {
    const step = pulseStep(facts({ kept: false }), settings(), NOW);
    expect(step.action).toBe("skip");
    expect(step.reason).toContain("not a tab the mod keeps");
  });

  it("waits out the interval between pulses", () => {
    const step = pulseStep(facts({ lastPulseAt: NOW - 30_000 }), settings(), NOW);
    expect(step.action).toBe("skip");
    expect(step.reason).toContain("not due");
  });

  it("pulses again once the interval has passed", () => {
    const step = pulseStep(facts({ lastPulseAt: NOW - EVERY_MS }), settings(), NOW);
    expect(step.action).toBe("activate");
  });

  it("treats a pulse timestamp from the future as due", () => {
    // A clock that jumped back would otherwise park the tab until real time caught
    // up with it, which is exactly the staleness this exists to bound.
    const step = pulseStep(facts({ lastPulseAt: NOW + EVERY_MS }), settings(), NOW);
    expect(step.action).toBe("activate");
  });
});

describe("pulseStep, deciding whether to let go", () => {
  /** A tab this mod activated `age` ms ago and still holds. */
  const held = (age: number, over: Partial<PulseFacts> = {}) =>
    facts({ active: true, heldSince: NOW - age, lastPulseAt: NOW - age, ...over });

  it("keeps holding until the pulse is up", () => {
    const step = pulseStep(held(HOLD_MS - 1000), settings(), NOW);
    expect(step.action).toBe("skip");
    expect(step.reason).toContain("still");
  });

  it("releases the docshell once the pulse is up", () => {
    const step = pulseStep(held(HOLD_MS), settings(), NOW);
    expect(step.action).toBe("release");
    expect(step.reason).toContain("up");
  });

  it("releases immediately when pulsing is turned off mid-pulse", () => {
    const step = pulseStep(held(1000), settings(0), NOW);
    expect(step.action).toBe("release");
    expect(step.reason).toContain("turned off");
  });

  it("never deactivates a tab that has become selected", () => {
    // The browser sets this itself on a tab switch, and deactivating the tab the
    // user is looking at would freeze the page in front of them.
    const step = pulseStep(held(HOLD_MS, { selected: true }), settings(), NOW);
    expect(step.action).toBe("forget");
    expect(step.reason).toContain("selected");
  });

  it("forgets a tab something else has already deactivated", () => {
    const step = pulseStep(held(1000, { active: false }), settings(), NOW);
    expect(step.action).toBe("forget");
    expect(step.reason).toContain("something else");
  });

  it("forgets a tab that was unloaded while we held it", () => {
    const step = pulseStep(held(1000, { active: false, pending: true }), settings(), NOW);
    expect(step.action).toBe("forget");
  });

  it("releases rather than holding forever when the clock jumps backwards", () => {
    const step = pulseStep(
      facts({ active: true, heldSince: NOW + HOLD_MS }),
      settings(),
      NOW,
    );
    expect(step.action).toBe("release");
  });

  it("releases a tab that stopped being kept mid-pulse", () => {
    // Released from the allowlist while held, it drops out of every other loop —
    // so this is the only thing that would ever give its docshell back.
    const step = pulseStep(held(1000, { kept: false }), settings(), NOW);
    expect(step.action).toBe("release");
    expect(step.reason).toContain("no longer kept");
  });

  it("lets go of a selected tab even while pulsing is turned off", () => {
    // Order matters: turning the setting off must not deactivate the visible tab.
    const step = pulseStep(held(1000, { selected: true }), settings(0), NOW);
    expect(step.action).toBe("forget");
  });
});

describe("parsePulseSettings", () => {
  it("reads the interval in seconds", () => {
    expect(parsePulseSettings("120", "5").everyMs).toBe(120_000);
  });

  it("reads the hold in seconds", () => {
    expect(parsePulseSettings("120", "8").holdMs).toBe(8000);
  });

  it("treats an interval of zero as turned off", () => {
    expect(parsePulseSettings("0", "5").everyMs).toBe(0);
    expect(isPulsing(parsePulseSettings("0", "5"))).toBe(false);
  });

  it("tolerates the whitespace a settings field collects", () => {
    expect(parsePulseSettings(" 90 ", " 3 ")).toEqual({ everyMs: 90_000, holdMs: 3000 });
  });

  it("allows a fraction of a second, since nothing breaks on one", () => {
    expect(parsePulseSettings("60", "0.5").holdMs).toBe(500);
  });

  it("falls back to off for an interval that is not a number", () => {
    // Failing safe means costing nothing: an unreadable setting must not leave
    // every kept tab painting.
    for (const raw of ["", "   ", "abc", "-5", "NaN", "1e400", "2 minutes"]) {
      expect(parsePulseSettings(raw, "5").everyMs).toBe(0);
    }
  });

  it("falls back to the default hold for a hold that is not a number", () => {
    const fallback = Number(DEFAULT_FRESHEN_HOLD_SECONDS) * 1000;
    for (const raw of ["", "   ", "abc", "0", "-5", "NaN", "1e400", "5s"]) {
      expect(parsePulseSettings("120", raw).holdMs).toBe(fallback);
    }
  });

  it("clamps the hold to the interval, so one pulse cannot outlast the next", () => {
    expect(parsePulseSettings("4", "30")).toEqual({ everyMs: 4000, holdMs: 4000 });
  });

  it("parses its own declared defaults", () => {
    // Both fall back to these, so a default that does not parse leaves nothing
    // to fall back to.
    const parsed = parsePulseSettings(
      DEFAULT_FRESHEN_SECONDS,
      DEFAULT_FRESHEN_HOLD_SECONDS,
    );
    expect(parsed.everyMs).toBe(0);
    expect(parsed.holdMs).toBeGreaterThan(0);
  });
});

describe("isPulsing", () => {
  it("is off for an interval of zero", () => {
    expect(isPulsing(settings(0))).toBe(false);
  });

  it("is on for any interval at all", () => {
    expect(isPulsing(settings(1000))).toBe(true);
  });
});

describe("pulseSummary", () => {
  const outcome = (
    url: string,
    action: PulseOutcome["step"]["action"],
  ): PulseOutcome => ({
    url,
    step: { action, reason: `${action} because` },
  });

  it("says nothing on a tick where nothing happened", () => {
    expect(pulseSummary([outcome("https://a/", "skip")])).toBeNull();
    expect(pulseSummary([])).toBeNull();
  });

  it("counts what it did, and names each tab it did it to", () => {
    const report = pulseSummary([
      outcome("https://a/", "activate"),
      outcome("https://b/", "release"),
      outcome("https://c/", "release"),
      outcome("https://d/", "skip"),
    ]);
    expect(report?.message).toBe("freshness: activated 1, released 2");
    expect(report?.lines).toEqual([
      "https://a/: activate because",
      "https://b/: release because",
      "https://c/: release because",
    ]);
  });

  it("reports letting go separately from releasing, since nothing was written", () => {
    const report = pulseSummary([outcome("https://a/", "forget")]);
    expect(report?.message).toBe("freshness: let go of 1");
  });
});
