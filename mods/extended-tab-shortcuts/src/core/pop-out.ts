export interface PopOutTab {
  readonly essential: boolean;
  readonly grouped: boolean;
  readonly id: string;
  readonly split: boolean;
}

export interface PopOutSnapshot {
  readonly activeId: string | null;
  readonly currentSpaceTabIds: readonly string[];
  readonly hasMultiSelection: boolean;
  readonly privateWindow: boolean;
  readonly selectedIds: readonly string[];
  readonly tabs: readonly PopOutTab[];
}

export type PopOutBlockReason =
  | "essential"
  | "grouped"
  | "invalid-selection"
  | "private-window"
  | "split";

export type PopOutDecision =
  | { readonly kind: "blocked"; readonly reason: PopOutBlockReason }
  | {
      readonly createSourceTab: boolean;
      readonly kind: "move";
      readonly tabIds: readonly string[];
    };

export const decidePopOut = (snapshot: PopOutSnapshot): PopOutDecision => {
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
  return {
    createSourceTab:
      snapshot.currentSpaceTabIds.length > 0 &&
      snapshot.currentSpaceTabIds.every(id => selected.has(id)),
    kind: "move",
    tabIds,
  };
};
