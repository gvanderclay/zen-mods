/** Derives pure facts from live tab-menu nodes without copying action state. */

import { coalesceCustomizationActions } from "../core/policy.ts";
import {
  createPresentationSnapshot,
  type PresentationFact,
  type PresentationSnapshot,
  type PresentationSourceFact,
} from "../core/presentation.ts";

export const TAB_MENU_ID = "tabContextMenu";
export const CUSTOMIZER_SEPARATOR_ID = "sidebar-context-menu-customizer-tab-separator";
export const CUSTOMIZER_ITEM_ID = "sidebar-context-menu-customizer-tab-menu";
export const MORE_ACTIONS_MENU_ID = "sidebar-context-menu-customizer-more-actions-menu";
export const MORE_ACTIONS_POPUP_ID = "sidebar-context-menu-customizer-more-actions-popup";
export const COMPACT_MODE_MARKER_ID =
  "sidebar-context-menu-customizer-compact-mode-marker";

const ownIds = new Set([
  CUSTOMIZER_SEPARATOR_ID,
  CUSTOMIZER_ITEM_ID,
  MORE_ACTIONS_MENU_ID,
  MORE_ACTIONS_POPUP_ID,
]);

const actionIdentity = (node: Element) => ({
  id: node.id,
  l10nId: node.getAttribute("data-l10n-id") ?? node.getAttribute("data-lazy-l10n-id"),
  command: node.getAttribute("command"),
  className: node.getAttribute("class"),
});

const isActionCandidate = (node: Element) =>
  (node.localName === "menu" || node.localName === "menuitem") && !ownIds.has(node.id);

const browserShows = (node: XulElement) => !node.hidden;

const fallbackLabel = (id: string) =>
  id
    .replace(/^context_/, "")
    .replace(/^zen-/, "")
    .replaceAll(/[-_]+/g, " ")
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, first => first.toUpperCase());

const itemLabel = (node: Element) => {
  const command = node.getAttribute("command");
  return (
    node.getAttribute("label")?.trim() ||
    fallbackLabel(
      node.id ||
        node.getAttribute("data-l10n-id") ||
        node.getAttribute("data-lazy-l10n-id") ||
        (command ? `command:${command}` : "action"),
    )
  );
};

const presentationSources = (nodes: readonly XulElement[]): PresentationSourceFact[] =>
  nodes.map((node, originalIndex) => {
    const kind =
      node.localName === "menuseparator"
        ? ("separator" as const)
        : isActionCandidate(node)
          ? ("action" as const)
          : ("control" as const);
    return {
      browserVisible: browserShows(node),
      controlRole:
        node.id === MORE_ACTIONS_MENU_ID
          ? ("more-actions" as const)
          : ("ordinary" as const),
      identity: kind === "action" ? actionIdentity(node) : null,
      key: node.id || `${node.localName}:${originalIndex}`,
      kind,
      label: kind === "separator" ? "" : itemLabel(node),
      originalIndex,
    };
  });

export interface PlatformPresentationSnapshot {
  nodes: XulElement[];
  snapshot: PresentationSnapshot;
}

export const snapshotNodes = (
  nodes: XulElement[],
  excludedFromRoot: ReadonlySet<string> | null,
): PlatformPresentationSnapshot => ({
  nodes,
  snapshot: createPresentationSnapshot(presentationSources(nodes), excludedFromRoot),
});

export const readRootPresentation = (
  root: XulElement,
  readExcludedFromRootIds: () => Set<string> | null,
  writeExcludedFromRootIds: (ids: ReadonlySet<string>) => void,
): PlatformPresentationSnapshot => {
  const presentation = snapshotNodes(
    [...root.children] as XulElement[],
    readExcludedFromRootIds(),
  );
  if (presentation.snapshot.initialized) {
    writeExcludedFromRootIds(presentation.snapshot.excludedFromRootIds);
  }
  return presentation;
};

export const editorActionRows = (presentation: PlatformPresentationSnapshot) => {
  const actions = presentation.snapshot.facts.filter(
    (fact): fact is PresentationFact => fact.kind === "action",
  );
  return coalesceCustomizationActions(actions).map(({ key, keys, label, selected }) => ({
    key,
    keys,
    label,
    selected,
  }));
};
