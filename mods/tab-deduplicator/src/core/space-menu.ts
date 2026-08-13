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
}: SpaceGroupingMenuFacts): SpaceGroupingMenuState => {
  const moveCount = safeCount(rawMoveCount);
  return {
    label: "Group Duplicate Tabs",
    disabled: !supported || moveCount === 0,
  };
};
