/** Keeping a pinned tab's strip label in step with its page. */

import {
  type LabelOutcome,
  type LabelStep,
  labelStep,
  labelSummary,
} from "./core/labels.ts";
import { shouldKeep, type TabFacts } from "./core/policy.ts";
import { factsFor, isPending } from "./platform/browser.ts";
import {
  isLabelManaged,
  isRenamed,
  pageTitle,
  tabLabel,
  writeLabelFromPage,
} from "./platform/label.ts";
import { logLazy } from "./platform/log.ts";
import type { PreferencesPort } from "./platform/prefs.ts";
import { pinnedWithVerdict, type VerdictCandidate } from "./tab-inventory.ts";

export const createTabLabels = (settings: PreferencesPort) => {
  /** Reports what landed: `setTabTitle` returns false for a refusal and a no-op alike. */
  interface LabelState {
    readonly managed: boolean;
    readonly pending: boolean;
    readonly renamed: boolean;
  }

  const relabel = (
    tab: BrowserTab,
    facts: TabFacts,
    kept: boolean,
    state: LabelState = {
      managed: isLabelManaged(tab),
      pending: facts.pending,
      renamed: isRenamed(tab),
    },
  ): LabelStep => {
    const step = labelStep({
      url: facts.url,
      kept,
      pending: state.pending,
      title: pageTitle(tab),
      label: tabLabel(tab),
      renamed: state.renamed,
      managed: state.managed,
    });
    if (step.action !== "write") {
      return step;
    }
    return writeLabelFromPage(tab)
      ? step
      : { action: "skip", reason: "its label refused to change" };
  };

  /** Every pinned tab at once: the startup case, where no event is coming. */
  const relabelAll = (
    candidates: readonly VerdictCandidate[] = pinnedWithVerdict(settings),
  ) => {
    const outcomes: LabelOutcome[] = candidates.map(({ tab, facts, kept }) => ({
      url: facts.url,
      step: relabel(tab, facts, kept),
    }));
    logLazy(() => {
      const report = labelSummary(outcomes);
      return report ? [report.message, report.lines] : null;
    });
  };

  /** The per-title-change path, deliberately silent: the tab strip is the evidence. */
  const relabelOne = (tab: BrowserTab) => {
    // Plain tab properties first: the rejected path collects no facts.
    if (!tab.pinned) {
      return;
    }
    try {
      const state = {
        managed: isLabelManaged(tab),
        pending: isPending(tab),
        renamed: isRenamed(tab),
      };
      if (state.pending || state.renamed || state.managed) {
        return;
      }
      const facts = factsFor(tab, state.pending);
      relabel(tab, facts, shouldKeep(facts, settings.snapshot().match), state);
    } catch (error) {
      console.error("[keep-loaded] could not bring a tab's title up to date", error);
    }
  };

  return { relabelAll, relabelOne };
};
