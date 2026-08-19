export const duplicateToastText = (tabCount: number): string =>
  tabCount === 1 ? "Tab duplicated!" : `${tabCount} tabs duplicated!`;
