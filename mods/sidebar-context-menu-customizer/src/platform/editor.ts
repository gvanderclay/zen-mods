import { createAnchoredEditorPanel } from "@zen-mods/browser-chrome-ui/anchored-editor-panel";
import { groupCustomizationActions } from "../core/policy.ts";
import {
  type ActionFilter,
  createActionList,
  type EditableMenuAction,
} from "./editor-action-list.ts";
import { ACTION_LIST_ID, button, htmlElement, PANEL_ID } from "./editor-dom.ts";
import TAB_MENU_EDITOR_STYLES from "./editor-styles.css";

const filters: ReadonlyArray<{ id: ActionFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "selected", label: "Selected" },
  { id: "unselected", label: "Not selected" },
];

export interface TabMenuEditorOptions {
  document: Document;
  actions: () => EditableMenuAction[];
  readExcludedFromRootIds: () => Set<string>;
  writeExcludedFromRootIds: (ids: ReadonlySet<string>) => void;
  onClose?: () => void;
}

export interface TabMenuEditor {
  open(anchor: Element): void;
  destroy(): void;
}

export const createTabMenuEditor = ({
  document,
  actions,
  readExcludedFromRootIds,
  writeExcludedFromRootIds,
  onClose,
}: TabMenuEditorOptions): TabMenuEditor | null => {
  const ownerWindow = document.defaultView;
  let destroyed = false;
  let focusFrame: number | null = null;
  let focusEpoch = 0;
  let activeFilter: ActionFilter = "all";
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
    title: "Customize context menu",
    description:
      "Checked actions appear directly in the tab menu. Unchecked actions remain under More actions.",
    searchLabel: "Search tab menu actions",
    searchPlaceholder: "Search actions",
    styles: TAB_MENU_EDITOR_STYLES,
    onQueryChange: () => render(undefined, true),
    onClose: () => {
      cancelPendingFocus();
      onClose?.();
    },
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

  const actionList = createActionList({
    document,
    region: listRegion,
    activeFilter: () => activeFilter,
    isDestroyed: () => destroyed,
    readExcludedFromRootIds,
    writeExcludedFromRootIds,
    requestRender: focusKey => render(focusKey),
  });

  render = (focusKey, resetScroll = false) => {
    cancelPendingFocus();
    if (destroyed) {
      return;
    }
    const previousScroll = panel.body.scrollTop;
    const allActions = actions();
    const totals = groupCustomizationActions(allActions);
    actionList.render(allActions, panel.searchInput.value);
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
        if (!focusKey || !actionList.focusAction(focusKey)) {
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
      onClose?.();
      panel.destroy();
    },
  };
};
