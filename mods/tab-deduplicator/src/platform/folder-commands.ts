import type { DuplicateMove } from "../core/duplicates.ts";
import { planDuplicates } from "../core/duplicates.ts";
import { runCloseReview } from "../core/review.ts";
import { buildCurrentCloseReview } from "./review.ts";
import type { CloseReviewPresenter } from "./review-dialog.ts";
import {
  enclosingZenFolder,
  folderLaneId,
  isSplitViewTab,
  snapshotDuplicateTabs,
} from "./snapshot.ts";

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

/** Mirrors `ZenFolders.mjs` 100–147 in Zen's shipped `browser/omni.ja`. */
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

/** Rejects split-view moves per `tabbrowser.js` 7354–7473, 7384–7393 in `browser/omni.ja`. */
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

export const closeCurrentFolderDuplicates = (
  folder: BrowserTabGroup,
  includePinned: boolean,
  presenter: CloseReviewPresenter,
  isLive: () => boolean,
  closeType: number,
  close: (anchor: unknown, tabs: BrowserTab[], type: number) => void,
) => {
  const request = {
    scope: "folder" as const,
    laneId: folderLaneId(folder.id),
    allowPinnedClose: includePinned,
  };
  return runCloseReview({
    initial: buildCurrentCloseReview(request),
    refresh: () => buildCurrentCloseReview(request),
    present: (review, status) => presenter.show(review, status),
    close: candidates => {
      closeFolderCandidates(folder, candidates, closeType, close);
    },
    isLive,
  });
};

interface FolderPlan {
  moves: DuplicateMove[];
  tabsById: Map<string, BrowserTab>;
  pinnedMoveCount: number;
}

export const currentFolderPlan = (
  folderId: string,
  includePinned: boolean,
): FolderPlan => {
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
