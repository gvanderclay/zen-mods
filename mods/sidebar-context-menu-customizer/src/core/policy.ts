export interface ActionIdentity {
  id: string;
  l10nId: string | null;
  command: string | null;
  className: string | null;
}

export interface CustomizationActionFacts {
  key: string;
  label: string;
  selected: boolean;
}

export interface MoreActionFacts {
  key: string;
  label: string;
  browserVisible: boolean;
}

const presentationCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

const compareKeys = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const compareCustomizationActions = <
  T extends Pick<CustomizationActionFacts, "key" | "label">,
>(
  left: T,
  right: T,
): number =>
  presentationCollator.compare(left.label, right.label) ||
  compareKeys(left.key, right.key);

export const resolveMoreActions = <T extends MoreActionFacts>(
  actions: readonly T[],
  excludedFromRoot: ReadonlySet<string>,
): { actions: T[]; visibleActions: T[] } => {
  const excludedActions = actions
    .filter(action => excludedFromRoot.has(action.key))
    .sort(compareCustomizationActions);

  return {
    actions: excludedActions,
    visibleActions: excludedActions.filter(action => action.browserVisible),
  };
};

export interface CustomizationActionGroup<T extends CustomizationActionFacts>
  extends CustomizationActionFacts {
  keys: string[];
  actions: T[];
}

export const coalesceCustomizationActions = <T extends CustomizationActionFacts>(
  actions: readonly T[],
): Array<CustomizationActionGroup<T>> => {
  const byLabel = new Map<string, T[]>();
  for (const action of actions) {
    const normalizedLabel = action.label.trim().toLocaleLowerCase();
    const variants = byLabel.get(normalizedLabel) ?? [];
    variants.push(action);
    byLabel.set(normalizedLabel, variants);
  }

  return [...byLabel.values()].map(variants => {
    const keys = variants.map(action => action.key).sort();
    const first = variants[0] as T;
    return {
      key: keys[0] as string,
      keys,
      label: first.label,
      selected: variants.some(action => action.selected),
      actions: variants,
    };
  });
};

export const groupCustomizationActions = <T extends CustomizationActionFacts>(
  actions: readonly T[],
): { selected: T[]; unselected: T[] } => {
  return {
    selected: actions.filter(action => action.selected).sort(compareCustomizationActions),
    unselected: actions
      .filter(action => !action.selected)
      .sort(compareCustomizationActions),
  };
};

export const filterCustomizationActions = <T extends CustomizationActionFacts>(
  actions: readonly T[],
  query: string,
): T[] => {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) {
    return [...actions];
  }
  return actions.filter(action =>
    `${action.label}\n${action.key}`.toLocaleLowerCase().includes(needle),
  );
};

export const updateActionSelection = (
  excludedFromRoot: ReadonlySet<string>,
  keys: readonly string[],
  selected: boolean,
): Set<string> => {
  const next = new Set(excludedFromRoot);
  for (const key of keys) {
    if (selected) {
      next.delete(key);
    } else {
      next.add(key);
    }
  }
  return next;
};

export const actionPreferenceKey = ({
  id,
  l10nId,
  command,
}: ActionIdentity): string | null => {
  if (id.trim()) {
    return id.trim();
  }
  if (l10nId?.trim()) {
    return `l10n:${l10nId.trim()}`;
  }
  if (command?.trim()) {
    return `command:${command.trim()}`;
  }
  return null;
};

export const decodeStoredIds = (raw: string): Set<string> => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(
      parsed
        .filter((value): value is string => typeof value === "string")
        .map(value => value.trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
};

export const encodeStoredIds = (ids: ReadonlySet<string>): string =>
  JSON.stringify([...ids].sort());

export const resolveExcludedFromRootIds = (
  stored: ReadonlySet<string> | null,
  discoveredIds: readonly string[],
): { ids: Set<string>; initialized: boolean } => {
  if (stored !== null) {
    return { ids: new Set(stored), initialized: false };
  }
  return {
    ids: new Set(discoveredIds.map(id => id.trim()).filter(Boolean)),
    initialized: true,
  };
};

export interface MenuNodeFacts {
  kind: "item" | "separator";
  visible: boolean;
}

export const separatorsToHide = (nodes: readonly MenuNodeFacts[]): Set<number> => {
  const hidden = new Set<number>();

  for (const [index, node] of nodes.entries()) {
    if (node.kind !== "separator" || !node.visible) {
      continue;
    }

    let previousItem = -1;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = nodes[cursor];
      if (candidate?.kind === "item" && candidate.visible) {
        previousItem = cursor;
        break;
      }
    }

    const nextItem = nodes.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > index && candidate.kind === "item" && candidate.visible,
    );
    const earlierSeparator = nodes
      .slice(previousItem + 1, index)
      .some(candidate => candidate.kind === "separator" && candidate.visible);

    if (previousItem < 0 || nextItem < 0 || earlierSeparator) {
      hidden.add(index);
    }
  }

  return hidden;
};
