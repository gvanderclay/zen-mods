/**
 * The two surfaces in scope are verified in Zen's shipped `browser/omni.ja`:
 *
 * - `tabbrowser/tab.js` 132 assigns `#tabContextMenu` to every tab.
 * - `browser.xhtml` 553–676 declares that menu and its built-in actions.
 * - `main-popupset.js` 597–602 registers Firefox's context calculation before
 *   Sine loads user scripts.
 * - `ZenPinnedTabManager.mjs` 680–732 changes built-in and Zen item visibility for
 *   the current tab.
 * - `tabbrowser/tabbrowser.js` 10464–11010 computes the menu's context-sensitive
 *   `hidden` state during `popupshowing`; this mod runs after that calculation and
 *   leaves the live action state intact while changing its parent.
 * - `SharingUtils.sys.mjs` 43–109 creates the Share submenu and Copy Link(s). Its
 *   62–93 reuse path requires Share to stay directly after `context_moveTabOptions`;
 *   205–321 populates it for the current tabs, and 324–381 routes copying through
 *   Firefox's `BrowserUtils.copyLinks` implementation.
 * - `parent/ext-menus.js` 49–72 builds WebExtension items for each opening, while
 *   491–515 can replace them later in response to `menus.onShown` updates.
 * - Firefox `widget/cocoa/nsMenuX.mm` 1031–1070 dispatches `popupshowing`, and
 *   1143–1173 rebuilds the native menu when `hidden` changes.
 *
 * macOS native context menus are built from the live XUL tree and do not apply chrome
 * CSS. Root-excluded actions therefore move as live nodes into More actions after
 * Firefox computes their context, then return to their exact root order before the
 * next calculation, on popup close, and on teardown.
 */

import {
  coalesceCustomizationActions,
  copyLinksPromotionState,
  PROMOTION_COPY_LINKS,
} from "../core/policy.ts";
import {
  createPresentationSnapshot,
  type MenuPresentationPlan,
  type PresentationFact,
  type PresentationSnapshot,
  type PresentationSourceFact,
  planMenuPresentation,
  sortPresentationActions,
} from "../core/presentation.ts";
import { createTabMenuEditor } from "./editor.ts";
import {
  armSynchronousPopupFinalizer,
  PresentationSession,
} from "./presentation-session.ts";

const { SharingUtils } = ChromeUtils.importESModule(
  "resource:///modules/SharingUtils.sys.mjs",
);

const TAB_MENU_ID = "tabContextMenu";
const CUSTOMIZER_SEPARATOR_ID = "sidebar-context-menu-customizer-tab-separator";
const CUSTOMIZER_ITEM_ID = "sidebar-context-menu-customizer-tab-menu";
const MORE_ACTIONS_MENU_ID = "sidebar-context-menu-customizer-more-actions-menu";
const MORE_ACTIONS_POPUP_ID = "sidebar-context-menu-customizer-more-actions-popup";
const PROMOTED_COPY_LINKS_ID = "sidebar-context-menu-customizer-promoted-copy-links";

const ownIds = new Set([
  CUSTOMIZER_SEPARATOR_ID,
  CUSTOMIZER_ITEM_ID,
  MORE_ACTIONS_MENU_ID,
  MORE_ACTIONS_POPUP_ID,
  PROMOTED_COPY_LINKS_ID,
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

interface PlatformPresentationSnapshot {
  nodes: XulElement[];
  snapshot: PresentationSnapshot;
}

export const installTabMenuCustomizer = (
  readExcludedFromRootIds: () => Set<string> | null,
  writeExcludedFromRootIds: (ids: ReadonlySet<string>) => void,
  readPromotedIds: () => Set<string>,
  writePromotedIds: (ids: ReadonlySet<string>) => void,
): (() => void) => {
  const document = window.document;
  const tabMenu = document.getElementById(TAB_MENU_ID) as XulElement | null;
  if (!tabMenu || typeof document.createXULElement !== "function") {
    console.error("[sidebar-context-menu-customizer] tab context menu is unavailable");
    return () => {};
  }

  document.getElementById(CUSTOMIZER_SEPARATOR_ID)?.remove();
  document.getElementById(CUSTOMIZER_ITEM_ID)?.remove();
  document.getElementById(MORE_ACTIONS_MENU_ID)?.remove();
  document.getElementById(PROMOTED_COPY_LINKS_ID)?.remove();

  const promotedCopyLinks = document.createXULElement("menuitem");
  promotedCopyLinks.id = PROMOTED_COPY_LINKS_ID;
  promotedCopyLinks.classList.add("menuitem-iconic");
  promotedCopyLinks.setAttribute("image", "chrome://global/skin/icons/link.svg");
  promotedCopyLinks.hidden = true;
  tabMenu.append(promotedCopyLinks);

  const customizerSeparator = document.createXULElement("menuseparator");
  customizerSeparator.id = CUSTOMIZER_SEPARATOR_ID;
  const moreActionsMenu = document.createXULElement("menu");
  moreActionsMenu.id = MORE_ACTIONS_MENU_ID;
  moreActionsMenu.setAttribute("label", "More actions");
  const moreActionsPopup = document.createXULElement("menupopup");
  moreActionsPopup.id = MORE_ACTIONS_POPUP_ID;
  moreActionsMenu.append(moreActionsPopup);
  const customizerItem = document.createXULElement("menuitem");
  customizerItem.id = CUSTOMIZER_ITEM_ID;
  customizerItem.setAttribute("label", "Customize tab menu…");
  tabMenu.append(customizerSeparator, moreActionsMenu, customizerItem);

  let activeSession: PresentationSession | null = null;
  let cancelPendingFinalizer: (() => void) | null = null;

  const cancelFinalizer = () => {
    cancelPendingFinalizer?.();
    cancelPendingFinalizer = null;
  };

  const closePresentation = () => {
    activeSession?.close();
    activeSession = null;
  };

  const clearPresentation = () => {
    cancelFinalizer();
    closePresentation();
  };

  const snapshotNodes = (
    nodes: XulElement[],
    excludedFromRoot: ReadonlySet<string> | null,
  ): PlatformPresentationSnapshot => ({
    nodes,
    snapshot: createPresentationSnapshot(presentationSources(nodes), excludedFromRoot),
  });

  const currentRootSnapshot = (): PlatformPresentationSnapshot => {
    const presentation = snapshotNodes(
      [...tabMenu.children] as XulElement[],
      readExcludedFromRootIds(),
    );
    if (presentation.snapshot.initialized) {
      writeExcludedFromRootIds(presentation.snapshot.excludedFromRootIds);
    }
    return presentation;
  };

  const currentExcludedFromRootIds = () =>
    currentRootSnapshot().snapshot.excludedFromRootIds;

  const currentPromotedIds = () => new Set(readPromotedIds());

  const currentShareMenu = () => {
    const [primary, ...duplicates] = [
      ...tabMenu.querySelectorAll<XulElement>(".share-tab-url-item"),
    ];
    for (const duplicate of duplicates) {
      duplicate.remove();
    }
    return primary ?? null;
  };

  const updatePromotedCopyLinks = () => {
    const shareMenu = currentShareMenu();
    if (!shareMenu) {
      promotedCopyLinks.hidden = true;
      return;
    }

    // SharingUtils reuses Share only while it remains the immediate sibling after
    // context_moveTabOptions. Keeping the proxy after Share preserves that contract.
    shareMenu.after(promotedCopyLinks);
    const state = copyLinksPromotionState(
      currentPromotedIds(),
      SharingUtils.getLinksToShare(shareMenu).length,
    );
    document.l10n.setAttributes(promotedCopyLinks, "menu-share-copy-links", {
      count: state.labelCount,
    });
    promotedCopyLinks.toggleAttribute("disabled", state.disabled);
    promotedCopyLinks.hidden = !state.visible;
  };

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
      [...tabMenu.children] as XulElement[],
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
    const rootChanged = records.some(record => record.target === tabMenu);
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

  const createPresentationSession = () => {
    updatePromotedCopyLinks();
    const presentation = currentRootSnapshot();
    const session = new PresentationSession({
      excludedFromRootIds: presentation.snapshot.excludedFromRootIds,
      moreActionsMenu,
      moreActionsPopup,
      root: tabMenu,
      rootOrder: presentation.nodes,
    });
    activeSession = session;
    try {
      moveExcludedActions(session, presentation);
      const observer = new MutationObserver(records =>
        updatePresentation(session, records),
      );
      session.attachObserver(observer);
      observer.observe(tabMenu, { childList: true });
      observer.observe(moreActionsPopup, { childList: true });
    } catch (error) {
      session.close();
      if (activeSession === session) {
        activeSession = null;
      }
      throw error;
    }
  };

  const editorActions = () => {
    const presentation = currentRootSnapshot();
    const actions = presentation.snapshot.facts.filter(
      (fact): fact is PresentationFact => fact.kind === "action",
    );
    return coalesceCustomizationActions(actions).map(
      ({ key, keys, label, selected }) => ({ key, keys, label, selected }),
    );
  };

  const editor = createTabMenuEditor({
    document,
    actions: editorActions,
    readExcludedFromRootIds: currentExcludedFromRootIds,
    writeExcludedFromRootIds,
    copyLinksIsPromoted: () => currentPromotedIds().has(PROMOTION_COPY_LINKS),
    setCopyLinksPromoted: promoted => {
      const promotedIds = currentPromotedIds();
      if (promoted) {
        promotedIds.add(PROMOTION_COPY_LINKS);
      } else {
        promotedIds.delete(PROMOTION_COPY_LINKS);
      }
      writePromotedIds(promotedIds);
    },
  });
  if (!editor) {
    console.error("[sidebar-context-menu-customizer] editor panel is unavailable");
  }

  const ownerWindow = window;
  let destroyed = false;
  let editorOpenFrame: number | null = null;
  let editorOpenEpoch = 0;
  let editorAnchor: Element | null = null;

  const cancelDeferredEditorOpen = () => {
    editorOpenEpoch += 1;
    if (editorOpenFrame !== null) {
      ownerWindow.cancelAnimationFrame(editorOpenFrame);
      editorOpenFrame = null;
    }
  };

  const onBeforeShowing = (event: Event) => {
    if (!destroyed && event.target === tabMenu) {
      clearPresentation();
    }
  };

  const onShowing = (event: Event) => {
    if (!destroyed && event.target === tabMenu) {
      editorAnchor = window.TabContextMenu?.contextTab ?? null;
      // Zen's listener was registered during browser startup, before Sine loads
      // this mod. Arm the finalizer during target dispatch so it is appended after
      // every already-registered window listener and observes target/document/window
      // mutations synchronously before native Cocoa snapshots the finished event.
      cancelFinalizer();
      let cancel = () => {};
      cancel = armSynchronousPopupFinalizer(
        ownerWindow,
        event,
        () => {
          if (cancelPendingFinalizer === cancel) {
            cancelPendingFinalizer = null;
          }
          if (!destroyed) {
            createPresentationSession();
          }
        },
        callback => ownerWindow.queueMicrotask(callback),
      );
      cancelPendingFinalizer = cancel;
    }
  };

  const onHidden = (event: Event) => {
    if (!destroyed && event.target === tabMenu) {
      clearPresentation();
    }
  };

  const onCustomize = () => {
    if (destroyed) {
      return;
    }
    const anchor =
      editorAnchor ??
      ownerWindow.TabContextMenu?.contextTab ??
      document.getElementById("tabbrowser-tabs") ??
      document.documentElement;
    cancelDeferredEditorOpen();
    const epoch = editorOpenEpoch;
    editorOpenFrame = ownerWindow.requestAnimationFrame(() => {
      if (destroyed || epoch !== editorOpenEpoch) {
        return;
      }
      editorOpenFrame = null;
      editor?.open(anchor);
    });
  };

  const onPromotedCopyLinks = () => {
    const shareMenu = currentShareMenu();
    if (shareMenu) {
      SharingUtils.copyLink(shareMenu);
    }
  };

  tabMenu.addEventListener("popupshowing", onBeforeShowing, true);
  tabMenu.addEventListener("popupshowing", onShowing);
  tabMenu.addEventListener("popuphidden", onHidden);
  customizerItem.addEventListener("command", onCustomize);
  promotedCopyLinks.addEventListener("command", onPromotedCopyLinks);

  return () => {
    if (destroyed) {
      return;
    }
    destroyed = true;
    cancelDeferredEditorOpen();
    tabMenu.removeEventListener("popupshowing", onBeforeShowing, true);
    tabMenu.removeEventListener("popupshowing", onShowing);
    tabMenu.removeEventListener("popuphidden", onHidden);
    customizerItem.removeEventListener("command", onCustomize);
    promotedCopyLinks.removeEventListener("command", onPromotedCopyLinks);
    editorAnchor = null;
    editor?.destroy();
    clearPresentation();
    promotedCopyLinks.remove();
    customizerSeparator.remove();
    moreActionsMenu.remove();
    customizerItem.remove();
  };
};
