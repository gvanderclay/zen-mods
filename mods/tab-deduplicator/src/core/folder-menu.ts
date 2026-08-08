export interface FolderGroupingMenuFacts {
  supported: boolean;
  moveCount: number;
  pinnedMoveCount: number;
}

export interface FolderGroupingMenuState {
  label: string;
  disabled: boolean;
}

const safeCount = (value: number) =>
  Number.isSafeInteger(value) && value > 0 ? value : 0;

export const folderGroupingMenuState = ({
  supported,
  moveCount: rawMoveCount,
  pinnedMoveCount: rawPinnedMoveCount,
}: FolderGroupingMenuFacts): FolderGroupingMenuState => {
  if (!supported) {
    return { label: "Group duplicate tabs (unsupported)", disabled: true };
  }

  const moveCount = safeCount(rawMoveCount);
  if (moveCount > 0) {
    return {
      label: `Group ${moveCount} duplicate tab${moveCount === 1 ? "" : "s"} in this folder`,
      disabled: false,
    };
  }

  if (safeCount(rawPinnedMoveCount) > 0) {
    return {
      label: "Enable pinned tabs to group duplicates in this folder",
      disabled: true,
    };
  }

  return {
    label: "No duplicate tabs to group in this folder",
    disabled: true,
  };
};
