export interface SpaceGroupingMenuFacts {
  supported: boolean;
  moveCount: number;
  pinnedMoveCount: number;
}

export interface SpaceGroupingMenuState {
  label: string;
  disabled: boolean;
}

const safeCount = (value: number) =>
  Number.isSafeInteger(value) && value > 0 ? value : 0;

export const spaceGroupingMenuState = ({
  supported,
  moveCount: rawMoveCount,
  pinnedMoveCount: rawPinnedMoveCount,
}: SpaceGroupingMenuFacts): SpaceGroupingMenuState => {
  if (!supported) {
    return { label: "Group duplicate tabs (unsupported)", disabled: true };
  }

  const moveCount = safeCount(rawMoveCount);
  if (moveCount > 0) {
    return {
      label: `Group ${moveCount} duplicate tab${moveCount === 1 ? "" : "s"} in this space`,
      disabled: false,
    };
  }

  if (safeCount(rawPinnedMoveCount) > 0) {
    return {
      label: "Enable pinned tabs to group duplicates in this space",
      disabled: true,
    };
  }

  return { label: "No duplicate tabs to group in this space", disabled: true };
};
