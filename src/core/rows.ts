/**
 * The status panel's rows: one per kept tab, saying what state it is in and what the
 * mod last saw it do. Pure — takes snapshots, renders nothing.
 *
 * This replaces the two flat summaries M05.C01 showed. Those printed every url twice,
 * once for liveness and once for sockets, keyed by a raw space id; a row per tab with
 * both readings folded in is the same information in the shape it gets read in.
 */

import { formatAge, type Sign, type SignKind } from "./liveness.ts";
import { shortUrl } from "./url.ts";

/**
 * How stale a sign has to be before a tab reads quiet rather than alive. Generous on
 * purpose: Gmail and Calendar can go a long while without changing their titles, so a
 * shorter window would call a perfectly healthy tab suspicious.
 */
export const QUIET_MS = 15 * 60 * 1000;

/** What the websocket listener has counted for one tab, if it is attached at all. */
export interface FrameCounts {
  in: number;
  out: number;
  /** Null while nothing has arrived, which is not the same as long ago. */
  lastAt: number | null;
}

export interface RowFacts {
  /** Zen's own name for the space, or a short id when that lookup failed. */
  space: string;
  url: string;
  /** Restored as a shell, i.e. asleep rather than merely quiet. */
  pending: boolean;
  last: Sign | null;
  /** Null when no listener is attached — a lazy tab has no inner window to watch. */
  frames: FrameCounts | null;
}

export type RowState = "crashed" | "asleep" | "unseen" | "quiet" | "alive";

export interface PanelRow {
  /** The url, shortened to what is worth showing. */
  title: string;
  /** The whole url, for the row's tooltip. */
  url: string;
  state: RowState;
  detail: string;
}

export interface PanelGroup {
  space: string;
  rows: PanelRow[];
}

export interface PanelReport {
  heading: string;
  groups: PanelGroup[];
}

/** Worst first: the order these want looking at in, and the heading's order too. */
const RANK: readonly RowState[] = ["crashed", "asleep", "unseen", "quiet", "alive"];

/** Plain English for the ledger's own vocabulary — see `SignKind`. */
const SIGN_WORDS: Record<SignKind, string> = {
  awake: "had a live browser",
  label: "changed its title",
  discarded: "was unloaded",
  crashed: "crashed",
  "restart-required": "crashed, and needs a browser restart",
};

/**
 * The crash outranks `pending`: `recover` resets a crashed tab to lazy before waking
 * it, so a tab mid-recovery is both, and the crash is the half worth reporting.
 */
const stateOf = (facts: RowFacts, now: number): RowState => {
  const kind = facts.last?.kind;
  if (kind === "crashed" || kind === "restart-required") {
    return "crashed";
  }
  if (facts.pending) {
    return "asleep";
  }
  if (!facts.last) {
    return "unseen";
  }
  return now - facts.last.at > QUIET_MS ? "quiet" : "alive";
};

const detailOf = (facts: RowFacts, now: number): string => {
  const parts: string[] = [];
  parts.push(
    facts.last
      ? `${SIGN_WORDS[facts.last.kind]} ${formatAge(now - facts.last.at)}`
      : "nothing seen yet",
  );

  const frames = facts.frames;
  if (!frames) {
    // Silent for a sleeping tab: there is no inner window to attach to, so this is
    // the expected state rather than a fault. For an awake one the attach failed.
    if (!facts.pending) {
      parts.push("not watching its websockets");
    }
  } else if (frames.in + frames.out === 0) {
    parts.push("no frames yet");
  } else {
    const age = frames.lastAt === null ? "" : `, last ${formatAge(now - frames.lastAt)}`;
    parts.push(`${frames.in} in, ${frames.out} out${age}`);
  }

  return parts.join(" · ");
};

const rowOf = (facts: RowFacts, now: number): PanelRow => ({
  // A url the mod could not resolve still has to occupy a row, or the tab silently
  // vanishes from a panel whose whole job is saying what is kept.
  title: shortUrl(facts.url) || "(url unknown)",
  url: facts.url,
  state: stateOf(facts, now),
  detail: detailOf(facts, now),
});

const byConcern = (a: PanelRow, b: PanelRow) =>
  RANK.indexOf(a.state) - RANK.indexOf(b.state);

export function panelReport(facts: readonly RowFacts[], now: number): PanelReport {
  if (!facts.length) {
    return { heading: "nothing kept", groups: [] };
  }

  // Insertion-ordered, so spaces appear in the order `pinnedTabs` walked them, which
  // is the order they are in the sidebar.
  const groups = new Map<string, PanelRow[]>();
  const counts = new Map<RowState, number>();
  for (const item of facts) {
    const row = rowOf(item, now);
    const rows = groups.get(item.space);
    if (rows) {
      rows.push(row);
    } else {
      groups.set(item.space, [row]);
    }
    counts.set(row.state, (counts.get(row.state) ?? 0) + 1);
  }

  const tally = RANK.filter(state => counts.get(state)).map(
    state => `${counts.get(state)} ${state}`,
  );

  return {
    heading: `${facts.length} kept — ${tally.join(", ")}`,
    groups: [...groups].map(([space, rows]) => ({
      space,
      rows: [...rows].sort(byConcern),
    })),
  };
}
