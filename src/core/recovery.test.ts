import { describe, expect, it } from "vitest";
import type { CrashFacts } from "./crash.ts";
import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_WINDOW_MINUTES,
  parseAttempts,
  parseWindowMs,
  recentAttempts,
  recoveryPlan,
} from "./recovery.ts";

const WINDOW = DEFAULT_WINDOW_MINUTES * 60_000;
const NOW = 10 * WINDOW;

/** `count` attempts, each `age` ms ago. Only their age matters to the budget. */
const spent = (count: number, age = 0) => Array.from({ length: count }, () => NOW - age);

/** The budget a crash is judged against, defaulting to untouched settings. */
const budget = (
  attempts: readonly number[] = [],
  windowMs = WINDOW,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
) => ({ attempts, now: NOW, windowMs, maxAttempts });

const facts = (over: Partial<CrashFacts> = {}): CrashFacts => ({
  url: "https://app.slack.com/client/T07/D09",
  kind: "crashed",
  pending: true,
  remote: false,
  connected: true,
  crashedPage: false,
  ...over,
});

describe("recoveryPlan", () => {
  it("resets a revived tab, which still has its browser attached", () => {
    const plan = recoveryPlan(facts(), budget());
    expect(plan.action).toBe("reset-then-wake");
    expect(plan.reason).toContain("non-remote");
  });

  it("skips the reset for a tab whose browser is already detached", () => {
    const plan = recoveryPlan(facts({ connected: false }), budget());
    expect(plan.action).toBe("wake");
  });

  it("refuses a build-id mismatch however healthy the rest looks", () => {
    const plan = recoveryPlan(
      facts({ kind: "restart-required", remote: true }),
      budget(),
    );
    expect(plan.action).toBe("skip");
    expect(plan.reason).toContain("restart");
  });

  it("refuses a tab already showing a crash page", () => {
    const plan = recoveryPlan(facts({ pending: false, crashedPage: true }), budget());
    expect(plan.action).toBe("skip");
    expect(plan.reason).toContain("crash page");
  });

  it("refuses a tab that was never revived, so has no restore state", () => {
    const plan = recoveryPlan(facts({ pending: false }), budget());
    expect(plan.action).toBe("skip");
    expect(plan.reason).toContain("not revived");
  });

  it("keeps recovering up to the budget", () => {
    expect(recoveryPlan(facts(), budget(spent(DEFAULT_MAX_ATTEMPTS - 1))).action).toBe(
      "reset-then-wake",
    );
  });

  it("stops once the budget is spent, rather than fighting a crash loop", () => {
    const plan = recoveryPlan(facts(), budget(spent(DEFAULT_MAX_ATTEMPTS)));
    expect(plan.action).toBe("skip");
    expect(plan.reason).toBe(
      `already recovered ${DEFAULT_MAX_ATTEMPTS} time(s) in the last ${DEFAULT_WINDOW_MINUTES} minute(s)`,
    );
  });

  it("reports a mismatch as terminal before it reports the budget", () => {
    const plan = recoveryPlan(
      facts({ kind: "restart-required" }),
      budget(spent(DEFAULT_MAX_ATTEMPTS)),
    );
    expect(plan.reason).toContain("restart");
  });

  it("tries again for a tab whose attempts have all aged out", () => {
    const old = spent(DEFAULT_MAX_ATTEMPTS, WINDOW + 1000);
    expect(recoveryPlan(facts(), budget(old)).action).toBe("reset-then-wake");
  });

  it("counts an attempt that is still inside the window", () => {
    const recent = spent(DEFAULT_MAX_ATTEMPTS, WINDOW - 1000);
    expect(recoveryPlan(facts(), budget(recent)).action).toBe("skip");
  });

  it("counts a mix by age, not by how many there have ever been", () => {
    const attempts = [...spent(5, 5 * WINDOW), ...spent(DEFAULT_MAX_ATTEMPTS - 1)];
    expect(recoveryPlan(facts(), budget(attempts)).action).toBe("reset-then-wake");
  });
});

describe("recoveryPlan with a configured window", () => {
  it("gives up sooner when the window is narrowed", () => {
    const attempts = spent(DEFAULT_MAX_ATTEMPTS, 10 * 60_000);
    expect(recoveryPlan(facts(), budget(attempts, 30 * 60_000)).action).toBe("skip");
    expect(recoveryPlan(facts(), budget(attempts, 5 * 60_000)).action).toBe(
      "reset-then-wake",
    );
  });

  it("names the configured window in the reason, not the default", () => {
    const plan = recoveryPlan(facts(), budget(spent(DEFAULT_MAX_ATTEMPTS), 15 * 60_000));
    expect(plan.reason).toBe(
      `already recovered ${DEFAULT_MAX_ATTEMPTS} time(s) in the last 15 minute(s)`,
    );
  });
});

describe("recoveryPlan with a configured attempt limit", () => {
  it("keeps going past the default when the limit is raised", () => {
    const attempts = spent(DEFAULT_MAX_ATTEMPTS);
    expect(recoveryPlan(facts(), budget(attempts, WINDOW, 5)).action).toBe(
      "reset-then-wake",
    );
  });

  it("gives up sooner when the limit is lowered, and says so", () => {
    const plan = recoveryPlan(facts(), budget(spent(1), WINDOW, 1));
    expect(plan.action).toBe("skip");
    expect(plan.reason).toBe(`already recovered 1 time(s) in the last 60 minute(s)`);
  });

  it("treats a limit of zero as recovery turned off", () => {
    const plan = recoveryPlan(facts(), budget([], WINDOW, 0));
    expect(plan.action).toBe("skip");
    expect(plan.reason).toContain("turned off");
  });

  it("reports being turned off before anything else, including a mismatch", () => {
    // Nothing else is worth saying when the answer is the setting, and the crash
    // diagnosis has already reported the mismatch on its own line.
    const plan = recoveryPlan(facts({ kind: "restart-required" }), budget([], WINDOW, 0));
    expect(plan.reason).toContain("turned off");
  });
});

describe("parseAttempts", () => {
  it("reads a plain count", () => {
    expect(parseAttempts("5")).toBe(5);
    expect(parseAttempts("1")).toBe(1);
  });

  it("reads zero, which turns recovery off", () => {
    expect(parseAttempts("0")).toBe(0);
  });

  it("tolerates the whitespace a settings field collects", () => {
    expect(parseAttempts(" 4 ")).toBe(4);
  });

  it("floors a fraction, so the logged count matches the behaviour", () => {
    expect(parseAttempts("2.7")).toBe(2);
  });

  it("falls back to the default for anything that is not a count", () => {
    for (const raw of ["", "   ", "abc", "-1", "NaN", "1e400", "3 tries"]) {
      expect(parseAttempts(raw)).toBe(DEFAULT_MAX_ATTEMPTS);
    }
  });
});

describe("parseWindowMs", () => {
  const asMinutes = (ms: number) => ms / 60_000;

  it("reads a plain number of minutes", () => {
    expect(asMinutes(parseWindowMs("15"))).toBe(15);
    expect(asMinutes(parseWindowMs("1440"))).toBe(1440);
  });

  it("tolerates the whitespace a settings field collects", () => {
    expect(asMinutes(parseWindowMs("  90 "))).toBe(90);
  });

  it("allows a fraction of a minute, since nothing breaks on one", () => {
    expect(parseWindowMs("0.5")).toBe(30_000);
  });

  it("falls back to the default for anything that is not a positive number", () => {
    for (const raw of ["", "   ", "abc", "0", "-5", "NaN", "1e400", "12m"]) {
      expect(asMinutes(parseWindowMs(raw))).toBe(DEFAULT_WINDOW_MINUTES);
    }
  });
});

describe("recentAttempts", () => {
  it("keeps what is inside the window and drops what is not", () => {
    const attempts = [NOW - WINDOW - 1, NOW - 5000, NOW];
    expect(recentAttempts(attempts, NOW, WINDOW)).toEqual([NOW - 5000, NOW]);
  });

  it("has nothing to keep for a tab that has never been recovered", () => {
    expect(recentAttempts([], NOW, WINDOW)).toEqual([]);
  });

  it("drops an attempt from a clock that jumped forward", () => {
    // Not a real timestamp any more, and keeping it would block recovery until it
    // aged out of a window it is ahead of.
    expect(recentAttempts([NOW + WINDOW], NOW, WINDOW)).toEqual([]);
  });
});
