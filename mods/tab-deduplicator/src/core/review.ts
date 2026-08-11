import type {
  DuplicateClusterPlan,
  DuplicatePlan,
  DuplicateTabFacts,
} from "./duplicates.ts";

export type CloseReviewScope = "folder" | "space";
export type CloseReviewRowState = "keeping" | "closing" | "pinned-choice" | "protected";

export interface CloseReviewLabel {
  title: string;
  laneLabel: string;
}

export interface CloseReviewRow {
  id: string;
  title: string;
  state: CloseReviewRowState;
  pinned: boolean;
  essential: boolean;
}

export interface CloseReviewGroup {
  key: string;
  url: string;
  containerId: number;
  laneLabel: string;
  rows: CloseReviewRow[];
}

export interface CloseReview {
  scope: CloseReviewScope;
  groups: CloseReviewGroup[];
  ordinaryCount: number;
  pinnedChoiceCount: number;
  stayingCount: number;
}

export type CloseReviewDecision =
  | { kind: "cancel" }
  | { kind: "confirm"; includePinned: boolean };

interface BuildCloseReviewOptions {
  scope: CloseReviewScope;
  plan: DuplicatePlan;
  facts: readonly DuplicateTabFacts[];
  labels: ReadonlyMap<string, CloseReviewLabel>;
  allowPinnedClose: boolean;
}

const defaultLaneLabel = (laneId: string) => {
  if (laneId.startsWith("folder:")) {
    return "Folder";
  }
  return laneId === "top-level-pinned" ? "Pinned tabs" : "Other tabs";
};

const clusterKey = ({ identity }: DuplicateClusterPlan) =>
  [identity.spaceId, identity.laneId, identity.containerId, identity.url].join("\0");

export const buildCloseReview = ({
  scope,
  plan,
  facts,
  labels,
  allowPinnedClose,
}: BuildCloseReviewOptions): CloseReview => {
  const factsById = new Map(facts.map(item => [item.id, item]));
  const groups = plan.clusters.map(cluster => {
    const ordinary = new Set(cluster.ordinaryCandidateIds);
    const pinned = new Set(cluster.pinnedCandidateIds);
    const protectedIds = new Set(cluster.protectedDuplicateIds);
    const firstLabel = cluster.tabIds
      .map(id => labels.get(id)?.laneLabel)
      .find(label => label && label.length > 0);
    const rows = cluster.tabIds.map(id => {
      const fact = factsById.get(id);
      const label = labels.get(id);
      let state: CloseReviewRowState = "keeping";
      if (ordinary.has(id)) {
        state = "closing";
      } else if (pinned.has(id)) {
        state = allowPinnedClose ? "pinned-choice" : "protected";
      } else if (protectedIds.has(id)) {
        state = "protected";
      }
      return {
        id,
        title: label?.title || cluster.identity.url,
        state,
        pinned: fact?.pinned ?? pinned.has(id),
        essential: fact?.essential ?? false,
      };
    });
    return {
      key: clusterKey(cluster),
      url: cluster.identity.url,
      containerId: cluster.identity.containerId,
      laneLabel: firstLabel || defaultLaneLabel(cluster.identity.laneId),
      rows,
    };
  });
  const rows = groups.flatMap(group => group.rows);
  const ordinaryCount = rows.filter(row => row.state === "closing").length;
  const pinnedChoiceCount = rows.filter(row => row.state === "pinned-choice").length;
  return {
    scope,
    groups,
    ordinaryCount,
    pinnedChoiceCount,
    stayingCount: rows.length - ordinaryCount,
  };
};

export const closeIdsForReview = (review: CloseReview, decision: CloseReviewDecision) => {
  if (decision.kind === "cancel") {
    return [];
  }
  return review.groups.flatMap(group =>
    group.rows
      .filter(
        row =>
          row.state === "closing" ||
          (decision.includePinned && row.state === "pinned-choice"),
      )
      .map(row => row.id),
  );
};

export const closeReviewSignature = (review: CloseReview) =>
  JSON.stringify({
    scope: review.scope,
    groups: review.groups.map(group => ({
      key: group.key,
      rows: group.rows.map(row => [row.id, row.state]),
    })),
  });

export interface CloseReviewSnapshot<Candidate> {
  review: CloseReview;
  candidatesById: ReadonlyMap<string, Candidate>;
}

interface RunCloseReviewOptions<Candidate> {
  initial: CloseReviewSnapshot<Candidate>;
  refresh: () => CloseReviewSnapshot<Candidate>;
  present: (
    review: CloseReview,
    status: { changed: boolean },
  ) => Promise<CloseReviewDecision>;
  close: (candidates: Candidate[]) => void;
  isLive: () => boolean;
}

export const runCloseReview = async <Candidate>({
  initial,
  refresh,
  present,
  close,
  isLive,
}: RunCloseReviewOptions<Candidate>) => {
  let shown = initial;
  let changed = false;
  while (isLive()) {
    const decision = await present(shown.review, { changed });
    if (!isLive() || decision.kind === "cancel") {
      return false;
    }
    const fresh = refresh();
    if (closeReviewSignature(fresh.review) !== closeReviewSignature(shown.review)) {
      shown = fresh;
      changed = true;
      continue;
    }
    const ids = closeIdsForReview(fresh.review, decision);
    const candidates = ids.flatMap(id => {
      const candidate = fresh.candidatesById.get(id);
      return candidate === undefined ? [] : [candidate];
    });
    if (ids.length === 0 || candidates.length !== ids.length) {
      return false;
    }
    close(candidates);
    return true;
  }
  return false;
};
