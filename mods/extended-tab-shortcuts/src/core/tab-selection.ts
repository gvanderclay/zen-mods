export interface TabSelectionSnapshot {
  readonly activeId: string | null;
  readonly selectedIds: readonly string[];
  readonly visibleIds: readonly string[];
}

export interface TabSelectionSession {
  readonly anchorId: string;
  readonly headId: string;
}

export interface TabSelectionStep {
  readonly selectionIds: readonly string[] | null;
  readonly session: TabSelectionSession | null;
}

const sameSelection = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every(id => rightIds.has(id));
};

const rangeFor = (
  visibleIds: readonly string[],
  session: TabSelectionSession,
): readonly string[] | null => {
  const anchorIndex = visibleIds.indexOf(session.anchorId);
  const headIndex = visibleIds.indexOf(session.headId);
  if (anchorIndex < 0 || headIndex < 0) return null;
  return visibleIds.slice(
    Math.min(anchorIndex, headIndex),
    Math.max(anchorIndex, headIndex) + 1,
  );
};

const validSession = (
  snapshot: TabSelectionSnapshot,
  session: TabSelectionSession | null,
): session is TabSelectionSession => {
  if (!session || !snapshot.activeId) return false;
  const expected = rangeFor(snapshot.visibleIds, session);
  if (!expected?.includes(snapshot.activeId)) return false;
  return sameSelection(snapshot.selectedIds, expected);
};

const adoptContiguousSelection = (
  snapshot: TabSelectionSnapshot,
  direction: -1 | 1,
): TabSelectionSession | null => {
  if (snapshot.selectedIds.length < 2 || !snapshot.activeId) return null;
  const selectedIndices = snapshot.selectedIds
    .map(id => snapshot.visibleIds.indexOf(id))
    .sort((left, right) => left - right);
  const firstIndex = selectedIndices[0];
  const lastIndex = selectedIndices.at(-1);
  if (
    firstIndex === undefined ||
    lastIndex === undefined ||
    firstIndex < 0 ||
    lastIndex - firstIndex + 1 !== selectedIndices.length ||
    !snapshot.selectedIds.includes(snapshot.activeId)
  ) {
    return null;
  }
  const firstId = snapshot.visibleIds[firstIndex];
  const lastId = snapshot.visibleIds[lastIndex];
  if (!firstId || !lastId) return null;
  return direction === 1
    ? { anchorId: firstId, headId: lastId }
    : { anchorId: lastId, headId: firstId };
};

export const extendTabSelection = (
  snapshot: TabSelectionSnapshot,
  session: TabSelectionSession | null,
  direction: -1 | 1,
): TabSelectionStep => {
  const activeId = snapshot.activeId;
  const activeIndex = activeId ? snapshot.visibleIds.indexOf(activeId) : -1;
  if (!activeId || activeIndex < 0) {
    return { selectionIds: null, session: null };
  }

  const currentSession = validSession(snapshot, session)
    ? session
    : adoptContiguousSelection(snapshot, direction);
  const headIndex = currentSession
    ? snapshot.visibleIds.indexOf(currentSession.headId)
    : activeIndex;
  const nextHeadIndex = headIndex + direction;
  if (nextHeadIndex < 0 || nextHeadIndex >= snapshot.visibleIds.length) {
    return { selectionIds: null, session: currentSession };
  }

  const nextHeadId = snapshot.visibleIds[nextHeadIndex];
  if (!nextHeadId) return { selectionIds: null, session: currentSession };
  const nextSession = {
    anchorId: currentSession?.anchorId ?? activeId,
    headId: nextHeadId,
  };
  return {
    selectionIds: rangeFor(snapshot.visibleIds, nextSession),
    session: nextSession,
  };
};

export const selectionsMatch = sameSelection;
