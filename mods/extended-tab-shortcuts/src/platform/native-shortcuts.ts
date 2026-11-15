/**
 * Native shortcut surface: one owned keyset plus one real Tools submenu per window.
 *
 * Approved contract: notes/extended-tab-shortcuts/DECISIONS.md (D01, 2026-11-14).
 *
 * Installed platform evidence (Zen 1.24.1b, build 20261106124806, Gecko 159.0.1):
 * - `chrome/browser/content/browser/browser.xhtml:6665-6666` owns `menu#tools-menu` and
 *   `menupopup#menu_ToolsPopup` inside `menubar#main-menubar` (browser.xhtml:6376).
 * - `moz-src/browser/components/customkeys/CustomKeysParent.sys.mjs:85-121` discovers
 *   about:keyboard rows from `main-menubar menuitem[key]`, takes the enclosing menu label
 *   as the category, the item label as the title and the `key` attribute as the row id.
 * - `moz-src/browser/components/customkeys/CustomKeys.sys.mjs:119-149` observes keysets
 *   appended directly under the document or body and reapplies stored customizations to
 *   their direct key children, so the whole keyset is populated off-tree and appended once.
 * - `CustomKeys.sys.mjs:127-143` does not handle removals and never deletes stored
 *   configuration, so removing the owned nodes retains every browser customization.
 */
import { FOLDER_MOVE_SHORTCUT } from "./folder-shortcuts.ts";
import {
  CLEAR_SELECTION_SHORTCUT,
  nativeBindingAttributes,
  POP_OUT_SHORTCUT,
  SELECT_NEXT_ARROW_SHORTCUT,
  SELECT_NEXT_VIM_SHORTCUT,
  SELECT_PREVIOUS_ARROW_SHORTCUT,
  SELECT_PREVIOUS_VIM_SHORTCUT,
  type ShortcutDefinition,
} from "./shortcut.ts";
import {
  MOVE_NEXT_SPACE_ARROW_SHORTCUT,
  MOVE_NEXT_SPACE_VIM_SHORTCUT,
  MOVE_PREVIOUS_SPACE_ARROW_SHORTCUT,
  MOVE_PREVIOUS_SPACE_VIM_SHORTCUT,
} from "./space-shortcuts.ts";

export const SHORTCUT_MENU_LABEL = "Extended Tab Shortcuts";
export const SHORTCUT_MENU_ID = "extended-tab-shortcuts-menu";
export const SHORTCUT_MENU_POPUP_ID = "extended-tab-shortcuts-menu-popup";
export const SHORTCUT_MENU_SEPARATOR_ID = "extended-tab-shortcuts-menu-separator";
export const SHORTCUT_KEYSET_ID = "extended-tab-shortcuts-keyset";

export const shortcutMenuItemId = (shortcutId: string): string =>
  `extended-tab-shortcuts-menu-item-${shortcutId}`;

/** Approved D01 order: README table order with each alternate beside its action. */
export const SHORTCUT_MENU_ENTRIES: readonly ShortcutDefinition[] = [
  SELECT_NEXT_VIM_SHORTCUT,
  SELECT_NEXT_ARROW_SHORTCUT,
  SELECT_PREVIOUS_VIM_SHORTCUT,
  SELECT_PREVIOUS_ARROW_SHORTCUT,
  CLEAR_SELECTION_SHORTCUT,
  POP_OUT_SHORTCUT,
  MOVE_NEXT_SPACE_VIM_SHORTCUT,
  MOVE_NEXT_SPACE_ARROW_SHORTCUT,
  MOVE_PREVIOUS_SPACE_VIM_SHORTCUT,
  MOVE_PREVIOUS_SPACE_ARROW_SHORTCUT,
  FOLDER_MOVE_SHORTCUT,
];

export interface ShortcutSurfaceDependencies {
  readonly document: Document;
  readonly definitions: readonly ShortcutDefinition[];
}

/** Every DOM id this mod owns, checked before any mutation. */
export const ownedShortcutSurfaceIds = (
  definitions: readonly ShortcutDefinition[],
): readonly string[] => [
  SHORTCUT_KEYSET_ID,
  SHORTCUT_MENU_SEPARATOR_ID,
  SHORTCUT_MENU_ID,
  SHORTCUT_MENU_POPUP_ID,
  ...definitions.map(definition => shortcutMenuItemId(definition.id)),
  ...definitions.map(definition => definition.id),
];

const createKey = (document: Document, definition: ShortcutDefinition): XulElement => {
  const key = document.createXULElement("key");
  key.id = definition.id;
  key.setAttribute("command", definition.action);
  const attributes = nativeBindingAttributes(definition.defaultBinding);
  key.setAttribute("modifiers", attributes.modifiers);
  if (attributes.key) key.setAttribute("key", attributes.key);
  if (attributes.keycode) key.setAttribute("keycode", attributes.keycode);
  return key;
};

const createMenuItem = (
  document: Document,
  definition: ShortcutDefinition,
): XulElement => {
  const item = document.createXULElement("menuitem");
  item.id = shortcutMenuItemId(definition.id);
  item.setAttribute("label", definition.label);
  item.setAttribute("key", definition.id);
  item.setAttribute("command", definition.action);
  return item;
};

/**
 * Install one populated keyset and the approved Tools submenu together. Every owned id is
 * preflighted first, so a foreign same-id node rejects the whole registration atomically
 * instead of being replaced. Disposal removes only the nodes this call created.
 */
export const installShortcutSurface = ({
  document,
  definitions,
}: ShortcutSurfaceDependencies): (() => void) => {
  if (new Set(definitions.map(definition => definition.id)).size !== definitions.length) {
    throw new Error("shortcut IDs must be unique");
  }
  for (const id of ownedShortcutSurfaceIds(definitions)) {
    if (document.getElementById(id)) {
      throw new Error(`shortcut surface ID is already owned: ${id}`);
    }
  }
  const toolsPopup = document.getElementById("menu_ToolsPopup");
  const body = document.body;
  if (!toolsPopup || !body || typeof document.createXULElement !== "function") {
    throw new Error("Zen browser shortcut menu is unavailable");
  }

  const keyset = document.createXULElement("keyset");
  keyset.id = SHORTCUT_KEYSET_ID;
  for (const definition of definitions) {
    keyset.append(createKey(document, definition));
  }
  const separator = document.createXULElement("menuseparator");
  separator.id = SHORTCUT_MENU_SEPARATOR_ID;
  const menu = document.createXULElement("menu");
  menu.id = SHORTCUT_MENU_ID;
  menu.setAttribute("label", SHORTCUT_MENU_LABEL);
  const popup = document.createXULElement("menupopup");
  popup.id = SHORTCUT_MENU_POPUP_ID;
  for (const definition of definitions) {
    popup.append(createMenuItem(document, definition));
  }
  menu.append(popup);

  try {
    toolsPopup.append(separator, menu);
    body.append(keyset);
  } catch (error) {
    separator.remove();
    menu.remove();
    keyset.remove();
    throw error;
  }

  let destroyed = false;
  return () => {
    if (destroyed) return;
    destroyed = true;
    separator.remove();
    menu.remove();
    keyset.remove();
  };
};
