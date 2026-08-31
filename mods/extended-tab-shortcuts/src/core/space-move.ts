export type SpaceMoveDirection = -1 | 1;

export interface SpaceMoveTab {
  readonly essential: boolean;
  readonly grouped: boolean;
  readonly id: string;
  readonly spaceId: string | null;
  readonly split: boolean;
}

export interface SpaceMoveSnapshot {
  readonly activeId: string | null;
  readonly currentSpaceId: string;
  readonly direction: SpaceMoveDirection;
  readonly hasMultiSelection: boolean;
  readonly selectedIds: readonly string[];
  readonly spaces: readonly string[];
  readonly tabs: readonly SpaceMoveTab[];
  readonly workspaceEnabled: boolean;
  readonly wrap: boolean;
}

export type SpaceMoveBlockReason =
  | "essential"
  | "grouped"
  | "invalid-selection"
  | "no-destination"
  | "split"
  | "workspaces-disabled";

export type SpaceMoveDecision =
  | { readonly kind: "blocked"; readonly reason: SpaceMoveBlockReason }
  | {
      readonly destinationId: string;
      readonly kind: "move";
      readonly tabIds: readonly string[];
    };

export const decideSpaceMove = (snapshot: SpaceMoveSnapshot): SpaceMoveDecision => {
  if (!snapshot.workspaceEnabled) {
    return { kind: "blocked", reason: "workspaces-disabled" };
  }
  if (!snapshot.activeId) {
    return { kind: "blocked", reason: "invalid-selection" };
  }

  const requestedIds = snapshot.hasMultiSelection
    ? snapshot.selectedIds
    : [snapshot.activeId];
  const requested = new Set(requestedIds);
  const tabsById = new Map(snapshot.tabs.map(tab => [tab.id, tab]));
  const tabIds = snapshot.tabs.filter(tab => requested.has(tab.id)).map(tab => tab.id);
  if (
    tabIds.length === 0 ||
    tabIds.length !== requestedIds.length ||
    !tabIds.includes(snapshot.activeId) ||
    requestedIds.some(id => !tabsById.has(id))
  ) {
    return { kind: "blocked", reason: "invalid-selection" };
  }

  for (const id of tabIds) {
    const tab = tabsById.get(id);
    if (tab?.essential) return { kind: "blocked", reason: "essential" };
    if (tab?.grouped) return { kind: "blocked", reason: "grouped" };
    if (tab?.split) return { kind: "blocked", reason: "split" };
    if (tab?.spaceId !== snapshot.currentSpaceId) {
      return { kind: "blocked", reason: "invalid-selection" };
    }
  }

  const currentIndex = snapshot.spaces.indexOf(snapshot.currentSpaceId);
  if (snapshot.spaces.length < 2 || currentIndex < 0) {
    return { kind: "blocked", reason: "no-destination" };
  }
  let destinationIndex = currentIndex + snapshot.direction;
  if (snapshot.wrap) {
    destinationIndex =
      (destinationIndex + snapshot.spaces.length) % snapshot.spaces.length;
  } else if (destinationIndex < 0 || destinationIndex >= snapshot.spaces.length) {
    return { kind: "blocked", reason: "no-destination" };
  }

  const destinationId = snapshot.spaces[destinationIndex];
  if (!destinationId || destinationId === snapshot.currentSpaceId) {
    return { kind: "blocked", reason: "no-destination" };
  }
  return { destinationId, kind: "move", tabIds };
};
