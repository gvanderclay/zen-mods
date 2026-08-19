/** Drives one tab-menu opening; `PresentationSession` owns all restoration. */

import {
  type MenuPresentationPlan,
  planMenuPresentation,
  sortPresentationActions,
} from "../core/presentation.ts";
import {
  type PlatformPresentationSnapshot,
  readRootPresentation,
  snapshotNodes,
} from "./menu-inventory.ts";
import { PresentationSession } from "./presentation-session.ts";

export interface TabMenuPresentationOptions {
  moreActionsMenu: XulElement;
  moreActionsPopup: XulElement;
  readExcludedFromRootIds: () => Set<string> | null;
  root: XulElement;
  writeExcludedFromRootIds: (ids: ReadonlySet<string>) => void;
}

export interface TabMenuPresentation {
  close: () => void;
  open: () => void;
}

export const createTabMenuPresentation = ({
  moreActionsMenu,
  moreActionsPopup,
  readExcludedFromRootIds,
  root,
  writeExcludedFromRootIds,
}: TabMenuPresentationOptions): TabMenuPresentation => {
  let activeSession: PresentationSession | null = null;

  const currentRootSnapshot = (): PlatformPresentationSnapshot =>
    readRootPresentation(root, readExcludedFromRootIds, writeExcludedFromRootIds);

  const organizeMoreActions = (session: PresentationSession) => {
    const presentation = snapshotNodes(
      [...moreActionsPopup.children] as XulElement[],
      session.excludedFromRootIds,
    );
    session.recordActionKeys(presentation.nodes, presentation.snapshot.facts);
    const actionsInCurrentOrder = presentation.snapshot.facts.filter(
      fact => fact.kind === "action",
    );
    const actions = sortPresentationActions(actionsInCurrentOrder);
    const currentOrder = actionsInCurrentOrder.map(
      fact => presentation.nodes[fact.originalIndex] as XulElement,
    );
    const desiredOrder = actions.map(
      fact => presentation.nodes[fact.originalIndex] as XulElement,
    );
    if (desiredOrder.some((node, index) => currentOrder[index] !== node)) {
      moreActionsPopup.append(...desiredOrder);
    }
    moreActionsMenu.hidden = !actions.some(action => action.browserVisible);
  };

  const moveLateExcludedActions = (
    session: PresentationSession,
  ): PlatformPresentationSnapshot => {
    const presentation = snapshotNodes(
      [...root.children] as XulElement[],
      session.excludedFromRootIds,
    );
    session.recordActionKeys(presentation.nodes, presentation.snapshot.facts);
    session.mergeCurrentRootOrder(presentation.nodes);
    const lateActions = presentation.snapshot.facts
      .filter(fact => fact.kind === "action" && !fact.selected)
      .map(fact => presentation.nodes[fact.originalIndex] as XulElement);

    session.moveActions(lateActions);
    return presentation;
  };

  const applySeparatorPlan = (
    session: PresentationSession,
    nodes: readonly XulElement[],
    plan: MenuPresentationPlan,
  ) => {
    for (const originalIndex of plan.hiddenSeparatorIndexes) {
      const separator = nodes[originalIndex];
      if (separator?.localName === "menuseparator") {
        session.hideTemporarily(separator);
      }
    }
  };

  const moveExcludedActions = (
    session: PresentationSession,
    presentation: PlatformPresentationSnapshot,
  ) => {
    session.recordActionKeys(presentation.nodes, presentation.snapshot.facts);
    const plan = planMenuPresentation(presentation.snapshot.facts);
    const actionNodes = plan.moreActions.map(
      fact => presentation.nodes[fact.originalIndex] as XulElement,
    );

    session.moveActions(actionNodes);
    moreActionsMenu.hidden = !plan.moreActionsVisible;
    applySeparatorPlan(session, presentation.nodes, plan);
  };

  const updatePresentation = (
    session: PresentationSession,
    records: readonly MutationRecord[],
  ) => {
    if (activeSession !== session || session.closed) {
      return;
    }
    const rootChanged = records.some(record => record.target === root);
    const moreActionsChanged = records.some(record => record.target === moreActionsPopup);
    if (!rootChanged && !moreActionsChanged) {
      return;
    }

    if (rootChanged) {
      const presentation = moveLateExcludedActions(session);
      session.restoreSeparatorPresentation();
      applySeparatorPlan(
        session,
        presentation.nodes,
        planMenuPresentation(presentation.snapshot.facts),
      );
    }
    organizeMoreActions(session);

    // Moving an inserted action queues a root removal and a More-actions
    // insertion. The final DOM state has already been handled synchronously, so
    // discard those self-generated records instead of scheduling a feedback pass.
    session.discardObserverRecords();
  };

  return {
    close: () => {
      activeSession?.close();
      activeSession = null;
    },
    open: () => {
      const presentation = currentRootSnapshot();
      const session = new PresentationSession({
        excludedFromRootIds: presentation.snapshot.excludedFromRootIds,
        moreActionsMenu,
        moreActionsPopup,
        root,
        rootOrder: presentation.nodes,
      });
      activeSession = session;
      try {
        moveExcludedActions(session, presentation);
        const observer = new MutationObserver(records =>
          updatePresentation(session, records),
        );
        session.attachObserver(observer);
        observer.observe(root, { childList: true });
        observer.observe(moreActionsPopup, { childList: true });
      } catch (error) {
        session.close();
        if (activeSession === session) {
          activeSession = null;
        }
        throw error;
      }
    },
  };
};
