import {
  type TabSelectionSnapshot as CoreTabSelectionSnapshot,
  extendTabSelection,
  selectionsMatch,
  type TabSelectionSession,
} from "./core/tab-selection.ts";

export interface TabSelectionSnapshot extends CoreTabSelectionSnapshot {
  readonly hasMultiSelection: boolean;
}

export interface TabSelectionPort {
  read(): TabSelectionSnapshot;
  applySelection(selectionIds: readonly string[]): void;
  clearSelection(): void;
  onActiveChange(listener: () => void): () => void;
  onSelectionChange(listener: () => void): () => void;
}

export interface TabSelectionController {
  next(): void;
  previous(): void;
  clear(): void;
  dispose(): void;
}

export const createTabSelectionController = (
  port: TabSelectionPort,
): TabSelectionController => {
  let destroyed = false;
  let session: TabSelectionSession | null = null;
  let expectedSelection: readonly string[] | null = null;

  const reset = () => {
    session = null;
    expectedSelection = null;
  };
  const onSelectionChange = () => {
    const selectedIds = port.read().selectedIds;
    if (expectedSelection && selectionsMatch(selectedIds, expectedSelection)) {
      expectedSelection = null;
      return;
    }
    reset();
  };
  const removeSelectionListener = port.onSelectionChange(onSelectionChange);
  const removeActiveListener = port.onActiveChange(reset);

  const move = (direction: -1 | 1) => {
    if (destroyed) return;
    const snapshot = port.read();
    if (expectedSelection && selectionsMatch(snapshot.selectedIds, expectedSelection)) {
      expectedSelection = null;
    }
    const step = extendTabSelection(snapshot, session, direction);
    session = step.session;
    if (step.selectionIds && !selectionsMatch(snapshot.selectedIds, step.selectionIds)) {
      expectedSelection = step.selectionIds;
      port.applySelection(step.selectionIds);
    }
  };

  return {
    next: () => move(1),
    previous: () => move(-1),
    clear() {
      if (destroyed) return;
      session = null;
      const snapshot = port.read();
      if (!snapshot.hasMultiSelection) {
        expectedSelection = null;
        return;
      }
      expectedSelection = snapshot.activeId ? [snapshot.activeId] : [];
      port.clearSelection();
    },
    dispose() {
      if (destroyed) return;
      destroyed = true;
      reset();
      removeActiveListener();
      removeSelectionListener();
    },
  };
};
