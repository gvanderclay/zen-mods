/**
 * Whether to run a kept tab's page while the tab is unselected — and, the half that
 * matters more, when to stop.
 *
 * Why this exists: a stale tab title is not a stale label. A background tab's `label`
 * always equals its own `contentTitle`, and a pushed title reaches it within a second.
 * What goes quiet is the page. An unselected tab's browser carries
 * `docShellIsActive = false` (`tabbrowser.js` 1800 on the tab switched away from, 3111
 * for a browser this mod has just inserted), which suspends `requestAnimationFrame`,
 * clamps timers to one per second, and reports `visibilityState: "hidden"` — so an app
 * that defers refreshing while hidden stops retitling itself, and no amount of
 * parent-process work can reach that decision. Measured: 0.2 animation frames a second
 * against 121.6, and a title that resumes climbing the moment the flag is flipped back
 * (D026).
 *
 * Flipping it back is one assignment, and it is not free: the page paints again, at
 * roughly the display's refresh rate, for as long as it is held. So this decides a
 * *pulse* — activate briefly, then let go — which bounds staleness to the interval
 * instead of eliminating it, at a duty cycle the settings choose.
 *
 * Pure: decides, touches nothing. The flip itself is in `platform/browser.ts`.
 *
 * The rule that shapes everything below: never deactivate a docshell this mod did not
 * activate. `shouldActivateDocShell` (`tabbrowser.js` 8307) lists everyone else who
 * legitimately holds one — the selected browser, print preview, picture-in-picture, and
 * Zen's split view (which sets it directly at 3831) — and releasing on their behalf
 * would freeze a page somebody is looking at.
 */

import { DEFAULT_FRESHEN_HOLD_SECONDS, DEFAULT_FRESHEN_SECONDS } from "./defaults.ts";

const SECOND_MS = 1000;

/** Seconds between pulses when the setting says nothing usable. Zero, i.e. off. */
export const DEFAULT_PULSE_SECONDS = Number(DEFAULT_FRESHEN_SECONDS);

/** Seconds one pulse lasts when the setting says nothing usable. */
export const DEFAULT_HOLD_SECONDS = Number(DEFAULT_FRESHEN_HOLD_SECONDS);

export interface PulseSettings {
  /** How often each kept tab's page is run. Zero means never, and is the default. */
  everyMs: number;
  /** How long one run lasts. Never longer than `everyMs`. */
  holdMs: number;
}

/**
 * Reads one of the two settings, which are in seconds because that is what a text
 * field can express without a unit. `allowZero` is the difference between the two: an
 * interval of zero is the documented off switch, while a hold of zero would activate a
 * docshell and give it back before the page noticed, so it falls back instead.
 */
const secondsMs = (raw: string, fallbackSeconds: number, allowZero: boolean): number => {
  const value = Number(raw.trim());
  const usable =
    raw.trim() !== "" && Number.isFinite(value) && value >= 0 && (allowZero || value > 0);
  return (usable ? value : fallbackSeconds) * SECOND_MS;
};

/**
 * The hold is clamped to the interval rather than rejected: a hold longer than the gap
 * between pulses is a request to hold the tab permanently, and honouring it literally
 * would have one pulse still running when the next fell due.
 */
export function parsePulseSettings(rawEvery: string, rawHold: string): PulseSettings {
  const everyMs = secondsMs(rawEvery, DEFAULT_PULSE_SECONDS, true);
  const holdMs = secondsMs(rawHold, DEFAULT_HOLD_SECONDS, false);
  return { everyMs, holdMs: everyMs > 0 ? Math.min(holdMs, everyMs) : holdMs };
}

export const isPulsing = (settings: PulseSettings) => settings.everyMs > 0;

/** Snapshot of one pinned tab, plus what this mod has already done to it. */
export interface PulseFacts {
  url: string;
  /** Whether the mod keeps this tab. A merely-pinned tab is not ours to run. */
  kept: boolean;
  /** Restored as a shell: there is no page to keep running. */
  pending: boolean;
  selected: boolean;
  /** `docShellIsActive` as read now, by whoever set it. */
  active: boolean;
  /** When this mod activated it, or null if this mod is not holding it. */
  heldSince: number | null;
  /** When this mod last activated it, held or not. Null if it never has. */
  lastPulseAt: number | null;
}

/**
 * `forget` is the one that is easy to miss: drop the claim without writing anything,
 * because the docshell is no longer ours to give back.
 */
export type PulseAction = "activate" | "release" | "forget" | "skip";

export interface PulseStep {
  action: PulseAction;
  /** Logged as-is: the one line explaining why the mod did or did not act. */
  reason: string;
}

const asSeconds = (ms: number) => `${Math.round(ms / SECOND_MS)}s`;

export function pulseStep(
  facts: PulseFacts,
  settings: PulseSettings,
  now: number,
): PulseStep {
  const { kept, pending, selected, active, heldSince, lastPulseAt } = facts;
  const { everyMs, holdMs } = settings;

  if (heldSince !== null) {
    // Both of these come first because both mean the flag is no longer ours, and
    // writing `false` over either would deactivate a docshell somebody else owns.
    if (selected) {
      return { action: "forget", reason: "selected, so its docshell is the browser's" };
    }
    if (!active) {
      return {
        action: "forget",
        reason: "something else deactivated it — nothing left to release",
      };
    }
    if (!isPulsing(settings)) {
      return { action: "release", reason: "freshening is turned off" };
    }
    // Before it stops being iterated at all: a tab released from the allowlist while
    // held would otherwise keep painting for the rest of the session.
    if (!kept) {
      return { action: "release", reason: "no longer kept" };
    }
    const heldFor = now - heldSince;
    // A hold that started in the future is a clock that went backwards, and waiting
    // for real time to catch up is the staleness this exists to bound.
    if (heldFor < 0 || heldFor >= holdMs) {
      return { action: "release", reason: `its ${asSeconds(holdMs)} pulse is up` };
    }
    return { action: "skip", reason: "still inside its pulse" };
  }

  if (!isPulsing(settings)) {
    return { action: "skip", reason: "freshening is turned off" };
  }
  if (!kept) {
    return { action: "skip", reason: "not a tab the mod keeps" };
  }
  if (pending) {
    return { action: "skip", reason: "asleep, so it has no page to keep running" };
  }
  if (selected) {
    return { action: "skip", reason: "selected, so its page is already running" };
  }
  if (active) {
    return { action: "skip", reason: "its docshell is already active, and not by us" };
  }
  const since = lastPulseAt === null ? everyMs : now - lastPulseAt;
  if (since >= 0 && since < everyMs) {
    return {
      action: "skip",
      reason: `not due for another ${asSeconds(everyMs - since)}`,
    };
  }
  return { action: "activate", reason: `running its page for ${asSeconds(holdMs)}` };
}

export interface PulseOutcome {
  url: string;
  step: PulseStep;
}

/** Only the actions worth a count. `skip` is every quiet tick and is never reported. */
const COUNTED: ReadonlyArray<[PulseAction, string]> = [
  ["activate", "activated"],
  ["release", "released"],
  ["forget", "let go of"],
];

/**
 * One line for a tick that did something, and nothing at all for one that did not —
 * this runs every second while pulsing is on, so a report per tick would bury the log.
 */
export function pulseSummary(
  outcomes: readonly PulseOutcome[],
): { message: string; lines: string[] } | null {
  const acted = outcomes.filter(item => item.step.action !== "skip");
  if (!acted.length) {
    return null;
  }
  const parts = COUNTED.flatMap(([action, word]) => {
    const count = acted.filter(item => item.step.action === action).length;
    return count ? [`${word} ${count}`] : [];
  });
  return {
    message: `freshness: ${parts.join(", ")}`,
    lines: acted.map(item => `${item.url}: ${item.step.reason}`),
  };
}
