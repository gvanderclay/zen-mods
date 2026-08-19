/**
 * Space grouping uses the same `gBrowser.tabs` current-space boundary and
 * `moveTabAfter` path cited in `snapshot.ts` and `folder-commands.ts`. Every planned
 * move is checked against the tab's live lane immediately before execution, so a stale
 * tab cannot cross a folder or the top-level pinned/ordinary boundary. `tabbrowser.js`
 * 7395–7444 also keeps essential and ordinary pinned sections separate, so moves
 * between those sections are rejected rather than silently landing elsewhere.
 * `browser.xhtml` 613–641 places `#context_moveTabOptions` in the move section.
 */

import type { DuplicateMove } from "../core/duplicates.ts";
import { planDuplicates } from "../core/duplicates.ts";
import { type DedupeMenuState, dedupeMenuState } from "../core/menu.ts";
import { runCloseReview } from "../core/review.ts";
import { spaceGroupingMenuState } from "../core/space-menu.ts";
import { buildCurrentCloseReview } from "./review.ts";
import type { CloseReviewPresenter } from "./review-dialog.ts";
import { isSplitViewTab, snapshotDuplicateTabs, tabLaneId } from "./snapshot.ts";

const ITEM_ID = "tab-deduplicator-group-space";
const MENU_ID = "tabContextMenu";
const MOVE_TAB_ANCHOR_ID = "context_moveTabOptions";

interface PlannedCloseCandidate {
  id: string;
  laneId: string;
}

export const spaceCloseCandidates = (
  planned: readonly PlannedCloseCandidate[],
  tabsById: ReadonlyMap<string, BrowserTab>,
  pinned: boolean,
) => {
  const candidates: BrowserTab[] = [];
  const seen = new Set<string>();
  for (const candidate of planned) {
    if (seen.has(candidate.id)) {
      continue;
    }
    seen.add(candidate.id);
    const tab = tabsById.get(candidate.id);
    if (
      tab &&
      tab.pinned === pinned &&
      !tab.hasAttribute("zen-essential") &&
      tabLaneId(tab) === candidate.laneId
    ) {
      candidates.push(tab);
    }
  }
  return candidates;
};

const spaceCloseSupported = () =>
  typeof gBrowser._removeDuplicateTabs === "function" &&
  typeof gBrowser.closingTabsEnum?.DUPLICATES === "number";

export const currentSpaceCloseMenuState = (includePinned: boolean): DedupeMenuState => {
  const isSupported = spaceCloseSupported();
  if (!isSupported) {
    return dedupeMenuState({ supported: false, duplicateCount: 0 });
  }
  const review = buildCurrentCloseReview({
    scope: "space",
    allowPinnedClose: includePinned,
  }).review;
  const duplicateCount = review.ordinaryCount + review.pinnedChoiceCount;
  return dedupeMenuState({ supported: true, duplicateCount });
};

export const closeCurrentSpaceDuplicates = (
  includePinned: boolean,
  confirmationAnchor: unknown,
  presenter: CloseReviewPresenter,
  isLive: () => boolean,
) => {
  // `tabbrowser.js` 5309–5325 accepts an explicit candidate list, retains Firefox's
  // warning and `removeTabs` path, then provides its existing confirmation feedback.
  const close = gBrowser._removeDuplicateTabs;
  const closeType = gBrowser.closingTabsEnum?.DUPLICATES;
  if (!close || typeof closeType !== "number") {
    return false;
  }
  const request = { scope: "space" as const, allowPinnedClose: includePinned };
  return runCloseReview({
    initial: buildCurrentCloseReview(request),
    refresh: () => buildCurrentCloseReview(request),
    present: (review, status) => presenter.show(review, status),
    close: candidates => close.call(gBrowser, confirmationAnchor, candidates, closeType),
    isLive,
  });
};

const validSpaceMove = (
  move: DuplicateMove,
  tabsById: ReadonlyMap<string, BrowserTab>,
) => {
  const tab = tabsById.get(move.tabId);
  const anchor = tabsById.get(move.afterTabId);
  if (!tab || !anchor || isSplitViewTab(tab) || isSplitViewTab(anchor)) {
    return null;
  }
  if (tab.hasAttribute("zen-essential") !== anchor.hasAttribute("zen-essential")) {
    return null;
  }
  if (tabLaneId(tab) !== move.laneId || tabLaneId(anchor) !== move.laneId) {
    return null;
  }
  return { tab, anchor };
};

const executableSpaceMoves = (
  moves: readonly DuplicateMove[],
  tabsById: ReadonlyMap<string, BrowserTab>,
) => moves.filter(move => validSpaceMove(move, tabsById) !== null);

export const applySpaceMoves = (
  moves: readonly DuplicateMove[],
  tabsById: ReadonlyMap<string, BrowserTab>,
  moveAfter: (tab: BrowserTab, anchor: BrowserTab) => void,
) => {
  let moved = 0;
  for (const move of moves) {
    const live = validSpaceMove(move, tabsById);
    if (!live) {
      continue;
    }
    moveAfter(live.tab, live.anchor);
    moved += 1;
  }
  return moved;
};

interface SpacePlan {
  moves: DuplicateMove[];
  tabsById: Map<string, BrowserTab>;
  pinnedMoveCount: number;
}

const currentSpacePlan = (includePinned: boolean): SpacePlan => {
  const snapshot = snapshotDuplicateTabs();
  const plan = planDuplicates(snapshot.facts, { includePinned });
  const moves = executableSpaceMoves(plan.moves, snapshot.tabsById);
  if (includePinned || moves.length > 0) {
    return { moves, tabsById: snapshot.tabsById, pinnedMoveCount: 0 };
  }

  const withPinned = planDuplicates(snapshot.facts, { includePinned: true });
  return {
    moves,
    tabsById: snapshot.tabsById,
    pinnedMoveCount: executableSpaceMoves(withPinned.moves, snapshot.tabsById).length,
  };
};

export const installSpaceGroupingMenuItem = (
  readIncludePinned: () => boolean,
): (() => void) => {
  const document = window.document;
  const menu = document.getElementById(MENU_ID);
  if (!menu || !window.MozXULElement) {
    console.error("[tab-deduplicator] tab context menu is unavailable");
    return () => {};
  }

  document.getElementById(ITEM_ID)?.remove();
  const fragment = window.MozXULElement.parseXULToFragment(`<menuitem id="${ITEM_ID}"/>`);
  const anchor = document.getElementById(MOVE_TAB_ANCHOR_ID);
  if (anchor?.parentElement === menu) {
    anchor.before(fragment);
  } else {
    menu.appendChild(fragment);
  }

  const item = document.getElementById(ITEM_ID);
  if (!item) {
    console.error("[tab-deduplicator] space grouping item insertion failed");
    return () => {};
  }

  const supported = () => typeof gBrowser.moveTabAfter === "function";

  const onShowing = (event: Event) => {
    if (event.target !== menu) {
      return;
    }
    try {
      const isSupported = supported();
      const plan = isSupported
        ? currentSpacePlan(readIncludePinned())
        : { moves: [], pinnedMoveCount: 0 };
      const next = spaceGroupingMenuState({
        supported: isSupported,
        moveCount: plan.moves.length,
        pinnedMoveCount: plan.pinnedMoveCount,
      });
      item.setAttribute("label", next.label);
      item.toggleAttribute("disabled", next.disabled);
    } catch (error) {
      item.setAttribute("label", "Group Duplicate Tabs");
      item.setAttribute("disabled", "true");
      console.error("[tab-deduplicator] could not inspect space duplicates", error);
    }
  };

  const onCommand = () => {
    const moveAfter = gBrowser.moveTabAfter;
    if (!moveAfter) {
      return;
    }
    try {
      const plan = currentSpacePlan(readIncludePinned());
      applySpaceMoves(plan.moves, plan.tabsById, (tab, anchor) =>
        moveAfter.call(gBrowser, tab, anchor),
      );
    } catch (error) {
      console.error("[tab-deduplicator] could not group space duplicates", error);
    }
  };

  menu.addEventListener("popupshowing", onShowing);
  item.addEventListener("command", onCommand);

  return () => {
    menu.removeEventListener("popupshowing", onShowing);
    item.removeEventListener("command", onCommand);
    item.remove();
  };
};
