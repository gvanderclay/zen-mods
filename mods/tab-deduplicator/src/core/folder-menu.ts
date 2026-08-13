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
}: FolderGroupingMenuFacts): FolderGroupingMenuState => {
  const moveCount = safeCount(rawMoveCount);
  return {
    label: "Group Duplicate Tabs",
    disabled: !supported || moveCount === 0,
  };
};

export const folderCloseMenuState = ({
  supported,
  candidateCount: rawCandidateCount,
}: FolderCloseMenuFacts): FolderGroupingMenuState => {
  const candidateCount = safeCount(rawCandidateCount);
  return {
    label: "Close Duplicate Tabs",
    disabled: !supported || candidateCount === 0,
  };
};
