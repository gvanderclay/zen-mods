/**
 * What to do about a kept tab whose content process died. Pure: decides, acts on
 * nothing. The sequence each action names is carried out in `src/platform` — see
 * D018.
 */

import type { CrashFacts } from "./crash.ts";
import { DEFAULT_CRASH_ATTEMPTS, DEFAULT_CRASH_WINDOW } from "./defaults.ts";

/**
 * How many recoveries a tab gets inside the window when the setting says nothing
 * usable. A site that crashes on every load — an OOM loop is the realistic case —
 * would otherwise be re-woken forever, and each attempt costs a process launch.
 */
export const DEFAULT_MAX_ATTEMPTS = Number(DEFAULT_CRASH_ATTEMPTS);

/**
 * How far back the budget looks when the setting says nothing usable. Three crashes
 * in an hour is a loop worth giving up on; three crashes spread over a day is a tab
 * having a bad day, and it still gets recovered.
 */
export const DEFAULT_WINDOW_MINUTES = Number(DEFAULT_CRASH_WINDOW);

const MINUTE_MS = 60_000;

/**
 * Reads the window setting, which is minutes because that is what a text field can
 * express without a unit. Anything that is not a positive finite number falls back to
 * the default rather than being clamped: a window of zero would age every attempt out
 * instantly and turn the budget off, which is the one outcome the budget exists to
 * prevent.
 */
export function parseWindowMs(raw: string): number {
  const minutes = Number(raw.trim());
  if (!Number.isFinite(minutes) || minutes <= 0 || raw.trim() === "") {
    return DEFAULT_WINDOW_MINUTES * MINUTE_MS;
  }
  return minutes * MINUTE_MS;
}

/**
 * Reads the attempt-limit setting. Zero is kept, not rejected: it is the documented
 * way to turn recovery off and keep the crash reporting, and unlike a zero window it
 * fails safe. A fraction is floored so the number the log names is the number the
 * budget used; anything that is not a count at all falls back to the default.
 */
export function parseAttempts(raw: string): number {
  const count = Number(raw.trim());
  if (!Number.isFinite(count) || count < 0 || raw.trim() === "") {
    return DEFAULT_MAX_ATTEMPTS;
  }
  return Math.floor(count);
}

/**
 * The attempts that still count against the budget, oldest first. Also drops any
 * timestamp in the future: a clock that jumped forward would otherwise block
 * recovery until real time caught up with it.
 */
export function recentAttempts(
  attempts: readonly number[],
  now: number,
  windowMs: number,
): number[] {
  return attempts.filter(at => at > now - windowMs && at <= now);
}

/** Everything the budget is judged against, gathered by the caller that has a clock. */
export interface Budget {
  /** When this tab was recovered before, in ms since the epoch. */
  attempts: readonly number[];
  now: number;
  windowMs: number;
  /** Recoveries allowed inside the window. Zero means recovery is off. */
  maxAttempts: number;
}

/**
 * `wake` is the D002 path on its own: insert the browser and let SessionStore
 * restore it. `reset-then-wake` has to return the tab to a lazy state first,
 * because a revived crashed tab keeps its browser attached and non-remote, which
 * `_mayDiscardBrowser` refuses.
 */
export type RecoveryAction = "wake" | "reset-then-wake" | "skip";

export interface RecoveryPlan {
  action: RecoveryAction;
  /** Logged as-is: the one line explaining why the mod did or did not act. */
  reason: string;
}

export function recoveryPlan(facts: CrashFacts, budget: Budget): RecoveryPlan {
  const { attempts, now, windowMs, maxAttempts } = budget;
  // First, because it is the whole answer: the crash has already been reported on
  // its own line, so nothing more specific is lost by stopping here.
  if (maxAttempts <= 0) {
    return { action: "skip", reason: "crash recovery is turned off in the settings" };
  }
  if (facts.kind === "restart-required") {
    return { action: "skip", reason: "not recoverable until Zen restarts" };
  }
  // Both mean the crash was handled in the foreground: SessionStore only revives a
  // background crash, and only the foreground path displays the page. A selected tab
  // is refused by `_mayDiscardBrowser` anyway, and the user is looking at it.
  if (facts.crashedPage) {
    return { action: "skip", reason: "already showing its crash page" };
  }
  if (!facts.pending) {
    return { action: "skip", reason: "not revived, so it has no state to restore" };
  }
  if (recentAttempts(attempts, now, windowMs).length >= maxAttempts) {
    return {
      action: "skip",
      // Both numbers come from the settings, so both are named: a line saying only
      // "already recovered" cannot be checked against what was configured.
      reason: `already recovered ${maxAttempts} time(s) in the last ${windowMs / MINUTE_MS} minute(s)`,
    };
  }
  if (!facts.connected) {
    return { action: "wake", reason: "browser already detached, so inserting it" };
  }
  return {
    action: "reset-then-wake",
    reason: "browser attached and non-remote, so flipping remoteness and discarding",
  };
}
