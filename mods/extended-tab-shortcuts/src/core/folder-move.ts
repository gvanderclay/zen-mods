export interface FolderMoveTabSnapshot {
  readonly essential: boolean;
  readonly groupId: string | null;
  readonly id: string;
  readonly liveFolderItem: boolean;
  readonly spaceId: string | null;
  readonly split: boolean;
}

export interface FolderMoveFolderSnapshot {
  readonly id: string;
  readonly label: string;
  readonly level: number;
  readonly live: boolean;
  readonly spaceId: string | null;
}

export interface FolderMoveInput {
  readonly activeId: string | null;
  readonly currentSpaceId: string;
  readonly folders: readonly FolderMoveFolderSnapshot[];
  readonly hasMultiSelection: boolean;
  readonly privateWindow: boolean;
  readonly selectedIds: readonly string[];
  readonly tabs: readonly FolderMoveTabSnapshot[];
}

export type FolderMoveBlockedReason =
  | "missing-active-tab"
  | "invalid-selection"
  | "mixed-space-selection"
  | "private-window"
  | "unsupported-selection";

export interface FolderMoveDestination {
  readonly id: string;
  readonly label: string;
  readonly level: number;
  readonly shortcut: string | null;
}

export type FolderMoveDecision =
  | {
      readonly kind: "blocked";
      readonly reason: FolderMoveBlockedReason;
    }
  | {
      readonly activeId: string;
      readonly destinations: readonly FolderMoveDestination[];
      readonly kind: "ready";
      readonly tabIds: readonly string[];
    };

export const decideFolderMove = (input: FolderMoveInput): FolderMoveDecision => {
  if (input.privateWindow) return { kind: "blocked", reason: "private-window" };
  if (!input.activeId) return { kind: "blocked", reason: "missing-active-tab" };

  const tabsById = new Map(input.tabs.map(tab => [tab.id, tab]));
  const activeTab = tabsById.get(input.activeId);
  if (!activeTab) return { kind: "blocked", reason: "missing-active-tab" };

  const selectedIds = input.hasMultiSelection
    ? new Set(input.selectedIds)
    : new Set([input.activeId]);
  if (
    selectedIds.size === 0 ||
    !selectedIds.has(input.activeId) ||
    [...selectedIds].some(id => !tabsById.has(id))
  ) {
    return { kind: "blocked", reason: "invalid-selection" };
  }

  const selectedTabs = input.tabs.filter(tab => selectedIds.has(tab.id));
  if (selectedTabs.some(tab => tab.essential || tab.liveFolderItem || tab.split)) {
    return { kind: "blocked", reason: "unsupported-selection" };
  }
  if (selectedTabs.some(tab => tab.spaceId !== input.currentSpaceId)) {
    return { kind: "blocked", reason: "mixed-space-selection" };
  }

  const destinations = input.folders
    .filter(
      folder =>
        !folder.live &&
        folder.spaceId === input.currentSpaceId &&
        !selectedTabs.some(tab => tab.groupId === folder.id),
    )
    .map((folder, index) => ({
      id: folder.id,
      label: folder.label,
      level: folder.level,
      shortcut: index < 9 ? String(index + 1) : null,
    }));

  return {
    activeId: input.activeId,
    destinations,
    kind: "ready",
    tabIds: selectedTabs.map(tab => tab.id),
  };
};
