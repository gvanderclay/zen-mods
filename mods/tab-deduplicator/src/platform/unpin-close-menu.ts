/**
 * Installs beside Firefox's native unpin action in the tab context menu.
 *
 * Verified in Zen's shipped `tabbrowser.js`:
 *
 * - Lines 10464–10475 capture the trigger tab and multiselection before Sine's
 *   popup listener runs.
 * - Lines 10792–10796 show `#context_unpinTab` only for one pinned context tab.
 *
 * The extra essential and live-target checks below keep this more destructive action
 * narrower than Zen's ordinary unpin command.
 */

import { unpinCloseMenuState } from "../core/unpin-close-menu.ts";
import { closeBrowserPinnedTab, runContextUnpinClose } from "./unpin-close.ts";

const ITEM_ID = "tab-deduplicator-unpin-close-pinned";
const MENU_ID = "tabContextMenu";
const UNPIN_ANCHOR_ID = "context_unpinTab";
const PIN_ANCHOR_ID = "context_pinTab";

const browserSupported = () =>
  typeof gBrowser.runBeforeUnloadForTabs === "function" &&
  typeof gBrowser.unpinTab === "function" &&
  typeof gBrowser.removeTabs === "function";

export const installUnpinCloseMenuItem = (): (() => void) => {
  const document = window.document;
  const menu = document.getElementById(MENU_ID);
  if (!menu || !window.MozXULElement) {
    console.error("[tab-deduplicator] tab context menu is unavailable");
    return () => {};
  }

  document.getElementById(ITEM_ID)?.remove();
  const fragment = window.MozXULElement.parseXULToFragment(
    `<menuitem id="${ITEM_ID}" label="Unpin and close pinned tab…" hidden="true" disabled="true"/>`,
  );
  const unpinAnchor = document.getElementById(UNPIN_ANCHOR_ID);
  const pinAnchor = document.getElementById(PIN_ANCHOR_ID);
  const anchor = unpinAnchor?.parentElement === menu ? unpinAnchor : pinAnchor;
  if (anchor?.parentElement === menu) {
    anchor.after(fragment);
  } else {
    menu.appendChild(fragment);
  }

  const item = document.getElementById(ITEM_ID);
  if (!item) {
    console.error("[tab-deduplicator] unpin-and-close item insertion failed");
    return () => {};
  }

  let currentTarget: BrowserTab | null = null;

  const clearTarget = () => {
    currentTarget = null;
    item.setAttribute("hidden", "true");
    item.setAttribute("disabled", "true");
  };

  const onShowing = (event: Event) => {
    if (event.target !== menu) {
      return;
    }
    try {
      const target = window.TabContextMenu?.contextTab ?? null;
      const state = unpinCloseMenuState({
        supported: browserSupported(),
        hasContextTab: target !== null,
        live:
          target !== null && gBrowser.tabs.includes(target) && target.closing !== true,
        pinned: target?.pinned === true,
        essential: target?.hasAttribute("zen-essential") === true,
        multiselected:
          window.TabContextMenu?.multiselected === true || target?.multiselected === true,
      });
      currentTarget = state.hidden ? null : target;
      item.setAttribute("label", state.label);
      item.toggleAttribute("hidden", state.hidden);
      item.toggleAttribute("disabled", state.disabled);
    } catch (error) {
      clearTarget();
      console.error("[tab-deduplicator] could not inspect unpin-and-close target", error);
    }
  };

  const onCommand = () => {
    const target = currentTarget;
    if (!target || !browserSupported()) {
      return;
    }
    void runContextUnpinClose(target, closeBrowserPinnedTab).catch(error => {
      console.error("[tab-deduplicator] could not unpin and close tab", error);
    });
  };

  const onHidden = (event: Event) => {
    if (event.target === menu) {
      clearTarget();
    }
  };

  menu.addEventListener("popupshowing", onShowing);
  menu.addEventListener("popuphidden", onHidden);
  item.addEventListener("command", onCommand);

  return () => {
    menu.removeEventListener("popupshowing", onShowing);
    menu.removeEventListener("popuphidden", onHidden);
    item.removeEventListener("command", onCommand);
    item.remove();
  };
};
