export interface WindowToggleTab {
  readonly essential: boolean;
  readonly grouped: boolean;
  readonly id: string;
  readonly split: boolean;
}

export interface WindowToggleSnapshot {
  readonly activeId: string | null;
  readonly currentSpaceTabIds: readonly string[];
  readonly hasMultiSelection: boolean;
  readonly isolatedWindowCount: number;
  readonly privateWindow: boolean;
  readonly realTabIds: readonly string[];
  readonly selectedIds: readonly string[];
  readonly sharedWindowAvailable: boolean;
  readonly sourceUnsynced: boolean;
  readonly tabs: readonly WindowToggleTab[];
}

export type WindowToggleBlockReason =
  | "essential"
  | "grouped"
  | "invalid-selection"
  | "private-window"
  | "split";

export type WindowToggleDestination =
  | "existing-isolated"
  | "existing-shared"
  | "new-isolated"
  | "new-shared";

export type WindowToggleDecision =
  | { readonly kind: "blocked"; readonly reason: WindowToggleBlockReason }
  | {
      readonly closeSourceWindow: boolean;
      readonly createSourceTab: boolean;
      readonly destination: WindowToggleDestination;
      readonly kind: "move";
      readonly tabIds: readonly string[];
    };

export const decideWindowToggle = (
  snapshot: WindowToggleSnapshot,
): WindowToggleDecision => {
  if (snapshot.privateWindow) {
    return { kind: "blocked", reason: "private-window" };
  }
  if (!snapshot.activeId) {
    return { kind: "blocked", reason: "invalid-selection" };
  }

  const requestedIds = snapshot.hasMultiSelection
    ? snapshot.selectedIds
    : [snapshot.activeId];
  const tabsById = new Map(snapshot.tabs.map(tab => [tab.id, tab]));
  const requested = new Set(requestedIds);
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
  }

  const selected = new Set(tabIds);
  const sourceWouldEmpty =
    snapshot.realTabIds.length > 0 && snapshot.realTabIds.every(id => selected.has(id));
  const closeSourceWindow = snapshot.sourceUnsynced && sourceWouldEmpty;
  const destination: WindowToggleDestination = snapshot.sourceUnsynced
    ? snapshot.sharedWindowAvailable
      ? "existing-shared"
      : "new-shared"
    : snapshot.isolatedWindowCount > 0
      ? "existing-isolated"
      : "new-isolated";
  return {
    closeSourceWindow,
    createSourceTab:
      !closeSourceWindow &&
      ((snapshot.currentSpaceTabIds.length > 0 &&
        snapshot.currentSpaceTabIds.every(id => selected.has(id))) ||
        (!snapshot.sourceUnsynced && sourceWouldEmpty)),
    destination,
    kind: "move",
    tabIds,
  };
};
