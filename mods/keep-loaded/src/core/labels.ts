/**
 * Whether a kept tab's label should be rewritten from its page. Pure — no browser, no
 * prefs, no globals.
 *
 * A restored pinned tab cannot change its own label: `_setTabLabel` (`tabbrowser.js`
 * 2423) refuses every write for a tab without `_zenContentsVisible`, and Zen's restore
 * path (`ZenWindowSync.sys.mjs` 313) grants that flag to everything *except* pinned tabs
 * while window sync is on. So the page can retitle as often as it likes and the tab strip
 * keeps whatever it was showing when the session came back — which is the stale title,
 * and it is a separate fault from the page going quiet (D026, D028).
 *
 * Two of the guards below are the whole reason this is a decision rather than a one-liner:
 * a tab the user renamed carries `zenStaticLabel`, which Zen honours above everything, and
 * a tab Zen is already managing needs no help from this mod. Neither should be written to
 * at all.
 */

export interface LabelFacts {
  url: string;
  kept: boolean;
  /** Restored as a shell: there is no page to take a title from. */
  pending: boolean;
  /** What the page calls itself, i.e. `contentTitle`. */
  title: string;
  /** What the tab strip is showing. */
  label: string;
  /** The user renamed this tab, so `zenStaticLabel` holds the name they chose. */
  renamed: boolean;
  /** Zen granted this tab `_zenContentsVisible`, so its labels are already flowing. */
  managed: boolean;
}

export type LabelAction = "write" | "skip";

export interface LabelStep {
  action: LabelAction;
  reason: string;
}

/**
 * Decides in the order the reasons matter, so the log names the reason a reader would
 * care about first: whose tab it is, then whether there is anything to read, then
 * whether there is anything to do.
 */
export function labelStep(facts: LabelFacts): LabelStep {
  if (!facts.kept) {
    return { action: "skip", reason: "not a tab the mod keeps" };
  }
  if (facts.pending) {
    return { action: "skip", reason: "asleep, so it has no page to take a title from" };
  }
  if (facts.renamed) {
    return { action: "skip", reason: "renamed by hand, so its label is not the page's" };
  }
  if (facts.managed) {
    return { action: "skip", reason: "Zen is keeping its label up to date already" };
  }
  const title = facts.title.trim();
  if (!title) {
    return { action: "skip", reason: "its page has no title yet" };
  }
  // Trimmed on both sides because `_setTabLabel` writes a tidied label and this compares
  // against the raw `contentTitle`: untrimmed, a title with a stray space would be
  // rewritten on every pass, and every pass would claim it had changed something.
  if (title === facts.label.trim()) {
    return { action: "skip", reason: "its label already matches its page" };
  }
  return { action: "write", reason: "its label is behind its page" };
}

export interface LabelOutcome {
  url: string;
  step: LabelStep;
}

/** Null when nothing was written, so a quiet pass logs nothing at all. */
export function labelSummary(
  outcomes: readonly LabelOutcome[],
): { message: string; lines: string[] } | null {
  const written = outcomes.filter(outcome => outcome.step.action === "write");
  if (!written.length) {
    return null;
  }
  return {
    message: `titles: ${written.length} relabelled`,
    lines: written.map(outcome => `${outcome.url}: ${outcome.step.reason}`),
  };
}
