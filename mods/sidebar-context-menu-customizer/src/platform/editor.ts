import { createAnchoredEditorPanel } from "@zen-mods/browser-chrome-ui/anchored-editor-panel";
import {
  filterCustomizationActions,
  groupCustomizationActions,
  updateActionSelection,
} from "../core/policy.ts";
import { TAB_MENU_EDITOR_STYLES } from "./editor-styles.ts";

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const PANEL_ID = "sidebar-context-menu-customizer-editor-panel";
const ACTION_LIST_ID = `${PANEL_ID}-actions`;
const PROMOTION_COPY_LINKS_KEY = "promotion-copy-links";

type ActionFilter = "all" | "selected" | "unselected";

const filters: ReadonlyArray<{ id: ActionFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "selected", label: "Selected" },
  { id: "unselected", label: "Not selected" },
];

export interface EditableMenuAction {
  key: string;
  keys: string[];
  label: string;
  selected: boolean;
}

export interface TabMenuEditorOptions {
  document: Document;
  actions: () => EditableMenuAction[];
  readExcludedFromRootIds: () => Set<string>;
  writeExcludedFromRootIds: (ids: ReadonlySet<string>) => void;
  copyLinksIsPromoted: () => boolean;
  setCopyLinksPromoted: (promoted: boolean) => void;
}

export interface TabMenuEditor {
  open(anchor: Element): void;
  destroy(): void;
}

const htmlElement = <K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tagName: K,
) => document.createElementNS(XHTML_NAMESPACE, tagName) as HTMLElementTagNameMap[K];

const button = (document: Document, label: string, className: string) => {
  const node = htmlElement(document, "button");
  node.type = "button";
  node.className = className;
  node.textContent = label;
  return node;
};

const alphabetically = (left: EditableMenuAction, right: EditableMenuAction) =>
  left.label.localeCompare(right.label, undefined, {
    numeric: true,
    sensitivity: "base",
  }) || left.key.localeCompare(right.key);

export const createTabMenuEditor = ({
  document,
  actions,
  readExcludedFromRootIds,
  writeExcludedFromRootIds,
  copyLinksIsPromoted,
  setCopyLinksPromoted,
}: TabMenuEditorOptions): TabMenuEditor | null => {
  const ownerWindow = document.defaultView;
  let destroyed = false;
  let focusFrame: number | null = null;
  let focusEpoch = 0;
  let activeFilter: ActionFilter = "all";
  let visibleActions: EditableMenuAction[] = [];
  let render = (_focusKey?: string | null, _resetScroll?: boolean) => {};

  const cancelPendingFocus = () => {
    focusEpoch += 1;
    if (focusFrame !== null) {
      ownerWindow?.cancelAnimationFrame(focusFrame);
      focusFrame = null;
    }
  };

  const scheduleFocus = (callback: () => void) => {
    cancelPendingFocus();
    if (destroyed) {
      return;
    }
    const epoch = focusEpoch;
    if (!ownerWindow) {
      callback();
      return;
    }
    focusFrame = ownerWindow.requestAnimationFrame(() => {
      if (destroyed || epoch !== focusEpoch) {
        return;
      }
      focusFrame = null;
      callback();
    });
  };

  const panel = createAnchoredEditorPanel({
    document,
    id: PANEL_ID,
    title: "Customize tab menu",
    description:
      "Checked actions appear directly in the tab menu. Unchecked actions remain under More actions.",
    searchLabel: "Search tab menu actions",
    searchPlaceholder: "Search actions",
    styles: TAB_MENU_EDITOR_STYLES,
    onQueryChange: () => render(undefined, true),
    onClose: cancelPendingFocus,
  });
  if (!panel) {
    return null;
  }

  const status = htmlElement(document, "span");
  status.className = "sidebar-menu-editor-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const footerActions = htmlElement(document, "div");
  footerActions.className = "sidebar-menu-editor-footer-actions";
  const selectAll = button(document, "Select all", "sidebar-menu-editor-button");
  selectAll.title = "Put every action directly in the tab menu";
  const done = button(
    document,
    "Done",
    "sidebar-menu-editor-button sidebar-menu-editor-button-primary",
  );
  footerActions.append(selectAll, done);
  panel.footer.append(status, footerActions);

  const toolbar = htmlElement(document, "div");
  toolbar.className = "sidebar-menu-editor-toolbar";
  const filterGroup = htmlElement(document, "div");
  filterGroup.className = "sidebar-menu-editor-filters";
  filterGroup.setAttribute("role", "tablist");
  filterGroup.setAttribute("aria-label", "Filter tab menu actions");
  const filterButtons = new Map<ActionFilter, HTMLButtonElement>();
  const filterCounts = new Map<ActionFilter, HTMLElement>();

  const selectFilter = (filter: ActionFilter, focus: boolean) => {
    if (destroyed) {
      return;
    }
    activeFilter = filter;
    render(undefined, true);
    if (focus) {
      scheduleFocus(() => filterButtons.get(filter)?.focus());
    }
  };

  for (const filter of filters) {
    const tab = button(document, "", "sidebar-menu-editor-filter");
    tab.id = `${PANEL_ID}-filter-${filter.id}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", ACTION_LIST_ID);
    const label = htmlElement(document, "span");
    label.textContent = filter.label;
    const count = htmlElement(document, "span");
    count.className = "sidebar-menu-editor-filter-count";
    tab.append(label, count);
    tab.addEventListener("click", () => selectFilter(filter.id, false));
    tab.addEventListener("keydown", event => {
      const currentIndex = filters.findIndex(candidate => candidate.id === filter.id);
      let nextIndex: number | null = null;
      const rtl = document.documentElement.getAttribute("dir") === "rtl";
      if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = filters.length - 1;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const movesForward = (event.key === "ArrowRight") !== rtl;
        nextIndex =
          (currentIndex + (movesForward ? 1 : -1) + filters.length) % filters.length;
      }
      if (nextIndex === null) {
        return;
      }
      event.preventDefault();
      const nextFilter = filters[nextIndex];
      if (nextFilter) {
        selectFilter(nextFilter.id, true);
      }
    });
    filterButtons.set(filter.id, tab);
    filterCounts.set(filter.id, count);
    filterGroup.append(tab);
  }
  toolbar.append(filterGroup);

  const listRegion = htmlElement(document, "div");
  listRegion.className = "sidebar-menu-editor-list-region";
  panel.body.append(toolbar, listRegion);

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
      if (destroyed) {
        return;
      }
      const index = visibleActions.findIndex(candidate => candidate.key === action.key);
      const adjacent = visibleActions[index + 1] ?? visibleActions[index - 1];
      const focusKey = activeFilter === "all" ? action.key : (adjacent?.key ?? null);
      writeExcludedFromRootIds(
        updateActionSelection(readExcludedFromRootIds(), action.keys, !action.selected),
      );
      render(focusKey);
    });
    row.append(toggle);
    return row;
  };

  const promotionSection = () => {
    const section = htmlElement(document, "section");
    section.className = "sidebar-menu-editor-promotions";
    const heading = htmlElement(document, "div");
    heading.className = "sidebar-menu-editor-section-heading";
    const title = htmlElement(document, "h2");
    title.textContent = "From submenus";
    const note = htmlElement(document, "span");
    note.className = "sidebar-menu-editor-section-note";
    note.textContent = "Optional shortcuts";
    heading.append(title, note);

    const list = htmlElement(document, "div");
    list.className = "sidebar-menu-editor-list";
    list.setAttribute("role", "list");
    const row = htmlElement(document, "div");
    row.className = "sidebar-menu-editor-action";
    row.dataset.actionKey = PROMOTION_COPY_LINKS_KEY;
    row.setAttribute("role", "listitem");
    const promoted = copyLinksIsPromoted();
    const toggle = button(document, "", "sidebar-menu-editor-action-toggle");
    toggle.setAttribute("role", "checkbox");
    toggle.setAttribute("aria-checked", String(promoted));
    toggle.setAttribute("aria-label", "Show Copy Link shortcut directly in the tab menu");
    toggle.title = promoted
      ? "Remove shortcut from the main menu"
      : "Add shortcut to the main menu";
    const copy = htmlElement(document, "span");
    copy.className = "sidebar-menu-editor-promotion-copy";
    const label = htmlElement(document, "span");
    label.className = "sidebar-menu-editor-action-label";
    label.textContent = "Copy Link(s)";
    const detail = htmlElement(document, "span");
    detail.className = "sidebar-menu-editor-row-detail";
    detail.textContent = "Also show the Share command directly in the tab menu";
    copy.append(label, detail);
    toggle.append(checkMarker(), copy);
    toggle.addEventListener("click", () => {
      if (destroyed) {
        return;
      }
      setCopyLinksPromoted(!copyLinksIsPromoted());
      render(PROMOTION_COPY_LINKS_KEY);
    });
    row.append(toggle);
    list.append(row);
    section.append(heading, list);
    return section;
  };

  const focusAction = (key: string) => {
    const row = [...listRegion.querySelectorAll<HTMLElement>("[data-action-key]")].find(
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

  render = (focusKey, resetScroll = false) => {
    cancelPendingFocus();
    if (destroyed) {
      return;
    }
    const previousScroll = panel.body.scrollTop;
    const allActions = actions();
    const totals = groupCustomizationActions(allActions);
    const matching = filterCustomizationActions(allActions, panel.searchInput.value).sort(
      alphabetically,
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
      empty.textContent = panel.searchInput.value.trim()
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

    const content: HTMLElement[] = [list];
    const query = panel.searchInput.value.trim().toLocaleLowerCase();
    const promotionMatches =
      !query || "copy link links share submenu shortcut".includes(query);
    if (activeFilter === "all" && promotionMatches) {
      content.push(promotionSection());
    }
    listRegion.replaceChildren(...content);
    panel.body.scrollTop = resetScroll ? 0 : previousScroll;

    const counts: Record<ActionFilter, number> = {
      all: allActions.length,
      selected: totals.selected.length,
      unselected: totals.unselected.length,
    };
    for (const filter of filters) {
      const tab = filterButtons.get(filter.id);
      const count = filterCounts.get(filter.id);
      const selected = filter.id === activeFilter;
      tab?.setAttribute("aria-selected", String(selected));
      if (tab) {
        tab.tabIndex = selected ? 0 : -1;
        tab.setAttribute("aria-label", `${filter.label}, ${counts[filter.id]} actions`);
      }
      if (count) {
        count.textContent = String(counts[filter.id]);
      }
    }

    status.textContent = `${totals.selected.length} in tab menu · ${totals.unselected.length} in More actions`;
    selectAll.disabled = totals.unselected.length === 0;
    if (focusKey !== undefined) {
      scheduleFocus(() => {
        if (!focusKey || !focusAction(focusKey)) {
          filterButtons.get(activeFilter)?.focus();
        }
      });
    }
  };

  panel.searchInput.addEventListener("keydown", event => {
    if (destroyed) {
      return;
    }
    if (event.key !== "Escape" || !panel.searchInput.value) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    panel.searchInput.value = "";
    render(undefined, true);
  });
  panel.element.addEventListener("keydown", event => {
    if (destroyed) {
      return;
    }
    const keyboardEvent = event as KeyboardEvent;
    const target = keyboardEvent.target;
    const targetIsTextInput =
      target instanceof Element && ["input", "textarea"].includes(target.localName);
    const isSearchShortcut =
      keyboardEvent.key === "/" ||
      ((keyboardEvent.metaKey || keyboardEvent.ctrlKey) &&
        keyboardEvent.key.toLocaleLowerCase() === "f");
    if (!targetIsTextInput && isSearchShortcut) {
      keyboardEvent.preventDefault();
      panel.searchInput.focus();
    }
  });
  selectAll.addEventListener("click", () => {
    if (destroyed) {
      return;
    }
    writeExcludedFromRootIds(new Set());
    render();
  });
  done.addEventListener("click", () => {
    if (destroyed) {
      return;
    }
    cancelPendingFocus();
    panel.close();
  });

  return {
    open(anchor) {
      if (destroyed) {
        return;
      }
      activeFilter = "all";
      panel.searchInput.value = "";
      render(undefined, true);
      panel.open(anchor);
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      cancelPendingFocus();
      panel.destroy();
    },
  };
};
