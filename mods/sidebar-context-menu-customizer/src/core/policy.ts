export interface ActionIdentity {
  id: string;
  l10nId: string | null;
  command: string | null;
  className: string | null;
}

export const PROMOTION_COPY_LINKS = "share.copy-links";

export interface CopyLinksPromotionState {
  visible: boolean;
  disabled: boolean;
  labelCount: number;
}

export const copyLinksPromotionState = (
  promotedIds: ReadonlySet<string>,
  shareableCount: number,
): CopyLinksPromotionState => ({
  visible: promotedIds.has(PROMOTION_COPY_LINKS),
  disabled: shareableCount < 1,
  labelCount: Math.max(1, shareableCount),
});

export interface CustomizationActionFacts {
  key: string;
  label: string;
  selected: boolean;
}

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
  const alphabetically = (left: T, right: T) =>
    left.label.localeCompare(right.label, undefined, {
      numeric: true,
      sensitivity: "base",
    }) || left.key.localeCompare(right.key);

  return {
    selected: actions.filter(action => action.selected).sort(alphabetically),
    unselected: actions.filter(action => !action.selected).sort(alphabetically),
  };
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

export const decodeHiddenIds = (raw: string): Set<string> => {
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

export const encodeHiddenIds = (ids: ReadonlySet<string>): string =>
  JSON.stringify([...ids].sort());

export const resolveHiddenIds = (
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
