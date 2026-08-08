/**
 * Installs one action in Firefox's tab context menu, which is the menu Zen shows
 * for tabs in its sidebar. The menu is `#tabContextMenu` in `browser.xhtml` 553;
 * Zen inserts its own essential actions beside `#context_pinTab` in
 * `ZenPinnedTabManager.mjs` 625–661.
 */

import type { DedupeMenuState } from "../core/menu.ts";

const ITEM_ID = "tab-deduplicator-context-item";
const MENU_ID = "tabContextMenu";
const ANCHOR_ID = "context_closeDuplicateTabs";

export const installDedupeMenuItem = (
  readState: () => DedupeMenuState,
  run: (confirmationAnchor: unknown) => void,
): (() => void) => {
  const document = window.document;
  const menu = document.getElementById(MENU_ID);
  if (!menu || !window.MozXULElement) {
    console.error("[tab-deduplicator] tab context menu is unavailable");
    return () => {};
  }

  document.getElementById(ITEM_ID)?.remove();
  const fragment = window.MozXULElement.parseXULToFragment(`<menuitem id="${ITEM_ID}"/>`);
  const anchor = document.getElementById(ANCHOR_ID);
  if (anchor) {
    anchor.before(fragment);
  } else {
    menu.appendChild(fragment);
  }

  const item = document.getElementById(ITEM_ID);
  if (!item) {
    console.error("[tab-deduplicator] menu item insertion failed");
    return () => {};
  }

  const onShowing = (event: Event) => {
    if (event.target !== menu) {
      return;
    }
    try {
      const next = readState();
      item.setAttribute("label", next.label);
      item.toggleAttribute("disabled", next.disabled);
    } catch (error) {
      item.setAttribute("label", "Deduplicate tabs (unavailable)");
      item.setAttribute("disabled", "true");
      console.error("[tab-deduplicator] could not inspect tabs", error);
    }
  };

  const onCommand = () => {
    try {
      run(item);
    } catch (error) {
      console.error("[tab-deduplicator] could not close duplicate tabs", error);
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
