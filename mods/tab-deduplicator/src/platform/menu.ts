/**
 * Firefox defines `#tabContextMenu` in `browser.xhtml` 553 and the tabbar-only
 * `#toolbar-context-menu` block at 1185–1224. Zen inserts New Folder and Live Folder
 * into the latter in `ZenFolders.mjs` 67–98.
 */

import type { DedupeMenuState } from "../core/menu.ts";

const ITEM_ID = "tab-deduplicator-context-item";
const MENU_ID = "tabContextMenu";
const ANCHOR_ID = "context_closeDuplicateTabs";
const TOOLBAR_ITEM_ID = "tab-deduplicator-toolbar-context-item";
const TOOLBAR_MENU_ID = "toolbar-context-menu";
const TOOLBAR_ANCHOR_ID = "toolbar-context-undoCloseTab";

interface MenuActionOptions {
  readonly anchorId: string;
  readonly confirmationAnchor: (item: Element) => unknown;
  readonly contextType?: string;
  readonly itemId: string;
  readonly menuId: string;
}

const installMenuAction = (
  options: MenuActionOptions,
  readState: () => DedupeMenuState,
  run: (confirmationAnchor: unknown) => unknown | Promise<unknown>,
): (() => void) => {
  const document = window.document;
  const menu = document.getElementById(options.menuId);
  if (!menu || !window.MozXULElement) {
    console.error("[tab-deduplicator] context menu is unavailable");
    return () => {};
  }

  document.getElementById(options.itemId)?.remove();
  const contextType = options.contextType ? ` contexttype="${options.contextType}"` : "";
  const fragment = window.MozXULElement.parseXULToFragment(
    `<menuitem id="${options.itemId}"${contextType}/>`,
  );
  const anchor = document.getElementById(options.anchorId);
  if (anchor?.parentElement === menu) {
    anchor.before(fragment);
  } else {
    menu.appendChild(fragment);
  }

  const item = document.getElementById(options.itemId);
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
    const confirmationAnchor = options.confirmationAnchor(item);
    void Promise.resolve()
      .then(() => run(confirmationAnchor))
      .catch(error => {
        console.error("[tab-deduplicator] could not close duplicate tabs", error);
      });
  };

  menu.addEventListener("popupshowing", onShowing);
  item.addEventListener("command", onCommand);

  return () => {
    menu.removeEventListener("popupshowing", onShowing);
    item.removeEventListener("command", onCommand);
    item.remove();
  };
};

export const installDedupeMenuItem = (
  readState: () => DedupeMenuState,
  run: (confirmationAnchor: unknown) => unknown | Promise<unknown>,
): (() => void) =>
  installMenuAction(
    {
      anchorId: ANCHOR_ID,
      confirmationAnchor: item => window.TabContextMenu?.contextTab ?? item,
      itemId: ITEM_ID,
      menuId: MENU_ID,
    },
    readState,
    run,
  );

export const installEmptySidebarDedupeMenuItem = (
  readState: () => DedupeMenuState,
  run: (confirmationAnchor: unknown) => unknown | Promise<unknown>,
): (() => void) =>
  installMenuAction(
    {
      anchorId: TOOLBAR_ANCHOR_ID,
      confirmationAnchor: item => item,
      contextType: "tabbar",
      itemId: TOOLBAR_ITEM_ID,
      menuId: TOOLBAR_MENU_ID,
    },
    readState,
    run,
  );
