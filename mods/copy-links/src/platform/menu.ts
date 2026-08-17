/**
 * Verified in Zen 1.21.14b's shipped `browser/omni.ja`:
 *
 * - `browser.xhtml` 553–679 defines `#tabContextMenu` and
 *   `#context_moveTabOptions`.
 * - `main-popupset.js` 596–602 registers Firefox's context calculation before Sine
 *   loads user scripts.
 * - `tabbrowser/tabbrowser.js` 10464–10475 selects the context tab or multiselection,
 *   and 11002–11006 inserts Share immediately after `#context_moveTabOptions`.
 * - `SharingUtils.sys.mjs` 180–208 resolves the live shareable links.
 *
 * The action stays after Share so Firefox's immediate-sibling reuse contract remains
 * intact. Sidebar Context Menu Customizer may subsequently move this live node without
 * replacing its command.
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
  placeAfterShare();
  menu.addEventListener("popupshowing", onShowing);
  item.addEventListener("command", onCommand);

  return () => {
    if (destroyed) {
      return;
    }
    destroyed = true;
    menu.removeEventListener("popupshowing", onShowing);
    item.removeEventListener("command", onCommand);
    item.remove();
    currentLinks = [];
  };
};
