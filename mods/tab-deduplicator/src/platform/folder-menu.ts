/**
 * Installs a direct action in Zen's folder-label context menu.
 *
 * Verified in Zen's shipped `browser/omni.ja`:
 *
 * - `browser.xhtml` 2724–2745 defines `#zenFolderActions`.
 * - `ZenFolder.mjs` 79 assigns that menu to each folder label container.
 * - `ZenFolders.mjs` 100–147 resolves a folder from `explicitOriginalTarget`, a
 *   Firefox tab-group label, its child, or Zen's label-container shape. The resolver
 *   below mirrors those relationships and still requires `isZenFolder`.
 * - `tabbrowser.js` 7354–7473 implements `moveTabAfter` through Firefox's normal tab
 *   move path. Lines 7384–7393 move a whole split-view wrapper when one of its tabs is
 *   passed, so this mod deliberately rejects a move whose source or anchor is in one.
 */

import type { DuplicateMove } from "../core/duplicates.ts";
import { planDuplicates } from "../core/duplicates.ts";
import { folderCloseMenuState, folderGroupingMenuState } from "../core/folder-menu.ts";
import { type CloseCandidateSet, closeIntent } from "../core/pinned-close.ts";
import { confirmPinnedClose, runPinnedClose } from "./pinned-close.ts";
import {
  enclosingZenFolder,
  folderLaneId,
  isSplitViewTab,
  snapshotDuplicateTabs,
} from "./snapshot.ts";

const ITEM_ID = "tab-deduplicator-group-folder";
const CLOSE_ITEM_ID = "tab-deduplicator-close-folder";
const MENU_ID = "zenFolderActions";
const ANCHOR_ID = "context_zenFolderUnloadAll";

interface ContextNode {
  readonly group?: unknown;
  readonly parentElement?: unknown;
  readonly isZenFolder?: unknown;
  readonly id?: unknown;
  readonly classList?: { contains(name: string): boolean };
}

type IsTabGroupLabel = (target: unknown) => boolean;

const contextNode = (value: unknown): ContextNode | null =>
  typeof value === "object" && value !== null ? (value as ContextNode) : null;

const zenFolder = (value: unknown): BrowserTabGroup | null => {
  const candidate = contextNode(value);
  return candidate?.isZenFolder === true &&
    typeof candidate.id === "string" &&
    candidate.id.length > 0
    ? (candidate as BrowserTabGroup)
    : null;
};

const isLabel = (value: unknown, check: IsTabGroupLabel) => {
  try {
    return check(value);
  } catch {
    return false;
  }
};

export const resolveFolderContextTarget = (
  target: unknown,
  isTabGroupLabel: IsTabGroupLabel,
): BrowserTabGroup | null => {
  const candidate = contextNode(target);
  if (!candidate) {
    return null;
  }

  if (isLabel(target, isTabGroupLabel)) {
    return zenFolder(candidate.group);
  }

  const parent = contextNode(candidate.parentElement);
  if (parent && isLabel(parent, isTabGroupLabel)) {
    return zenFolder(parent.group);
  }

  if (candidate.classList?.contains("tab-group-label-container")) {
    return zenFolder(candidate.parentElement);
  }

  return null;
};

const validFolderMove = (
  move: DuplicateMove,
  tabsById: ReadonlyMap<string, BrowserTab>,
) => {
  const tab = tabsById.get(move.tabId);
  const anchor = tabsById.get(move.afterTabId);
  if (!tab || !anchor || isSplitViewTab(tab) || isSplitViewTab(anchor)) {
    return null;
  }

  const tabFolder = enclosingZenFolder(tab);
  const anchorFolder = enclosingZenFolder(anchor);
  if (
    !tabFolder ||
    !anchorFolder ||
    tabFolder.id !== anchorFolder.id ||
    move.laneId !== folderLaneId(tabFolder.id)
  ) {
    return null;
  }

  return { tab, anchor };
};

const executableFolderMoves = (
  moves: readonly DuplicateMove[],
  tabsById: ReadonlyMap<string, BrowserTab>,
) => moves.filter(move => validFolderMove(move, tabsById) !== null);

export const applyFolderMoves = (
  moves: readonly DuplicateMove[],
  tabsById: ReadonlyMap<string, BrowserTab>,
  moveAfter: (tab: BrowserTab, anchor: BrowserTab) => void,
) => {
  let moved = 0;
  for (const move of moves) {
    const live = validFolderMove(move, tabsById);
    if (!live) {
      continue;
    }
    moveAfter(live.tab, live.anchor);
    moved += 1;
  }
  return moved;
};

export const folderCloseCandidates = (
  candidateIds: readonly string[],
  tabsById: ReadonlyMap<string, BrowserTab>,
  folderId: string,
  pinned = false,
) => {
  const candidates: BrowserTab[] = [];
  for (const candidateId of candidateIds) {
    const tab = tabsById.get(candidateId);
    if (
      tab &&
      tab.pinned === pinned &&
      !tab.hasAttribute("zen-essential") &&
      enclosingZenFolder(tab)?.id === folderId
    ) {
      candidates.push(tab);
    }
  }
  return candidates;
};

export const closeFolderCandidates = (
  confirmationAnchor: unknown,
  candidates: readonly BrowserTab[],
  closingTabsType: number,
  close: (anchor: unknown, tabs: BrowserTab[], closeType: number) => void,
) => {
  if (candidates.length === 0) {
    return false;
  }
  close(confirmationAnchor, [...candidates], closingTabsType);
  return true;
};

interface FolderPlan {
  moves: DuplicateMove[];
  tabsById: Map<string, BrowserTab>;
  pinnedMoveCount: number;
}

const currentFolderPlan = (folderId: string, includePinned: boolean): FolderPlan => {
  const snapshot = snapshotDuplicateTabs();
  const laneId = folderLaneId(folderId);
  const plan = planDuplicates(snapshot.facts, { includePinned });
  const moves = executableFolderMoves(
    plan.moves.filter(move => move.laneId === laneId),
    snapshot.tabsById,
  );

  if (includePinned || moves.length > 0) {
    return { moves, tabsById: snapshot.tabsById, pinnedMoveCount: 0 };
  }

  const withPinned = planDuplicates(snapshot.facts, { includePinned: true });
  const pinnedMoves = executableFolderMoves(
    withPinned.moves.filter(move => move.laneId === laneId),
    snapshot.tabsById,
  );
  return {
    moves,
    tabsById: snapshot.tabsById,
    pinnedMoveCount: pinnedMoves.length,
  };
};

const currentFolderCloseCandidates = (
  folderId: string,
): CloseCandidateSet<BrowserTab> => {
  const snapshot = snapshotDuplicateTabs();
  const laneId = folderLaneId(folderId);
  const plan = planDuplicates(snapshot.facts, { includePinned: true });
  const clusters = plan.clusters.filter(cluster => cluster.identity.laneId === laneId);
  return {
    ordinary: folderCloseCandidates(
      clusters.flatMap(cluster => cluster.ordinaryCandidateIds),
      snapshot.tabsById,
      folderId,
    ),
    pinned: folderCloseCandidates(
      clusters.flatMap(cluster => cluster.pinnedCandidateIds),
      snapshot.tabsById,
      folderId,
      true,
    ),
  };
};

const supported = () =>
  typeof gBrowser.moveTabAfter === "function" &&
  typeof gBrowser.isTabGroupLabel === "function";

interface OriginalTargetEvent extends Event {
  readonly explicitOriginalTarget?: unknown;
}

export const installFolderGroupingMenuItem = (
  readIncludePinned: () => boolean,
): (() => void) => {
  const document = window.document;
  const menu = document.getElementById(MENU_ID);
  if (!menu || !window.MozXULElement) {
    console.error("[tab-deduplicator] folder context menu is unavailable");
    return () => {};
  }

  document.getElementById(ITEM_ID)?.remove();
  const fragment = window.MozXULElement.parseXULToFragment(
    `<menuitem id="${ITEM_ID}" hidden="true" disabled="true"/>`,
  );
  const anchor = document.getElementById(ANCHOR_ID);
  if (anchor?.parentElement === menu) {
    anchor.before(fragment);
  } else {
    menu.appendChild(fragment);
  }

  const item = document.getElementById(ITEM_ID);
  if (!item) {
    console.error("[tab-deduplicator] folder menu item insertion failed");
    return () => {};
  }

  let currentFolderId: string | null = null;

  const clearFolder = () => {
    currentFolderId = null;
    item.setAttribute("hidden", "true");
    item.setAttribute("disabled", "true");
  };

  const onShowing = (event: Event) => {
    if (event.target !== menu) {
      return;
    }

    try {
      const folder = resolveFolderContextTarget(
        (event as OriginalTargetEvent).explicitOriginalTarget,
        target => gBrowser.isTabGroupLabel?.(target) ?? false,
      );
      if (!folder) {
        clearFolder();
        return;
      }

      currentFolderId = folder.id;
      const isSupported = supported();
      const plan = isSupported
        ? currentFolderPlan(folder.id, readIncludePinned())
        : { moves: [], pinnedMoveCount: 0 };
      const next = folderGroupingMenuState({
        supported: isSupported,
        moveCount: plan.moves.length,
        pinnedMoveCount: plan.pinnedMoveCount,
      });
      item.setAttribute("label", next.label);
      item.toggleAttribute("disabled", next.disabled);
      item.removeAttribute("hidden");
    } catch (error) {
      item.setAttribute("label", "Group duplicate tabs (unavailable)");
      item.setAttribute("disabled", "true");
      item.removeAttribute("hidden");
      console.error("[tab-deduplicator] could not inspect folder duplicates", error);
    }
  };

  const onCommand = () => {
    const moveAfter = gBrowser.moveTabAfter;
    if (!currentFolderId || !supported() || !moveAfter) {
      return;
    }

    try {
      const plan = currentFolderPlan(currentFolderId, readIncludePinned());
      applyFolderMoves(plan.moves, plan.tabsById, (tab, anchor) =>
        moveAfter.call(gBrowser, tab, anchor),
      );
    } catch (error) {
      console.error("[tab-deduplicator] could not group folder duplicates", error);
    }
  };

  const onHidden = (event: Event) => {
    if (event.target === menu) {
      clearFolder();
    }
  };

  menu.addEventListener("popupshowing", onShowing);
  menu.addEventListener("popuphidden", onHidden);
  item.addEventListener("command", onCommand);

  return () => {
    menu.removeEventListener("popupshowing", onShowing);
    menu.removeEventListener("popuphidden", onHidden);
    item.removeEventListener("command", onCommand);
    item.remove();
  };
};

/**
 * `tabbrowser.js` 5309–5325 routes an explicit candidate list through
 * `_removeDuplicateTabs`, which performs Firefox's bulk-close warning, calls normal
 * `removeTabs`, and shows its built-in confirmation hint. Selection remains in the
 * pure duplicate plan; this adapter only hands Firefox the resulting live tabs.
 */
export const installFolderCloseMenuItem = (
  readIncludePinned: () => boolean,
): (() => void) => {
  const document = window.document;
  const menu = document.getElementById(MENU_ID);
  if (!menu || !window.MozXULElement) {
    console.error("[tab-deduplicator] folder context menu is unavailable");
    return () => {};
  }

  document.getElementById(CLOSE_ITEM_ID)?.remove();
  const fragment = window.MozXULElement.parseXULToFragment(
    `<menuitem id="${CLOSE_ITEM_ID}" hidden="true" disabled="true"/>`,
  );
  const groupItem = document.getElementById(ITEM_ID);
  const anchor = document.getElementById(ANCHOR_ID);
  if (groupItem?.parentElement === menu) {
    groupItem.after(fragment);
  } else if (anchor?.parentElement === menu) {
    anchor.before(fragment);
  } else {
    menu.appendChild(fragment);
  }

  const item = document.getElementById(CLOSE_ITEM_ID);
  if (!item) {
    console.error("[tab-deduplicator] folder close item insertion failed");
    return () => {};
  }

  let currentFolder: BrowserTabGroup | null = null;
  const supported = () =>
    typeof gBrowser._removeDuplicateTabs === "function" &&
    typeof gBrowser.closingTabsEnum?.DUPLICATES === "number" &&
    typeof gBrowser.isTabGroupLabel === "function";
  const promptSupported = () => {
    const prompt = Services.prompt;
    return (
      typeof prompt?.confirmEx === "function" &&
      typeof prompt.BUTTON_POS_0 === "number" &&
      typeof prompt.BUTTON_POS_1 === "number" &&
      typeof prompt.BUTTON_POS_2 === "number" &&
      typeof prompt.BUTTON_TITLE_IS_STRING === "number" &&
      typeof prompt.BUTTON_TITLE_CANCEL === "number" &&
      typeof prompt.BUTTON_POS_1_DEFAULT === "number"
    );
  };

  const clearFolder = () => {
    currentFolder = null;
    item.setAttribute("hidden", "true");
    item.setAttribute("disabled", "true");
  };

  const onShowing = (event: Event) => {
    if (event.target !== menu) {
      return;
    }
    try {
      const folder = resolveFolderContextTarget(
        (event as OriginalTargetEvent).explicitOriginalTarget,
        target => gBrowser.isTabGroupLabel?.(target) ?? false,
      );
      if (!folder) {
        clearFolder();
        return;
      }

      currentFolder = folder;
      const isSupported = supported();
      let candidateCount = 0;
      if (isSupported) {
        const candidates = currentFolderCloseCandidates(folder.id);
        const intent = closeIntent(readIncludePinned(), promptSupported(), candidates);
        candidateCount =
          intent.kind === "prompt"
            ? intent.ordinaryCount + intent.pinnedCount
            : intent.kind === "close-ordinary"
              ? candidates.ordinary.length
              : 0;
      }
      const next = folderCloseMenuState({ supported: isSupported, candidateCount });
      item.setAttribute("label", next.label);
      item.toggleAttribute("disabled", next.disabled);
      item.removeAttribute("hidden");
    } catch (error) {
      item.setAttribute("label", "Close duplicate tabs (unavailable)");
      item.setAttribute("disabled", "true");
      item.removeAttribute("hidden");
      console.error(
        "[tab-deduplicator] could not inspect folder close candidates",
        error,
      );
    }
  };

  const onCommand = () => {
    const close = gBrowser._removeDuplicateTabs;
    const closeType = gBrowser.closingTabsEnum?.DUPLICATES;
    if (!currentFolder || !close || typeof closeType !== "number") {
      return;
    }
    try {
      const folder = currentFolder;
      const initial = currentFolderCloseCandidates(folder.id);
      const prompt = Services.prompt;
      const hasPrompt = promptSupported();
      runPinnedClose({
        includePinned: readIncludePinned(),
        promptAvailable: hasPrompt,
        initial,
        refresh: () => currentFolderCloseCandidates(folder.id),
        prompt: counts =>
          hasPrompt && prompt ? confirmPinnedClose(counts, prompt, window) : "cancel",
        close: candidates => {
          closeFolderCandidates(folder, candidates, closeType, (anchor, tabs, type) =>
            close.call(gBrowser, anchor, tabs, type),
          );
        },
      });
    } catch (error) {
      console.error("[tab-deduplicator] could not close folder duplicates", error);
    }
  };

  const onHidden = (event: Event) => {
    if (event.target === menu) {
      clearFolder();
    }
  };

  menu.addEventListener("popupshowing", onShowing);
  menu.addEventListener("popuphidden", onHidden);
  item.addEventListener("command", onCommand);

  return () => {
    menu.removeEventListener("popupshowing", onShowing);
    menu.removeEventListener("popuphidden", onHidden);
    item.removeEventListener("command", onCommand);
    item.remove();
  };
};
