/**
 * Bookkeeping for whether a kept tab is still alive. Pure: takes records, decides
 * nothing. Acting on what it reports is M04.C02 onwards — see D016.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/**
 * How we last saw the tab. `label` is the strong one: the page changed its own
 * title, so its JS ran. `awake` only means the tab had a live browser when a sweep
 * looked, which a wedged page also satisfies.
 */
export type SignKind = "awake" | "label" | "discarded" | "crashed";

export interface Sign {
  kind: SignKind;
  at: number;
}

export interface LivenessRecord {
  /** Short space id, for logging only. */
  space: string;
  url: string;
  /** Null when the tab has shown nothing since the mod started watching. */
  last: Sign | null;
}

/** Coarse on purpose: this is for reading in a log, not for arithmetic. */
export function formatAge(ms: number): string {
  if (ms < SECOND) {
    // Also covers a clock that went backwards, which "-5s ago" would not.
    return "just now";
  }
  if (ms < MINUTE) {
    return `${Math.floor(ms / SECOND)}s ago`;
  }
  if (ms < HOUR) {
    return `${Math.floor(ms / MINUTE)}m ago`;
  }
  return `${Math.floor(ms / HOUR)}h ago`;
}

/** The tabs worth worrying about first: never seen, then longest unseen. */
const byConcern = (a: LivenessRecord, b: LivenessRecord) => {
  if (!a.last || !b.last) {
    return (a.last ? 1 : 0) - (b.last ? 1 : 0);
  }
  return a.last.at - b.last.at;
};

export function livenessSummary(
  records: readonly LivenessRecord[],
  now: number,
): { message: string; lines: string[] } {
  if (!records.length) {
    return { message: "liveness: nothing kept", lines: [] };
  }

  const sorted = [...records].sort(byConcern);
  const seen = sorted.filter(item => item.last);
  const unseen = sorted.length - seen.length;

  const parts = [`${sorted.length} kept`];
  if (seen[0]?.last) {
    parts.push(`oldest sign ${formatAge(now - seen[0].last.at)}`);
  }
  if (unseen) {
    parts.push(`${unseen} with no sign yet`);
  }

  return {
    message: `liveness: ${parts.join(", ")}`,
    lines: sorted.map(item =>
      item.last
        ? `${item.space} ${item.url} ${item.last.kind} ${formatAge(now - item.last.at)}`
        : `${item.space} ${item.url} no sign yet`,
    ),
  };
}
