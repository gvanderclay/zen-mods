import type { DuplicatePlan } from "../core/duplicates.ts";
import { planDuplicates } from "../core/duplicates.ts";
import {
  buildCloseReview,
  type CloseReviewScope,
  type CloseReviewSnapshot,
} from "../core/review.ts";
import {
  type DuplicateSnapshot,
  enclosingZenFolder,
  snapshotDuplicateTabs,
  tabLaneId,
} from "./snapshot.ts";

type CurrentCloseReviewRequest =
  | { scope: Extract<CloseReviewScope, "space">; allowPinnedClose: boolean }
  | {
      scope: Extract<CloseReviewScope, "folder">;
      laneId: string;
      allowPinnedClose: boolean;
    };

const nonEmpty = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

// Verified: `tab.js` 104–105 and `ZenFolders.mjs` 267–271 expose these labels.
export const tabReviewLabel = (tab: BrowserTab) => ({
  title: nonEmpty(tab.label) ?? "Untitled tab",
  laneLabel:
    nonEmpty(enclosingZenFolder(tab)?.label) ??
    (tab.pinned || tab.hasAttribute("zen-essential") ? "Pinned tabs" : "Other tabs"),
});

const scopedPlan = (plan: DuplicatePlan, laneId?: string): DuplicatePlan => {
  const clusters = laneId
    ? plan.clusters.filter(cluster => cluster.identity.laneId === laneId)
    : plan.clusters;
  return {
    clusters,
    ordinaryCandidateIds: clusters.flatMap(cluster => cluster.ordinaryCandidateIds),
    pinnedCandidateIds: clusters.flatMap(cluster => cluster.pinnedCandidateIds),
    protectedDuplicateIds: clusters.flatMap(cluster => cluster.protectedDuplicateIds),
    moves: [],
    laneOrders: [],
  };
};

const liveCandidate = (
  tab: BrowserTab | undefined,
  laneId: string,
  pinned: boolean,
): tab is BrowserTab =>
  Boolean(
    tab &&
      tab.pinned === pinned &&
      !tab.hasAttribute("zen-essential") &&
      tabLaneId(tab) === laneId,
  );

export const buildCurrentCloseReview = (
  request: CurrentCloseReviewRequest,
  snapshot: DuplicateSnapshot = snapshotDuplicateTabs(),
): CloseReviewSnapshot<BrowserTab> => {
  const plan = scopedPlan(
    planDuplicates(snapshot.facts, { includePinned: true }),
    request.scope === "folder" ? request.laneId : undefined,
  );
  const labels = new Map(
    plan.clusters.flatMap(cluster =>
      cluster.tabIds.flatMap(id => {
        const tab = snapshot.tabsById.get(id);
        return tab ? [[id, tabReviewLabel(tab)] as const] : [];
      }),
    ),
  );
  const review = buildCloseReview({
    scope: request.scope,
    plan,
    facts: snapshot.facts,
    labels,
    allowPinnedClose: request.allowPinnedClose,
  });
  const candidatesById = new Map<string, BrowserTab>();
  for (const cluster of plan.clusters) {
    for (const id of cluster.ordinaryCandidateIds) {
      const tab = snapshot.tabsById.get(id);
      if (liveCandidate(tab, cluster.identity.laneId, false)) {
        candidatesById.set(id, tab);
      }
    }
    for (const id of cluster.pinnedCandidateIds) {
      const tab = snapshot.tabsById.get(id);
      if (liveCandidate(tab, cluster.identity.laneId, true)) {
        candidatesById.set(id, tab);
      }
    }
  }
  return { review, candidatesById };
};
