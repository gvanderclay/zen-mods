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
  actionPreferenceKey,
  coalesceCustomizationActions,
  copyLinksPromotionState,
  PROMOTION_COPY_LINKS,
  resolveExcludedFromRootIds,
  resolveMoreActions,
  separatorsToHide,
} from "../core/policy.ts";
import { createTabMenuEditor } from "./editor.ts";

const { SharingUtils } = ChromeUtils.importESModule(
  "resource:///modules/SharingUtils.sys.mjs",
);

const TAB_MENU_ID = "tabContextMenu";
const CUSTOMIZER_SEPARATOR_ID = "sidebar-context-menu-customizer-tab-separator";
const CUSTOMIZER_ITEM_ID = "sidebar-context-menu-customizer-tab-menu";
const MORE_ACTIONS_MENU_ID = "sidebar-context-menu-customizer-more-actions-menu";
const MORE_ACTIONS_POPUP_ID = "sidebar-context-menu-customizer-more-actions-popup";
const PROMOTED_COPY_LINKS_ID = "sidebar-context-menu-customizer-promoted-copy-links";
const EMPTY_SEPARATOR_ATTRIBUTE = "data-sidebar-context-menu-customizer-empty";

const ownIds = new Set([
  CUSTOMIZER_SEPARATOR_ID,
  CUSTOMIZER_ITEM_ID,
  MORE_ACTIONS_MENU_ID,
  MORE_ACTIONS_POPUP_ID,
  PROMOTED_COPY_LINKS_ID,
]);

const preferenceKey = (node: Element) =>
  actionPreferenceKey({
    id: node.id,
    l10nId: node.getAttribute("data-l10n-id") ?? node.getAttribute("data-lazy-l10n-id"),
    command: node.getAttribute("command"),
    className: node.getAttribute("class"),
  });

const isAction = (node: Element) =>
  (node.localName === "menu" || node.localName === "menuitem") &&
  !ownIds.has(node.id) &&
  preferenceKey(node) !== null;

const browserShows = (node: XulElement) => !node.hidden;

const fallbackLabel = (id: string) =>
  id
    .replace(/^context_/, "")
    .replace(/^zen-/, "")
    .replaceAll(/[-_]+/g, " ")
    .replaceAll(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, first => first.toUpperCase());

const itemLabel = (node: Element) =>
  node.getAttribute("label")?.trim() ||
  fallbackLabel(
    node.id ||
      node.getAttribute("data-l10n-id") ||
      node.getAttribute("data-lazy-l10n-id") ||
      preferenceKey(node) ||
      "action",
  );

const cleanSeparators = (
  menu: XulElement,
  hideTemporarily: (node: XulElement, attribute: string) => void,
) => {
  const nodes = [...menu.children] as XulElement[];
  const hiddenIndexes = separatorsToHide(
    nodes.map(node => ({
      kind: node.localName === "menuseparator" ? "separator" : "item",
      visible: browserShows(node),
    })),
  );

  for (const [index, node] of nodes.entries()) {
    if (node.localName !== "menuseparator") {
      continue;
    }
    if (hiddenIndexes.has(index)) {
      hideTemporarily(node, EMPTY_SEPARATOR_ATTRIBUTE);
    } else {
      node.removeAttribute(EMPTY_SEPARATOR_ATTRIBUTE);
    }
  }
};

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

  const browserHiddenStates = new Map<XulElement, boolean>();
  const movedActions = new Set<XulElement>();
  let rootOrderSnapshot: XulElement[] = [];
  let presentedExcludedFromRootIds = new Set<string>();
  let presentationActive = false;

  const restoreSeparatorPresentation = () => {
    for (const [node, hidden] of browserHiddenStates) {
      node.hidden = hidden;
      node.removeAttribute(EMPTY_SEPARATOR_ATTRIBUTE);
    }
    browserHiddenStates.clear();

    for (const node of tabMenu.children) {
      node.removeAttribute(EMPTY_SEPARATOR_ATTRIBUTE);
    }
  };

  const restoreMoreActions = () => {
    const stableBoundary = [customizerSeparator, moreActionsMenu, customizerItem].find(
      node => node.parentElement === tabMenu,
    );
    const boundaryIndex = stableBoundary ? rootOrderSnapshot.indexOf(stableBoundary) : -1;

    for (let index = rootOrderSnapshot.length - 1; index >= 0; index -= 1) {
      const node = rootOrderSnapshot[index];
      if (!node || !movedActions.has(node)) {
        continue;
      }
      if (node.parentElement !== moreActionsPopup) {
        continue;
      }

      const nextSurvivingSibling = rootOrderSnapshot
        .slice(index + 1)
        .find(candidate => candidate.parentElement === tabMenu);
      const fallbackBoundary =
        !nextSurvivingSibling &&
        stableBoundary?.parentElement === tabMenu &&
        boundaryIndex >= 0 &&
        index < boundaryIndex
          ? stableBoundary
          : null;
      tabMenu.insertBefore(node, nextSurvivingSibling ?? fallbackBoundary);
    }
    movedActions.clear();
    rootOrderSnapshot = [];
    presentedExcludedFromRootIds.clear();
    moreActionsMenu.hidden = true;
  };

  const clearPresentation = () => {
    presentationActive = false;
    presentationObserver.disconnect();
    presentationObserver.takeRecords();
    restoreMoreActions();
    restoreSeparatorPresentation();
  };

  const hideTemporarily = (node: XulElement, attribute: string) => {
    if (!browserHiddenStates.has(node)) {
      browserHiddenStates.set(node, node.hidden);
    }
    node.setAttribute(attribute, "true");
    node.hidden = true;
  };

  const currentExcludedFromRootIds = () => {
    const resolved = resolveExcludedFromRootIds(
      readExcludedFromRootIds(),
      [...tabMenu.children]
        .filter(isAction)
        .map(preferenceKey)
        .filter((key): key is string => key !== null),
    );
    if (resolved.initialized) {
      writeExcludedFromRootIds(resolved.ids);
    }
    return resolved.ids;
  };

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

  const moreActionFacts = () =>
    [...moreActionsPopup.children].flatMap(node => {
      if (!isAction(node)) {
        return [];
      }
      const key = preferenceKey(node);
      return key
        ? [
            {
              key,
              label: itemLabel(node),
              browserVisible: browserShows(node as XulElement),
              node: node as XulElement,
            },
          ]
        : [];
    });

  const organizeMoreActions = () => {
    const facts = moreActionFacts();
    const organized = resolveMoreActions(facts, new Set(facts.map(action => action.key)));
    const currentOrder = facts.map(action => action.node);
    const desiredOrder = organized.actions.map(action => action.node);
    if (desiredOrder.some((node, index) => currentOrder[index] !== node)) {
      moreActionsPopup.append(...desiredOrder);
    }
    moreActionsMenu.hidden = organized.visibleActions.length === 0;
  };

  const mergeCurrentRootOrder = () => {
    const rootChildren = [...tabMenu.children] as XulElement[];

    // WebExtension menus can replace a live node in response to menus.onShown.
    // Drop its disconnected predecessor so the replacement can occupy the
    // browser's newly chosen position in the restoration snapshot.
    for (const node of rootChildren) {
      if (rootOrderSnapshot.includes(node) || !isAction(node)) {
        continue;
      }
      const key = preferenceKey(node);
      if (!key) {
        continue;
      }
      const staleIndex = rootOrderSnapshot.findIndex(
        candidate =>
          candidate !== node &&
          !candidate.isConnected &&
          isAction(candidate) &&
          preferenceKey(candidate) === key,
      );
      if (staleIndex >= 0) {
        const [staleNode] = rootOrderSnapshot.splice(staleIndex, 1);
        if (staleNode) {
          movedActions.delete(staleNode);
        }
      }
    }

    // Merge direct-root additions right-to-left. This preserves batches inserted
    // both before a surviving browser sibling and after our stable tail controls,
    // even though previously excluded siblings are currently inside More actions.
    let anchorIndex: number | null = null;
    for (let index = rootChildren.length - 1; index >= 0; index -= 1) {
      const node = rootChildren[index];
      if (!node) {
        continue;
      }
      const existingIndex = rootOrderSnapshot.indexOf(node);
      if (existingIndex >= 0) {
        anchorIndex = existingIndex;
        continue;
      }
      const insertionIndex: number = anchorIndex ?? rootOrderSnapshot.length;
      rootOrderSnapshot.splice(insertionIndex, 0, node);
      anchorIndex = insertionIndex;
    }
  };

  const moveLateExcludedActions = () => {
    mergeCurrentRootOrder();
    const lateActions = [...tabMenu.children].filter(node => {
      if (!isAction(node)) {
        return false;
      }
      const key = preferenceKey(node);
      return key !== null && presentedExcludedFromRootIds.has(key);
    }) as XulElement[];

    for (const node of lateActions) {
      movedActions.add(node);
      moreActionsPopup.append(node);
    }
  };

  const moveExcludedActions = (excludedFromRoot: ReadonlySet<string>) => {
    const rootChildren = [...tabMenu.children] as XulElement[];
    rootOrderSnapshot = [...rootChildren];
    presentedExcludedFromRootIds = new Set(excludedFromRoot);
    const organized = resolveMoreActions(
      rootChildren.flatMap(node => {
        if (!isAction(node)) {
          return [];
        }
        const key = preferenceKey(node);
        return key
          ? [
              {
                key,
                label: itemLabel(node),
                browserVisible: browserShows(node),
                node,
              },
            ]
          : [];
      }),
      excludedFromRoot,
    );

    for (const { node } of organized.actions) {
      movedActions.add(node);
    }
    moreActionsPopup.append(...organized.actions.map(({ node }) => node));
    moreActionsMenu.hidden = organized.visibleActions.length === 0;
  };

  const presentationObserver = new MutationObserver(records => {
    if (!presentationActive) {
      return;
    }
    const rootChanged = records.some(record => record.target === tabMenu);
    const moreActionsChanged = records.some(record => record.target === moreActionsPopup);
    if (!rootChanged && !moreActionsChanged) {
      return;
    }

    if (rootChanged) {
      moveLateExcludedActions();
      restoreSeparatorPresentation();
      cleanSeparators(tabMenu, hideTemporarily);
    }
    organizeMoreActions();

    // Moving an inserted action queues a root removal and a More-actions
    // insertion. The final DOM state has already been handled synchronously, so
    // discard those self-generated records instead of scheduling a feedback pass.
    presentationObserver.takeRecords();
  });

  const observePresentation = () => {
    presentationActive = true;
    presentationObserver.observe(tabMenu, { childList: true });
    presentationObserver.observe(moreActionsPopup, { childList: true });
  };

  const refreshPresentation = () => {
    clearPresentation();
    updatePromotedCopyLinks();
    moveExcludedActions(currentExcludedFromRootIds());
    cleanSeparators(tabMenu, hideTemporarily);
    observePresentation();
  };

  const editorActions = () => {
    const excludedFromRoot = currentExcludedFromRootIds();
    const actions = [...tabMenu.children].flatMap(source => {
      if (!isAction(source)) {
        return [];
      }
      const key = preferenceKey(source);
      return key
        ? [{ key, label: itemLabel(source), selected: !excludedFromRoot.has(key) }]
        : [];
    });
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
      // this mod, so its context calculation has completed by this listener.
      // Native Cocoa menu construction snapshots the resulting XUL state after
      // popupshowing dispatch, making synchronous application important here.
      refreshPresentation();
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
