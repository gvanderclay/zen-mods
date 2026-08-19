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
 * - `parent/ext-menus.js` 49–72 builds WebExtension items for each opening, while
 *   491–515 can replace them later in response to `menus.onShown` updates.
 * - Firefox `widget/cocoa/nsMenuX.mm` 1031–1070 dispatches `popupshowing`, and
 *   1143–1173 rebuilds the native menu when `hidden` changes.
 * - `ZenCompactMode.mjs` 217–250 and `ZenHasPolyfill.mjs` 17–83 keep compact sidebar descendants with `open` visible.
 *
 * macOS native context menus are built from the live XUL tree and do not apply chrome
 * CSS. Root-excluded actions therefore move as live nodes into More actions after
 * Firefox computes their context, then return to their exact root order before the
 * next calculation, on popup close, and on teardown.
 */

import { createTabMenuEditor } from "./editor.ts";
import {
  COMPACT_MODE_MARKER_ID,
  CUSTOMIZER_ITEM_ID,
  CUSTOMIZER_SEPARATOR_ID,
  editorActionRows,
  MORE_ACTIONS_MENU_ID,
  MORE_ACTIONS_POPUP_ID,
  readRootPresentation,
  TAB_MENU_ID,
} from "./menu-inventory.ts";
import { createTabMenuPresentation } from "./menu-presentation.ts";
import { armSynchronousPopupFinalizer } from "./presentation-session.ts";

export const installTabMenuCustomizer = (
  readExcludedFromRootIds: () => Set<string> | null,
  writeExcludedFromRootIds: (ids: ReadonlySet<string>) => void,
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
  document.getElementById(COMPACT_MODE_MARKER_ID)?.remove();

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
  customizerItem.setAttribute("label", "Customize context menu…");
  tabMenu.append(customizerSeparator, moreActionsMenu, customizerItem);

  const compactModeMarker = document.createXULElement("box");
  compactModeMarker.id = COMPACT_MODE_MARKER_ID;
  compactModeMarker.hidden = true;
  document.getElementById("navigator-toolbox")?.append(compactModeMarker);

  const releaseCompactMode = () => {
    compactModeMarker.removeAttribute("open");
  };

  const presentation = createTabMenuPresentation({
    moreActionsMenu,
    moreActionsPopup,
    readExcludedFromRootIds,
    root: tabMenu,
    writeExcludedFromRootIds,
  });
  let cancelPendingFinalizer: (() => void) | null = null;

  const cancelFinalizer = () => {
    cancelPendingFinalizer?.();
    cancelPendingFinalizer = null;
  };

  const clearPresentation = () => {
    cancelFinalizer();
    presentation.close();
  };

  const currentRootPresentation = () =>
    readRootPresentation(tabMenu, readExcludedFromRootIds, writeExcludedFromRootIds);

  const editor = createTabMenuEditor({
    document,
    actions: () => editorActionRows(currentRootPresentation()),
    readExcludedFromRootIds: () => currentRootPresentation().snapshot.excludedFromRootIds,
    writeExcludedFromRootIds,
    onClose: releaseCompactMode,
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
            presentation.open();
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
    if (destroyed || !editor) {
      return;
    }
    if (document.documentElement.getAttribute("zen-compact-mode") === "true") {
      compactModeMarker.setAttribute("open", "true");
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

  tabMenu.addEventListener("popupshowing", onBeforeShowing, true);
  tabMenu.addEventListener("popupshowing", onShowing);
  tabMenu.addEventListener("popuphidden", onHidden);
  customizerItem.addEventListener("command", onCustomize);

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
    editorAnchor = null;
    releaseCompactMode();
    editor?.destroy();
    clearPresentation();
    customizerSeparator.remove();
    moreActionsMenu.remove();
    customizerItem.remove();
    compactModeMarker.remove();
  };
};
