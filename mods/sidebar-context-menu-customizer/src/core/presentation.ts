import {
  type ActionIdentity,
  actionPreferenceKey,
  compareCustomizationActions,
  resolveExcludedFromRootIds,
  separatorsToHide,
} from "./policy.ts";

export type PresentationKind = "action" | "control" | "separator";
export type PresentationControlRole = "more-actions" | "ordinary";

/**
 * A platform snapshot with no live browser objects. `key` is a structural fallback;
 * action candidates replace it with their one derived stable preference key.
 */
export interface PresentationSourceFact {
  browserVisible: boolean;
  controlRole: PresentationControlRole;
  identity: ActionIdentity | null;
  key: string;
  kind: PresentationKind;
  label: string;
  originalIndex: number;
}

export interface PresentationFact {
  browserVisible: boolean;
  controlRole: PresentationControlRole;
  key: string;
  kind: PresentationKind;
  label: string;
  originalIndex: number;
  selected: boolean;
}

export interface PresentationSnapshot {
  excludedFromRootIds: Set<string>;
  facts: PresentationFact[];
  initialized: boolean;
}

export interface MenuPresentationPlan {
  hiddenSeparatorIndexes: Set<number>;
  moreActions: PresentationFact[];
  moreActionsVisible: boolean;
  visibleMoreActions: PresentationFact[];
}

export const createPresentationSnapshot = (
  sources: readonly PresentationSourceFact[],
  storedExcludedFromRoot: ReadonlySet<string> | null,
  deriveActionKey: (identity: ActionIdentity) => string | null = actionPreferenceKey,
): PresentationSnapshot => {
  const discoveredActionIds: string[] = [];
  const keyed = sources.map(source => {
    if (source.kind !== "action") {
      return source;
    }

    const actionKey = source.identity ? deriveActionKey(source.identity) : null;
    if (!actionKey) {
      return { ...source, kind: "control" as const };
    }
    discoveredActionIds.push(actionKey);
    return { ...source, key: actionKey };
  });
  const resolved = resolveExcludedFromRootIds(
    storedExcludedFromRoot,
    discoveredActionIds,
  );

  return {
    excludedFromRootIds: resolved.ids,
    facts: keyed.map(({ identity: _identity, ...fact }) => ({
      ...fact,
      selected: fact.kind !== "action" || !resolved.ids.has(fact.key),
    })),
    initialized: resolved.initialized,
  };
};

export const sortPresentationActions = <T extends PresentationFact>(
  actions: readonly T[],
): T[] => [...actions].sort(compareCustomizationActions);

export const planMenuPresentation = (
  facts: readonly PresentationFact[],
): MenuPresentationPlan => {
  const moreActions = sortPresentationActions(
    facts.filter(fact => fact.kind === "action" && !fact.selected),
  );
  const visibleMoreActions = moreActions.filter(action => action.browserVisible);
  const moreActionsVisible = visibleMoreActions.length > 0;
  const structuralFacts = facts.map(fact => ({
    kind: fact.kind === "separator" ? ("separator" as const) : ("item" as const),
    visible:
      fact.kind === "action"
        ? fact.selected && fact.browserVisible
        : fact.kind === "control" && fact.controlRole === "more-actions"
          ? moreActionsVisible
          : fact.browserVisible,
  }));
  const hiddenPositions = separatorsToHide(structuralFacts);
  const hiddenSeparatorIndexes = new Set<number>();
  for (const position of hiddenPositions) {
    const fact = facts[position];
    if (fact) {
      hiddenSeparatorIndexes.add(fact.originalIndex);
    }
  }

  return {
    hiddenSeparatorIndexes,
    moreActions,
    moreActionsVisible,
    visibleMoreActions,
  };
};
