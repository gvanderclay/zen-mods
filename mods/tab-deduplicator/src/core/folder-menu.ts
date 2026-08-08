export interface FolderGroupingMenuFacts {
  supported: boolean;
  moveCount: number;
  pinnedMoveCount: number;
}

export interface FolderGroupingMenuState {
  label: string;
  disabled: boolean;
}

export interface FolderCloseMenuFacts {
  supported: boolean;
  candidateCount: number;
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

export const folderCloseMenuState = ({
  supported,
  candidateCount: rawCandidateCount,
}: FolderCloseMenuFacts): FolderGroupingMenuState => {
  if (!supported) {
    return { label: "Close duplicate tabs (unsupported)", disabled: true };
  }

  const candidateCount = safeCount(rawCandidateCount);
  if (candidateCount === 0) {
    return {
      label: "No duplicate tabs to close in this folder",
      disabled: true,
    };
  }

  return {
    label: `Close ${candidateCount} duplicate tab${candidateCount === 1 ? "" : "s"} in this folder…`,
    disabled: false,
  };
};
