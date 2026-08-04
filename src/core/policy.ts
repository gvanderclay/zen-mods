/**
 * What to keep awake, and what to say about it. Pure — takes snapshots, never tabs.
 */

import { matchesAllowlist } from "./match.ts";

/** Everything the policy needs to know about one pinned tab. */
export interface TabFacts {
  /** Short space id, for logging only. */
  space: string;
  url: string;
  /** Restored as a shell, i.e. carrying the `pending` attribute. */
  pending: boolean;
  /** Kept individually, regardless of the allowlist. */
  flagged: boolean;
}

export function shouldKeep(facts: TabFacts, matchers: readonly string[]): boolean {
  return facts.flagged || matchesAllowlist(facts.url, matchers);
}

/** The startup log line, plus one `space url` entry per kept tab. */
export function sweepSummary(
  pinned: readonly TabFacts[],
  kept: readonly TabFacts[],
): { message: string; kept: string[] } {
  const spaces = new Set(pinned.map(facts => facts.space)).size;
  return {
    message: `${pinned.length} pinned tab(s) across ${spaces} space(s), ${kept.length} matched`,
    kept: kept.map(facts => `${facts.space} ${facts.url}`),
  };
}

/** The post-wake line. Names the tabs that never came back, if any did not. */
export function wakeSummary(total: number, stuckUrls: readonly string[]): string {
  if (!stuckUrls.length) {
    return `woke ${total} tab(s)`;
  }
  return `${total - stuckUrls.length}/${total} woke, still pending: ${stuckUrls.join(",")}`;
}
