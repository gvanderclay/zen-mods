export interface DedupeMenuFacts {
  supported: boolean;
  duplicateCount: number;
}

export interface DedupeMenuState {
  label: string;
  disabled: boolean;
}

export const dedupeMenuState = ({
  supported,
  duplicateCount,
}: DedupeMenuFacts): DedupeMenuState => {
  const count =
    Number.isSafeInteger(duplicateCount) && duplicateCount > 0 ? duplicateCount : 0;
  return {
    label: "Close Duplicate Tabs",
    disabled: !supported || count === 0,
  };
};
