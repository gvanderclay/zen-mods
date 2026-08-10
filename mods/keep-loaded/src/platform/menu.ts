/**
 * The tab context-menu item. Privileged: touches the chrome DOM and `TabContextMenu`.
 *
 * Verified in `browser/omni.ja`: the menu is `#tabContextMenu` in `browser.xhtml`,
 * `TabContextMenu.contextTab` is set by `updateContextMenu` (`tabbrowser.js` 10448),
 * and `main-popupset.js` wires that to `popupshowing` during startup — so the
 * listener added here runs after it and sees the tab. See D014.
 */

import type { KeepMenuState } from "../core/policy.ts";
import { log } from "./log.ts";

const ITEM_ID = "keep-loaded-context-item";
const MENU_ID = "tabContextMenu";
/** Zen puts its own essentials items here too, so we land beside them. */
const ANCHOR_ID = "context_pinTab";

/**
 * @param isLive whether the exact controller generation still owns the item
 * @param state how the item should read for the tab the menu was opened on
 * @param toggle called on click, with the tab
 * @returns a disposer that takes the item and its listeners back out
 */
export const installKeepMenuItem = (
  isLive: () => boolean,
  state: (tab: BrowserTab) => KeepMenuState,
  toggle: (tab: BrowserTab) => void,
): (() => void) => {
  if (!isLive()) {
    return () => {};
  }
  const document = window.document;
  const menu = document.getElementById(MENU_ID);
  if (!menu || !window.MozXULElement) {
    log(`no #${MENU_ID} or MozXULElement — skipping the context-menu item`);
    return () => {};
  }

  // A reload that failed to dispose would otherwise stack duplicate items.
  document.getElementById(ITEM_ID)?.remove();

  const fragment = window.MozXULElement.parseXULToFragment(
    `<menuitem id="${ITEM_ID}" type="checkbox"/>`,
  );
  const anchor = document.getElementById(ANCHOR_ID);
  if (anchor) {
    anchor.before(fragment);
  } else {
    menu.appendChild(fragment);
  }

  const item = document.getElementById(ITEM_ID);
  if (!item) {
    log("context-menu item did not appear after insertion");
    return () => {};
  }

  const onShowing = (event: Event) => {
    if (!isLive()) {
      return;
    }
    // Submenus bubble popupshowing through the same node.
    if (event.target !== menu) {
      return;
    }
    const tab = TabContextMenu.contextTab;
    if (!tab) {
      item.hidden = true;
      return;
    }
    const next = state(tab);
    if (!isLive()) {
      return;
    }
    item.hidden = !tab.pinned;
    item.setAttribute("label", next.label);
    for (const [name, on] of [
      ["checked", next.checked],
      ["disabled", next.disabled],
    ] as const) {
      if (on) {
        item.setAttribute(name, "true");
      } else {
        item.removeAttribute(name);
      }
    }
  };

  const onCommand = () => {
    if (!isLive()) {
      return;
    }
    const tab = TabContextMenu.contextTab;
    if (tab && isLive()) {
      toggle(tab);
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
