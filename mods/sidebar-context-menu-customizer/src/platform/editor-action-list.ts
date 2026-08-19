/** Filters actions and renders the editor's action rows; owns no focus or teardown state. */

import {
  compareCustomizationActions,
  filterCustomizationActions,
  updateActionSelection,
} from "../core/policy.ts";
import { ACTION_LIST_ID, button, htmlElement, PANEL_ID } from "./editor-dom.ts";

export type ActionFilter = "all" | "selected" | "unselected";

export interface EditableMenuAction {
  key: string;
  keys: string[];
  label: string;
  selected: boolean;
}

export interface ActionListOptions {
  document: Document;
  region: HTMLElement;
  activeFilter: () => ActionFilter;
  isDestroyed: () => boolean;
  readExcludedFromRootIds: () => Set<string>;
  writeExcludedFromRootIds: (ids: ReadonlySet<string>) => void;
  requestRender: (focusKey?: string | null) => void;
}

export interface ActionList {
  render(allActions: EditableMenuAction[], query: string): void;
  focusAction(key: string): boolean;
}

export const createActionList = ({
  document,
  region,
  activeFilter: currentFilter,
  isDestroyed,
  readExcludedFromRootIds,
  writeExcludedFromRootIds,
  requestRender,
}: ActionListOptions): ActionList => {
  let visibleActions: EditableMenuAction[] = [];

  const checkMarker = () => {
    const marker = htmlElement(document, "span");
    marker.className = "sidebar-menu-editor-check";
    marker.setAttribute("aria-hidden", "true");
    const icon = htmlElement(document, "img");
    icon.className = "sidebar-menu-editor-check-icon";
    icon.src = "chrome://global/skin/icons/check.svg";
    icon.alt = "";
    icon.setAttribute("role", "presentation");
    marker.append(icon);
    return marker;
  };

  const actionRow = (action: EditableMenuAction) => {
    const row = htmlElement(document, "div");
    row.className = "sidebar-menu-editor-action";
    row.dataset.actionKey = action.key;
    const toggle = button(document, "", "sidebar-menu-editor-action-toggle");
    toggle.setAttribute("role", "checkbox");
    toggle.setAttribute("aria-checked", String(action.selected));
    toggle.setAttribute("aria-label", `Show ${action.label} directly in the tab menu`);
    toggle.title = action.selected
      ? "Move to More actions"
      : "Show directly in the tab menu";
    const label = htmlElement(document, "span");
    label.className = "sidebar-menu-editor-action-label";
    label.textContent = action.label;
    toggle.append(checkMarker(), label);
    toggle.addEventListener("click", () => {
      if (isDestroyed()) {
        return;
      }
      const index = visibleActions.findIndex(candidate => candidate.key === action.key);
      const adjacent = visibleActions[index + 1] ?? visibleActions[index - 1];
      const focusKey = currentFilter() === "all" ? action.key : (adjacent?.key ?? null);
      writeExcludedFromRootIds(
        updateActionSelection(readExcludedFromRootIds(), action.keys, !action.selected),
      );
      requestRender(focusKey);
    });
    row.append(toggle);
    return row;
  };

  const render = (allActions: EditableMenuAction[], query: string) => {
    const activeFilter = currentFilter();
    const matching = filterCustomizationActions(allActions, query).sort(
      compareCustomizationActions,
    );
    visibleActions = matching.filter(action => {
      if (activeFilter === "selected") {
        return action.selected;
      }
      if (activeFilter === "unselected") {
        return !action.selected;
      }
      return true;
    });

    const list = htmlElement(document, "div");
    list.id = ACTION_LIST_ID;
    list.className = "sidebar-menu-editor-list";
    list.setAttribute("role", "tabpanel");
    list.setAttribute("aria-labelledby", `${PANEL_ID}-filter-${activeFilter}`);
    if (visibleActions.length === 0) {
      const empty = htmlElement(document, "p");
      empty.className = "sidebar-menu-editor-empty";
      empty.textContent = query.trim()
        ? "No matching actions"
        : activeFilter === "selected"
          ? "No actions are selected"
          : activeFilter === "unselected"
            ? "Every action is selected"
            : "No actions are available";
      list.append(empty);
    } else {
      list.append(...visibleActions.map(actionRow));
    }

    region.replaceChildren(list);
  };

  const focusAction = (key: string) => {
    const row = [...region.querySelectorAll<HTMLElement>("[data-action-key]")].find(
      candidate => candidate.dataset.actionKey === key,
    );
    const toggle = row?.querySelector<HTMLElement>(".sidebar-menu-editor-action-toggle");
    if (!toggle) {
      return false;
    }
    toggle.focus();
    row?.scrollIntoView({ block: "nearest" });
    return true;
  };

  return { render, focusAction };
};
