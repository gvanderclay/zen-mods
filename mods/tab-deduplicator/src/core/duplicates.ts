export interface DuplicateTabFacts {
  id: string;
  currentUrl: string | null;
  pinnedUrl: string | null;
  containerId: number;
  spaceId: string;
  laneId: string;
  pinned: boolean;
  essential: boolean;
  lastSeenActive: number;
  position: number;
}

export interface DuplicateIdentity {
  url: string;
  containerId: number;
  spaceId: string;
  laneId: string;
}

export interface DuplicateClusterPlan {
  identity: DuplicateIdentity;
  tabIds: string[];
  keeperId: string;
  ordinaryCandidateIds: string[];
  pinnedCandidateIds: string[];
  protectedDuplicateIds: string[];
}

export interface DuplicateMove {
  tabId: string;
  afterTabId: string;
  laneId: string;
}

export interface PlannedLaneOrder {
  spaceId: string;
  laneId: string;
  tabIds: string[];
}

export interface DuplicatePlan {
  clusters: DuplicateClusterPlan[];
  ordinaryCandidateIds: string[];
  pinnedCandidateIds: string[];
  protectedDuplicateIds: string[];
  moves: DuplicateMove[];
  laneOrders: PlannedLaneOrder[];
}

export interface DuplicatePlanOptions {
  includePinned?: boolean;
}

interface Lane {
  spaceId: string;
  laneId: string;
  tabs: DuplicateTabFacts[];
}

const compareText = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0;

const normalizedPosition = (position: number) =>
  Number.isFinite(position) ? position : Number.POSITIVE_INFINITY;

const normalizedRecency = (lastSeenActive: number) =>
  Number.isFinite(lastSeenActive) ? lastSeenActive : Number.NEGATIVE_INFINITY;

const compareLanePosition = (left: DuplicateTabFacts, right: DuplicateTabFacts) =>
  normalizedPosition(left.position) - normalizedPosition(right.position) ||
  compareText(left.id, right.id);

const compareKeeperPriority = (left: DuplicateTabFacts, right: DuplicateTabFacts) =>
  normalizedRecency(right.lastSeenActive) - normalizedRecency(left.lastSeenActive) ||
  compareLanePosition(left, right);

export const effectiveUrl = ({ currentUrl, pinned, pinnedUrl }: DuplicateTabFacts) => {
  const blankPinnedPlaceholder =
    pinnedUrl === "about:blank" && currentUrl !== null && currentUrl !== "about:blank";
  if (pinned && pinnedUrl && !blankPinnedPlaceholder) {
    return pinnedUrl;
  }
  return currentUrl || null;
};

const laneFacts = (facts: readonly DuplicateTabFacts[]): Lane[] => {
  const spaces = new Map<string, Map<string, DuplicateTabFacts[]>>();
  for (const fact of facts) {
    const lanes = spaces.get(fact.spaceId) ?? new Map<string, DuplicateTabFacts[]>();
    spaces.set(fact.spaceId, lanes);
    const tabs = lanes.get(fact.laneId) ?? [];
    lanes.set(fact.laneId, tabs);
    tabs.push(fact);
  }

  return [...spaces.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .flatMap(([spaceId, lanes]) =>
      [...lanes.entries()]
        .sort(([left], [right]) => compareText(left, right))
        .map(([laneId, tabs]) => ({
          spaceId,
          laneId,
          tabs: tabs.toSorted(compareLanePosition),
        })),
    );
};

const chooseKeeper = (tabs: readonly DuplicateTabFacts[]): DuplicateTabFacts => {
  const essentials = tabs.filter(tab => tab.essential);
  const pins = tabs.filter(tab => tab.pinned);
  const candidates = essentials.length > 0 ? essentials : pins.length > 0 ? pins : tabs;
  const keeper = candidates.toSorted(compareKeeperPriority)[0];
  if (!keeper) {
    throw new Error("Cannot choose a keeper without duplicate tabs");
  }
  return keeper;
};

const clusterLane = (lane: Lane, includePinned: boolean): DuplicateClusterPlan[] => {
  const positionById = new Map(lane.tabs.map((tab, index) => [tab.id, index]));
  const tabsByUrl = new Map<string, Map<number, DuplicateTabFacts[]>>();
  for (const tab of lane.tabs) {
    const url = effectiveUrl(tab);
    if (!url) {
      continue;
    }
    const tabsByContainer = tabsByUrl.get(url) ?? new Map<number, DuplicateTabFacts[]>();
    tabsByUrl.set(url, tabsByContainer);
    const tabs = tabsByContainer.get(tab.containerId) ?? [];
    tabsByContainer.set(tab.containerId, tabs);
    tabs.push(tab);
  }

  const clusters: DuplicateClusterPlan[] = [];
  for (const [url, tabsByContainer] of tabsByUrl) {
    for (const [containerId, unsortedTabs] of tabsByContainer) {
      if (unsortedTabs.length < 2) {
        continue;
      }
      const tabs = unsortedTabs.toSorted(compareLanePosition);
      const keeper = chooseKeeper(tabs);
      const ordinaryCandidateIds: string[] = [];
      const pinnedCandidateIds: string[] = [];
      const protectedDuplicateIds: string[] = [];

      for (const tab of tabs) {
        if (tab.id === keeper.id) {
          continue;
        }
        if (tab.essential || (tab.pinned && !includePinned)) {
          protectedDuplicateIds.push(tab.id);
        } else if (tab.pinned) {
          pinnedCandidateIds.push(tab.id);
        } else {
          ordinaryCandidateIds.push(tab.id);
        }
      }

      clusters.push({
        identity: {
          url,
          containerId,
          spaceId: lane.spaceId,
          laneId: lane.laneId,
        },
        tabIds: tabs.map(tab => tab.id),
        keeperId: keeper.id,
        ordinaryCandidateIds,
        pinnedCandidateIds,
        protectedDuplicateIds,
      });
    }
  }

  return clusters.toSorted((left, right) => {
    const leftPosition = positionById.get(left.keeperId) ?? Number.POSITIVE_INFINITY;
    const rightPosition = positionById.get(right.keeperId) ?? Number.POSITIVE_INFINITY;
    return (
      leftPosition - rightPosition ||
      compareText(left.identity.url, right.identity.url) ||
      left.identity.containerId - right.identity.containerId
    );
  });
};

const groupLane = (
  lane: Lane,
  clusters: readonly DuplicateClusterPlan[],
  includePinned: boolean,
) => {
  const factsById = new Map(lane.tabs.map(tab => [tab.id, tab]));
  const previousById = new Map<string, string | null>();
  const nextById = new Map<string, string | null>();
  for (const [index, tab] of lane.tabs.entries()) {
    previousById.set(tab.id, lane.tabs[index - 1]?.id ?? null);
    nextById.set(tab.id, lane.tabs[index + 1]?.id ?? null);
  }
  let headId = lane.tabs[0]?.id ?? null;
  const moves: DuplicateMove[] = [];

  // Mirror each future move in a linked lane so planning stays linear after clustering.
  for (const cluster of clusters) {
    let anchorId = cluster.keeperId;
    for (const tabId of cluster.tabIds) {
      if (tabId === cluster.keeperId) {
        continue;
      }
      const tab = factsById.get(tabId);
      if (!tab || tab.essential || (tab.pinned && !includePinned)) {
        continue;
      }

      if (nextById.get(anchorId) !== tabId) {
        const previousId = previousById.get(tabId) ?? null;
        const nextId = nextById.get(tabId) ?? null;
        if (previousId) {
          nextById.set(previousId, nextId);
        } else {
          headId = nextId;
        }
        if (nextId) {
          previousById.set(nextId, previousId);
        }

        const nextAnchorId = nextById.get(anchorId) ?? null;
        nextById.set(anchorId, tabId);
        previousById.set(tabId, anchorId);
        nextById.set(tabId, nextAnchorId);
        if (nextAnchorId) {
          previousById.set(nextAnchorId, tabId);
        }
        moves.push({ tabId, afterTabId: anchorId, laneId: lane.laneId });
      }
      anchorId = tabId;
    }
  }

  const currentOrder: string[] = [];
  while (headId) {
    currentOrder.push(headId);
    headId = nextById.get(headId) ?? null;
  }
  return { moves, currentOrder };
};

export const planDuplicates = (
  facts: readonly DuplicateTabFacts[],
  { includePinned = false }: DuplicatePlanOptions = {},
): DuplicatePlan => {
  const clusters: DuplicateClusterPlan[] = [];
  const moves: DuplicateMove[] = [];
  const laneOrders: PlannedLaneOrder[] = [];

  for (const lane of laneFacts(facts)) {
    const laneClusters = clusterLane(lane, includePinned);
    if (laneClusters.length === 0) {
      continue;
    }
    clusters.push(...laneClusters);
    const grouping = groupLane(lane, laneClusters, includePinned);
    moves.push(...grouping.moves);
    laneOrders.push({
      spaceId: lane.spaceId,
      laneId: lane.laneId,
      tabIds: grouping.currentOrder,
    });
  }

  return {
    clusters,
    ordinaryCandidateIds: clusters.flatMap(cluster => cluster.ordinaryCandidateIds),
    pinnedCandidateIds: clusters.flatMap(cluster => cluster.pinnedCandidateIds),
    protectedDuplicateIds: clusters.flatMap(cluster => cluster.protectedDuplicateIds),
    moves,
    laneOrders,
  };
};
