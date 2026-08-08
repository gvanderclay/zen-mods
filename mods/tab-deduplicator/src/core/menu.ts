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
  if (!supported) {
    return { label: "Deduplicate tabs (unsupported)", disabled: true };
  }

  const count =
    Number.isSafeInteger(duplicateCount) && duplicateCount > 0 ? duplicateCount : 0;
  if (count === 0) {
    return { label: "No duplicate tabs in this space", disabled: true };
  }

  return {
    label: `Close ${count} duplicate ${count === 1 ? "tab" : "tabs"} in this space`,
    disabled: false,
  };
};
