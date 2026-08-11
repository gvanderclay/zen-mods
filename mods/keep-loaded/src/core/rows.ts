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
  recovery: {
    /** This exact window controller is currently recovering this exact tab. */
    active: boolean;
    attempts: number;
    maxAttempts: number;
  };
}

export type RowState = "crashed" | "asleep" | "unseen" | "quiet" | "alive";

export interface PanelRow {
  /** The url, shortened to what is worth showing. */
  title: string;
  /** The whole url, for the row's tooltip. */
  url: string;
  state: RowState;
  stateLabel: "Awake" | "Crashed" | "No signal yet" | "Quiet" | "Sleeping";
  detail: string;
}

export interface PanelGroup {
  space: string;
  rows: PanelRow[];
}

export interface PanelReport {
  total: string;
  summary: string;
  groups: PanelGroup[];
}

/** Worst first: the order these want looking at in, and the heading's order too. */
const RANK: readonly RowState[] = ["crashed", "asleep", "unseen", "quiet", "alive"];

const STATE_LABEL: Record<RowState, PanelRow["stateLabel"]> = {
  alive: "Awake",
  asleep: "Sleeping",
  crashed: "Crashed",
  quiet: "Quiet",
  unseen: "No signal yet",
};

const SUMMARY: Record<RowState, (count: number) => string> = {
  alive: count => `${count} awake`,
  asleep: count => `${count} sleeping`,
  crashed: count => `${count} ${count === 1 ? "needs" : "need"} attention`,
  quiet: count => `${count} quiet`,
  unseen: count => `${count} awaiting signal`,
};

/** Plain English for the ledger's own vocabulary — see `SignKind`. */
const SIGN_WORDS: Record<SignKind, string> = {
  awake: "Live browser",
  label: "Title changed",
  discarded: "Unloaded",
  crashed: "Crashed",
  "restart-required": "Restart required",
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
  if (facts.last?.kind === "restart-required") {
    return "Restart Zen to recover this tab";
  }
  if (facts.last?.kind === "crashed") {
    const { active, attempts, maxAttempts } = facts.recovery;
    if (maxAttempts === 0) {
      return "Automatic recovery is off";
    }
    if (attempts >= maxAttempts) {
      return `Recovery limit reached · ${attempts} of ${maxAttempts} attempts used`;
    }
    if (active) {
      return `Recovering · attempt ${Math.max(1, attempts)} of ${maxAttempts}`;
    }
  }
  const parts: string[] = [];
  parts.push(
    facts.last
      ? `${SIGN_WORDS[facts.last.kind]} ${formatAge(now - facts.last.at)}`
      : "No sign yet",
  );

  const frames = facts.frames;
  if (!frames) {
    // Silent for a sleeping tab: there is no inner window to attach to, so this is
    // the expected state rather than a fault. For an awake one the attach failed.
    if (!facts.pending) {
      parts.push("WebSocket status unavailable");
    }
  } else if (frames.in + frames.out > 0) {
    const age = frames.lastAt === null ? "recently" : formatAge(now - frames.lastAt);
    parts.push(`WebSocket activity ${age}`);
  }

  return parts.join(" · ");
};

const rowOf = (facts: RowFacts, now: number): PanelRow => {
  const state = stateOf(facts, now);
  return {
    // A url the mod could not resolve still has to occupy a row, or the tab silently
    // vanishes from a panel whose whole job is saying what is kept.
    title: shortUrl(facts.url) || "(url unknown)",
    url: facts.url,
    state,
    stateLabel: STATE_LABEL[state],
    detail: detailOf(facts, now),
  };
};

const byConcern = (a: PanelRow, b: PanelRow) =>
  RANK.indexOf(a.state) - RANK.indexOf(b.state);

export function panelReport(facts: readonly RowFacts[], now: number): PanelReport {
  if (!facts.length) {
    return {
      total: "Keep a pinned tab awake",
      summary: "Add sites in Sine settings, or use Keep loaded in a pinned tab’s menu.",
      groups: [],
    };
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

  const tally = RANK.filter(state => counts.get(state)).map(state =>
    SUMMARY[state](counts.get(state) ?? 0),
  );

  return {
    total: `${facts.length} kept ${facts.length === 1 ? "tab" : "tabs"}`,
    summary: tally.join(" · "),
    groups: [...groups].map(([space, rows]) => ({
      space,
      rows: [...rows].sort(byConcern),
    })),
  };
}
