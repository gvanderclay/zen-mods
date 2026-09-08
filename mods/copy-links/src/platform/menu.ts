/**
 * Verified in Zen 1.22b's shipped `browser/omni.ja` and `omni.ja`:
 *
 * - `browser.xhtml` 559–679 defines `#tabContextMenu` and `#context_moveTabOptions`.
 * - `main-popupset.js` 664–670 registers `TabContextMenu.updateContextMenu` on
 *   `popupshowing` at `DOMContentLoaded`, before Sine loads user scripts.
 * - `tabbrowser/tab-context-menu.js` 1088–1099 asks `SharingUtils.ensureShareMenu`
 *   to insert Share after `#context_moveTabOptions` (classic layout) or after
 *   `#context_shareSelectedTabs` (alt layout); 351–385 runs
 *   `MenuSectionLayout.arrange` once per layout during that same `popupshowing`.
 * - `modules/MenuSectionLayout.sys.mjs` 166–190 throws when an unclaimed child sits
 *   before the last declared item and exempts the trailing run of an `open` section;
 *   `tab-context-menu.js` 125–126 and 284–285 declare `#tabContextMenu` open.
 * - `moz-src/browser/components/sharing/SharingUtils.sys.mjs` 44–75 reuses the anchor's
 *   immediate next sibling as the Share node, and 204–223 resolves the live links.
 *
 * The action rests at the end of the menu while it is closed, so Firefox's layout pass
 * ignores it, and moves after Share during `popupshowing`, after Firefox's own listener
 * has run. Sidebar Context Menu Customizer may subsequently move this live node
 * without replacing its command.
 */

import {
  copyLinksMenuState,
  linksAsPlainText,
  type ShareableLink,
} from "../core/links.ts";

const ITEM_ID = "copy-links-context-item";
const MENU_ID = "tabContextMenu";
const SHARE_ANCHOR_ID = "context_moveTabOptions";
const SHARE_MENU_CLASS = "share-tab-url-item";

export interface CopyLinksMenuDependencies {
  readonly copyText: (text: string) => void;
  readonly getLinksToShare: (shareMenu: Element) => readonly ShareableLink[];
  readonly report: (error: unknown) => void;
}

export const installCopyLinksMenuItem = ({
  copyText,
  getLinksToShare,
  report,
}: CopyLinksMenuDependencies): (() => void) => {
  const document = window.document;
  const menu = document.getElementById(MENU_ID);
  const anchor = document.getElementById(SHARE_ANCHOR_ID);
  if (!menu || !anchor || typeof document.createXULElement !== "function") {
    console.error("[copy-links] tab context menu is unavailable");
    return () => {};
  }

  document.getElementById(ITEM_ID)?.remove();
  const item = document.createXULElement("menuitem");
  item.id = ITEM_ID;
  let currentLinks: readonly ShareableLink[] = [];
  let destroyed = false;

  const currentShareMenu = () =>
    [...menu.children].find(child => child.classList.contains(SHARE_MENU_CLASS)) ?? null;

  const placeAfterShare = () => {
    const shareMenu = currentShareMenu();
    (shareMenu ?? anchor).after(item);
    return shareMenu;
  };

  const park = () => {
    menu.append(item);
  };

  const updateState = (shareableCount: number) => {
    const state = copyLinksMenuState(shareableCount);
    document.l10n.setAttributes(item, "menu-share-copy-links", {
      count: state.labelCount,
    });
    item.toggleAttribute("disabled", state.disabled);
  };

  const onShowing = (event: Event) => {
    if (destroyed || event.target !== menu) {
      return;
    }
    try {
      const shareMenu = placeAfterShare();
      currentLinks = shareMenu ? [...getLinksToShare(shareMenu)] : [];
      updateState(currentLinks.length);
    } catch (error) {
      currentLinks = [];
      updateState(0);
      report(error);
    }
  };

  const onHidden = (event: Event) => {
    if (!destroyed && event.target === menu) {
      park();
    }
  };

  const onCommand = () => {
    if (destroyed || currentLinks.length === 0) {
      return;
    }
    try {
      copyText(linksAsPlainText(currentLinks));
    } catch (error) {
      report(error);
    }
  };

  updateState(0);
  park();
  menu.addEventListener("popupshowing", onShowing);
  menu.addEventListener("popuphidden", onHidden);
  item.addEventListener("command", onCommand);

  return () => {
    if (destroyed) {
      return;
    }
    destroyed = true;
    menu.removeEventListener("popupshowing", onShowing);
    menu.removeEventListener("popuphidden", onHidden);
    item.removeEventListener("command", onCommand);
    item.remove();
    currentLinks = [];
  };
};
