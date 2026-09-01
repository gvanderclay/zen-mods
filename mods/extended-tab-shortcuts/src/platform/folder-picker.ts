import type { FolderMoveDecision } from "../core/folder-move.ts";
import { decideFolderPickerKey } from "../core/folder-picker.ts";
import {
  createFolderFromSelectedTabs,
  getFolderMoveDecision,
  moveSelectedTabsToFolder,
} from "./folder-move.ts";
import {
  createFolderPickerView,
  PANEL_ID,
  renderFolderDestinations,
} from "./folder-picker-view.ts";

interface PanelMultiViewApi {
  hidePopup(panel: Element): void;
  openPopup(
    panel: Element,
    anchor: Element,
    position: string,
    x: number,
    y: number,
    isContextMenu: boolean,
    attributesOverride: boolean,
  ): Promise<boolean> | boolean;
  removePopup(panel: Element): void;
}

export interface FolderPickerDependencies {
  readonly actions: {
    readonly createFolder: (label: string) => boolean;
    readonly getDecision: () => FolderMoveDecision;
    readonly moveToFolder: (folderId: string) => boolean;
  };
  readonly document: Document;
  readonly panelMultiView: PanelMultiViewApi;
}

export interface FolderPicker {
  open(): Promise<boolean>;
  dispose(): void;
}

const isVisibleAnchor = (element: Element | null): element is Element => {
  if (!element?.isConnected) return false;
  if (!element.checkVisibility({ checkVisibilityCSS: true })) return false;
  const bounds = element.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0;
};

const anchorFor = (document: Document, activeId: string): Element | null => {
  const candidates = [
    document.getElementById(activeId),
    document.getElementById("tabs-newtab-button"),
    document.getElementById("zen-sidebar-top-buttons"),
    document.getElementById("urlbar-container"),
    document.getElementById("navigator-toolbox"),
  ];
  return candidates.find(isVisibleAnchor) ?? null;
};

const defaultDependencies = (): FolderPickerDependencies | null => {
  const panelMultiView = (window as unknown as { PanelMultiView?: PanelMultiViewApi })
    .PanelMultiView;
  if (!panelMultiView) return null;
  return {
    actions: {
      createFolder: label => createFolderFromSelectedTabs(label),
      getDecision: () => getFolderMoveDecision(),
      moveToFolder: folderId => moveSelectedTabsToFolder(folderId),
    },
    document: window.document,
    panelMultiView,
  };
};

// Firefox 154 PanelMultiView.sys.mjs 369–452, 602–752, 819–985, 1585–1694, 1961–2165.
export const installFolderPicker = (
  dependencies = defaultDependencies(),
): FolderPicker => {
  if (!dependencies) {
    return { dispose: () => {}, open: async () => false };
  }
  const { actions, document, panelMultiView } = dependencies;
  const popupSet = document.getElementById("mainPopupSet");
  if (!popupSet) {
    return { dispose: () => {}, open: async () => false };
  }

  const existing = document.getElementById(PANEL_ID);
  if (existing) panelMultiView.removePopup(existing);

  const {
    cancelButton,
    createButton,
    destinations,
    mainTitle,
    mainView,
    multiview,
    nameInput,
    newFolderButton,
    newView,
    panel,
  } = createFolderPickerView(document);
  popupSet.append(panel);

  const abortController = new AbortController();
  const signal = abortController.signal;
  let currentDecision: Extract<FolderMoveDecision, { kind: "ready" }> | null = null;
  let currentView: "destinations" | "new-folder" = "destinations";
  let focusedItem: HTMLElement | null = null;
  let destroyed = false;

  const hide = () => {
    if (!destroyed) panelMultiView.hidePopup(panel);
  };

  const performMove = (folderId: string) => {
    if (actions.moveToFolder(folderId)) hide();
  };

  const performCreate = () => {
    if (actions.createFolder(nameInput.value)) hide();
  };

  const pickerItems = () => [
    ...mainView.querySelectorAll<HTMLElement>("[data-folder-picker-item]"),
  ];

  const focusItem = (item: HTMLElement) => {
    focusedItem = item;
    Services.focus.setFocus(item, Services.focus.FLAG_BYKEY);
  };

  const focusRelative = (direction: -1 | 1) => {
    const items = pickerItems();
    if (items.length === 0) return;
    const current = focusedItem ? items.indexOf(focusedItem) : -1;
    const next =
      current < 0
        ? direction > 0
          ? 0
          : items.length - 1
        : (current + direction + items.length) % items.length;
    const item = items[next];
    if (item) focusItem(item);
  };

  const activateFocused = () => {
    const active = document.activeElement as HTMLElement | null;
    const item = active && pickerItems().includes(active) ? active : focusedItem;
    if (item && pickerItems().includes(item)) item.click();
  };

  const showNewFolder = () => {
    currentView = "new-folder";
    nameInput.value = "";
    createButton.disabled = true;
    multiview.showSubView(newView, newFolderButton);
  };

  newFolderButton.addEventListener("command", showNewFolder, { signal });
  nameInput.addEventListener(
    "input",
    () => {
      createButton.disabled = nameInput.value.trim().length === 0;
    },
    { signal },
  );
  cancelButton.addEventListener("click", () => multiview.goBack(), { signal });
  createButton.addEventListener("click", performCreate, { signal });
  mainView.addEventListener(
    "ViewShown",
    () => {
      currentView = "destinations";
      focusedItem = newFolderButton;
    },
    { signal },
  );
  newView.addEventListener(
    "ViewShown",
    () => {
      currentView = "new-folder";
      focusedItem = null;
      nameInput.focus();
    },
    { signal },
  );
  panel.addEventListener(
    "popupshown",
    event => {
      const first = pickerItems()[0];
      if (event.target === panel && first) focusItem(first);
    },
    { signal },
  );
  panel.addEventListener(
    "popuphidden",
    event => {
      if (event.target !== panel) return;
      currentView = "destinations";
      focusedItem = null;
      nameInput.value = "";
      createButton.disabled = true;
    },
    { signal },
  );

  document.documentElement.addEventListener(
    "keydown",
    event => {
      if (!(["open", "showing"] as const).includes(panel.state as "open" | "showing")) {
        return;
      }
      const decision = decideFolderPickerKey({
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        destinations: currentDecision?.destinations ?? [],
        key: event.key,
        metaKey: event.metaKey,
        newFolderName: nameInput.value,
        view: currentView,
      });
      if (decision.kind === "none") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      switch (decision.kind) {
        case "activate":
          activateFocused();
          break;
        case "close":
          hide();
          break;
        case "create":
          performCreate();
          break;
        case "go-back":
          multiview.goBack();
          break;
        case "move":
          performMove(decision.folderId);
          break;
        case "navigate":
          focusRelative(decision.direction);
          break;
        case "new-folder":
          showNewFolder();
          break;
      }
    },
    { capture: true, signal },
  );

  return {
    async open() {
      if (destroyed) return false;
      if (["open", "showing"].includes(panel.state ?? "")) {
        hide();
        return true;
      }
      const decision = actions.getDecision();
      if (decision.kind === "blocked") return false;
      const anchor = anchorFor(document, decision.activeId);
      if (!anchor) return false;
      currentDecision = decision;
      currentView = "destinations";
      focusedItem = null;
      mainTitle.textContent = `Move ${String(decision.tabIds.length)} ${
        decision.tabIds.length === 1 ? "Tab" : "Tabs"
      } to Folder`;
      renderFolderDestinations(
        document,
        destinations,
        decision.destinations,
        performMove,
        signal,
      );
      panel.removeAttribute("hidden");
      const tabsAreRight =
        document.documentElement.getAttribute("zen-right-side") === "true";
      return panelMultiView.openPopup(
        panel,
        anchor,
        tabsAreRight ? "leftcenter rightcenter" : "rightcenter leftcenter",
        0,
        0,
        false,
        false,
      );
    },
    dispose() {
      if (destroyed) return;
      destroyed = true;
      abortController.abort();
      panelMultiView.removePopup(panel);
      currentDecision = null;
    },
  };
};
