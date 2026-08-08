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
 *   `hidden` state during `popupshowing`; this mod runs after that calculation,
 *   saves it, and restores it when the popup closes.
 * - `SharingUtils.sys.mjs` 43–109 creates the Share submenu and Copy Link(s). Its
 *   62–93 reuse path requires Share to stay directly after `context_moveTabOptions`;
 *   205–321 populates it for the current tabs, and 324–381 routes copying through
 *   Firefox's `BrowserUtils.copyLinks` implementation.
 * - Firefox `widget/cocoa/nsMenuX.mm` 1031–1070 dispatches `popupshowing`, and
 *   1143–1173 rebuilds the native menu when `hidden` changes.
 *
 * macOS native context menus are built from XUL state and do not apply chrome CSS.
 * The user layer therefore has to use the same `hidden` property as Firefox, while
 * treating every write as a temporary presentation override.
 */

import {
  actionPreferenceKey,
  coalesceCustomizationActions,
  copyLinksPromotionState,
  groupCustomizationActions,
  PROMOTION_COPY_LINKS,
  resolveHiddenIds,
  separatorsToHide,
} from "../core/policy.ts";

const { SharingUtils } = ChromeUtils.importESModule(
  "resource:///modules/SharingUtils.sys.mjs",
);

const TAB_MENU_ID = "tabContextMenu";
const CUSTOMIZER_SEPARATOR_ID = "sidebar-context-menu-customizer-tab-separator";
const CUSTOMIZER_MENU_ID = "sidebar-context-menu-customizer-tab-menu";
const CUSTOMIZER_POPUP_ID = "sidebar-context-menu-customizer-tab-popup";
const RESET_SEPARATOR_ID = "sidebar-context-menu-customizer-reset-separator";
const RESET_ID = "sidebar-context-menu-customizer-reset";
const PROMOTE_MENU_ID = "sidebar-context-menu-customizer-promote-menu";
const PROMOTE_POPUP_ID = "sidebar-context-menu-customizer-promote-popup";
const PROMOTE_SHARE_MENU_ID = "sidebar-context-menu-customizer-promote-share-menu";
const PROMOTE_SHARE_POPUP_ID = "sidebar-context-menu-customizer-promote-share-popup";
const PROMOTE_COPY_LINKS_TOGGLE_ID =
  "sidebar-context-menu-customizer-promote-copy-links-toggle";
const PROMOTED_COPY_LINKS_ID = "sidebar-context-menu-customizer-promoted-copy-links";
const SELECTED_HEADING_ID = "sidebar-context-menu-customizer-selected-heading";
const UNSELECTED_HEADING_ID = "sidebar-context-menu-customizer-unselected-heading";
const TARGET_ATTRIBUTE = "data-sidebar-context-menu-customizer-target";
const PROMOTION_TARGET_ATTRIBUTE =
  "data-sidebar-context-menu-customizer-promotion-target";
const USER_HIDDEN_ATTRIBUTE = "data-sidebar-context-menu-customizer-hidden";
const EMPTY_SEPARATOR_ATTRIBUTE = "data-sidebar-context-menu-customizer-empty";

const ownIds = new Set([
  CUSTOMIZER_SEPARATOR_ID,
  CUSTOMIZER_MENU_ID,
  CUSTOMIZER_POPUP_ID,
  RESET_SEPARATOR_ID,
  RESET_ID,
  PROMOTE_MENU_ID,
  PROMOTE_POPUP_ID,
  PROMOTE_SHARE_MENU_ID,
  PROMOTE_SHARE_POPUP_ID,
  PROMOTE_COPY_LINKS_TOGGLE_ID,
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

const applyHiddenItems = (
  menu: XulElement,
  hiddenIds: ReadonlySet<string>,
  hideTemporarily: (node: XulElement, attribute: string) => void,
) => {
  for (const node of menu.children) {
    const key = isAction(node) ? preferenceKey(node) : null;
    if (key && hiddenIds.has(key)) {
      hideTemporarily(node as XulElement, USER_HIDDEN_ATTRIBUTE);
    } else {
      node.removeAttribute(USER_HIDDEN_ATTRIBUTE);
    }
  }
};

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

const checkboxFor = (
  document: Document,
  source: Element,
  targetIds: readonly string[],
  selected: boolean,
) => {
  const checkbox = document.createXULElement("menuitem");
  checkbox.setAttribute("type", "checkbox");
  checkbox.setAttribute("closemenu", "none");
  const l10nId =
    source.getAttribute("data-l10n-id") ?? source.getAttribute("data-lazy-l10n-id");
  if (source.getAttribute("label") || !l10nId) {
    checkbox.setAttribute("label", itemLabel(source));
  } else {
    checkbox.setAttribute("data-l10n-id", l10nId);
  }
  checkbox.setAttribute(TARGET_ATTRIBUTE, JSON.stringify(targetIds));
  checkbox.toggleAttribute("checked", selected);
  return checkbox;
};

const targetIdsFor = (node: Element): string[] => {
  try {
    const parsed: unknown = JSON.parse(node.getAttribute(TARGET_ATTRIBUTE) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
};

const headingFor = (document: Document, id: string, label: string) => {
  const heading = document.createXULElement("menuitem");
  heading.id = id;
  heading.setAttribute("label", label);
  heading.setAttribute("disabled", "true");
  return heading;
};

export const installTabMenuCustomizer = (
  readHiddenIds: () => Set<string> | null,
  writeHiddenIds: (ids: ReadonlySet<string>) => void,
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
  document.getElementById(CUSTOMIZER_MENU_ID)?.remove();
  document.getElementById(PROMOTED_COPY_LINKS_ID)?.remove();

  const promotedCopyLinks = document.createXULElement("menuitem");
  promotedCopyLinks.id = PROMOTED_COPY_LINKS_ID;
  promotedCopyLinks.classList.add("menuitem-iconic");
  promotedCopyLinks.setAttribute("image", "chrome://global/skin/icons/link.svg");
  promotedCopyLinks.hidden = true;
  tabMenu.append(promotedCopyLinks);

  const customizerSeparator = document.createXULElement("menuseparator");
  customizerSeparator.id = CUSTOMIZER_SEPARATOR_ID;
  const customizerMenu = document.createXULElement("menu");
  customizerMenu.id = CUSTOMIZER_MENU_ID;
  customizerMenu.setAttribute("label", "Customize tab menu");
  const customizerPopup = document.createXULElement("menupopup");
  customizerPopup.id = CUSTOMIZER_POPUP_ID;
  customizerMenu.append(customizerPopup);
  tabMenu.append(customizerSeparator, customizerMenu);

  const browserHiddenStates = new Map<XulElement, boolean>();
  const observer = new MutationObserver(records => {
    const hiddenIds = currentHiddenIds();
    for (const { target } of records) {
      const node = target as XulElement;
      const key = isAction(node) ? preferenceKey(node) : null;
      if (!key || !hiddenIds.has(key)) {
        continue;
      }

      // Firefox can finish asynchronous menu updates after popupshowing. Keep
      // the user's choice applied, but remember the browser's newer value so
      // teardown restores the truth rather than the earlier snapshot.
      browserHiddenStates.set(node, node.hidden);
      node.hidden = true;
    }
    observer.takeRecords();
  });

  const stopObserving = () => {
    observer.disconnect();
    observer.takeRecords();
  };

  const clearPresentation = () => {
    stopObserving();
    for (const [node, hidden] of browserHiddenStates) {
      node.hidden = hidden;
      node.removeAttribute(USER_HIDDEN_ATTRIBUTE);
      node.removeAttribute(EMPTY_SEPARATOR_ATTRIBUTE);
    }
    browserHiddenStates.clear();

    for (const node of tabMenu.children) {
      node.removeAttribute(USER_HIDDEN_ATTRIBUTE);
      node.removeAttribute(EMPTY_SEPARATOR_ATTRIBUTE);
    }
  };

  const hideTemporarily = (node: XulElement, attribute: string) => {
    if (!browserHiddenStates.has(node)) {
      browserHiddenStates.set(node, node.hidden);
    }
    node.setAttribute(attribute, "true");
    node.hidden = true;
  };

  const currentHiddenIds = () => {
    const resolved = resolveHiddenIds(
      readHiddenIds(),
      [...tabMenu.children]
        .filter(isAction)
        .map(preferenceKey)
        .filter((key): key is string => key !== null),
    );
    if (resolved.initialized) {
      writeHiddenIds(resolved.ids);
    }
    return resolved.ids;
  };

  const currentPromotedIds = () => new Set(readPromotedIds());

  const currentShareMenu = () => {
    const [primary, ...duplicates] = [...tabMenu.children].filter(node =>
      node.classList.contains("share-tab-url-item"),
    );
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

  const refreshPresentation = () => {
    clearPresentation();
    updatePromotedCopyLinks();
    applyHiddenItems(tabMenu, currentHiddenIds(), hideTemporarily);
    cleanSeparators(tabMenu, hideTemporarily);
    observer.observe(tabMenu, {
      attributes: true,
      attributeFilter: ["hidden"],
      subtree: false,
    });
  };

  const rebuildCustomizer = () => {
    const hiddenIds = currentHiddenIds();
    const promotedIds = currentPromotedIds();
    customizerPopup.replaceChildren();

    const actions = [...tabMenu.children].flatMap(source => {
      if (!isAction(source)) {
        return [];
      }
      const key = preferenceKey(source);
      return key
        ? [{ key, label: itemLabel(source), selected: !hiddenIds.has(key), source }]
        : [];
    });
    const grouped = groupCustomizationActions(coalesceCustomizationActions(actions));
    const appendGroup = (
      headingId: string,
      headingLabel: string,
      group: typeof grouped.selected,
    ) => {
      if (group.length === 0) {
        return;
      }
      if (customizerPopup.childElementCount > 0) {
        customizerPopup.append(document.createXULElement("menuseparator"));
      }
      customizerPopup.append(headingFor(document, headingId, headingLabel));
      for (const action of group) {
        const representative = action.actions[0];
        if (representative) {
          customizerPopup.append(
            checkboxFor(document, representative.source, action.keys, action.selected),
          );
        }
      }
    };
    appendGroup(SELECTED_HEADING_ID, "Selected", grouped.selected);
    appendGroup(UNSELECTED_HEADING_ID, "Not selected", grouped.unselected);

    if (customizerPopup.childElementCount > 0) {
      customizerPopup.append(document.createXULElement("menuseparator"));
    }

    const promoteMenu = document.createXULElement("menu");
    promoteMenu.id = PROMOTE_MENU_ID;
    promoteMenu.setAttribute("label", "Promote from submenu");
    const promotePopup = document.createXULElement("menupopup");
    promotePopup.id = PROMOTE_POPUP_ID;
    promoteMenu.append(promotePopup);

    const promoteShareMenu = document.createXULElement("menu");
    promoteShareMenu.id = PROMOTE_SHARE_MENU_ID;
    promoteShareMenu.setAttribute("label", "Share");
    const promoteSharePopup = document.createXULElement("menupopup");
    promoteSharePopup.id = PROMOTE_SHARE_POPUP_ID;
    promoteShareMenu.append(promoteSharePopup);

    const copyLinksToggle = document.createXULElement("menuitem");
    copyLinksToggle.id = PROMOTE_COPY_LINKS_TOGGLE_ID;
    copyLinksToggle.setAttribute("type", "checkbox");
    copyLinksToggle.setAttribute("closemenu", "none");
    copyLinksToggle.setAttribute("label", "Copy Link(s)");
    copyLinksToggle.setAttribute(PROMOTION_TARGET_ATTRIBUTE, PROMOTION_COPY_LINKS);
    copyLinksToggle.toggleAttribute("checked", promotedIds.has(PROMOTION_COPY_LINKS));
    promoteSharePopup.append(copyLinksToggle);
    promotePopup.append(promoteShareMenu);

    customizerPopup.append(promoteMenu);

    const resetSeparator = document.createXULElement("menuseparator");
    resetSeparator.id = RESET_SEPARATOR_ID;
    const reset = document.createXULElement("menuitem");
    reset.id = RESET_ID;
    reset.setAttribute("label", "Show all actions");
    reset.setAttribute("closemenu", "none");
    reset.toggleAttribute("disabled", hiddenIds.size === 0);
    customizerPopup.append(resetSeparator, reset);
  };

  const onBeforeShowing = (event: Event) => {
    if (event.target === tabMenu) {
      clearPresentation();
    }
  };

  const onShowing = (event: Event) => {
    if (event.target === tabMenu) {
      // Zen's listener was registered during browser startup, before Sine loads
      // this mod, so its context calculation has completed by this listener.
      // Native Cocoa menu construction snapshots the resulting XUL state after
      // popupshowing dispatch, making synchronous application important here.
      refreshPresentation();
    } else if (event.target === customizerPopup) {
      rebuildCustomizer();
    }
  };

  const onHidden = (event: Event) => {
    if (event.target === tabMenu) {
      clearPresentation();
    }
  };

  const onCommand = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const promotionId = target.getAttribute(PROMOTION_TARGET_ATTRIBUTE);
    if (promotionId) {
      const promotedIds = currentPromotedIds();
      if (promotedIds.has(promotionId)) {
        promotedIds.delete(promotionId);
      } else {
        promotedIds.add(promotionId);
      }
      writePromotedIds(promotedIds);
      target.toggleAttribute("checked", promotedIds.has(promotionId));
      refreshPresentation();
      return;
    }

    const hiddenIds = currentHiddenIds();
    if (target.id === RESET_ID) {
      hiddenIds.clear();
    } else {
      const sourceIds = targetIdsFor(target).filter(id => !ownIds.has(id));
      if (sourceIds.length === 0) {
        return;
      }
      const selected = sourceIds.some(id => !hiddenIds.has(id));
      if (selected) {
        for (const id of sourceIds) {
          hiddenIds.add(id);
        }
      } else {
        for (const id of sourceIds) {
          hiddenIds.delete(id);
        }
      }
      target.toggleAttribute("checked", !selected);
    }

    writeHiddenIds(hiddenIds);
    refreshPresentation();
    if (target.id === RESET_ID) {
      rebuildCustomizer();
    }
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
  customizerPopup.addEventListener("command", onCommand);
  promotedCopyLinks.addEventListener("command", onPromotedCopyLinks);

  return () => {
    tabMenu.removeEventListener("popupshowing", onBeforeShowing, true);
    tabMenu.removeEventListener("popupshowing", onShowing);
    tabMenu.removeEventListener("popuphidden", onHidden);
    customizerPopup.removeEventListener("command", onCommand);
    promotedCopyLinks.removeEventListener("command", onPromotedCopyLinks);
    clearPresentation();
    promotedCopyLinks.remove();
    customizerSeparator.remove();
    customizerMenu.remove();
  };
};
