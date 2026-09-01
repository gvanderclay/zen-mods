import type { FolderMoveDestination } from "../core/folder-move.ts";

export const PANEL_ID = "extended-tab-shortcuts-folder-panel";

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const FOLDER_ICON = "chrome://browser/skin/zen-icons/folder.svg";

export interface PopupPanelElement extends HTMLElement {
  readonly state?: string;
}

export interface PanelMultiViewElement extends HTMLElement {
  goBack(): void;
  showSubView(view: Element, anchor: Element): void;
}

interface MozButtonElement extends HTMLElement {
  disabled: boolean;
  label: string;
}

export interface FolderPickerView {
  readonly cancelButton: MozButtonElement;
  readonly createButton: MozButtonElement;
  readonly destinations: HTMLElement;
  readonly mainTitle: HTMLSpanElement;
  readonly mainView: HTMLElement;
  readonly multiview: PanelMultiViewElement;
  readonly nameInput: HTMLInputElement;
  readonly newFolderButton: HTMLElement;
  readonly newView: HTMLElement;
  readonly panel: PopupPanelElement;
}

const xul = (document: Document, tagName: string): HTMLElement =>
  document.createXULElement(tagName) as unknown as HTMLElement;

const html = <K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tagName: K,
): HTMLElementTagNameMap[K] =>
  document.createElementNS(XHTML_NAMESPACE, tagName) as HTMLElementTagNameMap[K];

const setAttributes = (
  element: Element,
  attributes: Readonly<Record<string, string>>,
): void => {
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
};

const createHeader = (document: Document, titleId: string) => {
  const header = xul(document, "box");
  header.classList.add("panel-header");
  const heading = html(document, "h1");
  const text = html(document, "span");
  text.id = titleId;
  heading.append(text);
  header.append(heading);
  return { header, text };
};

export const createFolderPickerView = (document: Document): FolderPickerView => {
  const mainViewId = `${PANEL_ID}-main-view`;
  const nameId = `${PANEL_ID}-name`;
  const panel = xul(document, "panel") as PopupPanelElement;
  panel.id = PANEL_ID;
  panel.className = "cui-widget-panel panel-no-padding";
  setAttributes(panel, {
    consumeoutsideclicks: "never",
    flip: "slide",
    hidden: "true",
    orient: "vertical",
    role: "group",
    type: "arrow",
  });

  const multiview = xul(document, "panelmultiview") as PanelMultiViewElement;
  multiview.id = `${PANEL_ID}-multiview`;
  multiview.setAttribute("mainViewId", mainViewId);

  const mainView = xul(document, "panelview");
  mainView.id = mainViewId;
  mainView.className = "PanelUI-subView extended-tab-shortcuts-folder-view";
  mainView.setAttribute("mainview-with-header", "true");
  const { header: mainHeader, text: mainTitle } = createHeader(
    document,
    `${PANEL_ID}-title`,
  );
  const mainSeparator = xul(document, "toolbarseparator");
  const mainBody = xul(document, "vbox");
  mainBody.className = "panel-subview-body";

  const newFolderButton = xul(document, "toolbarbutton");
  newFolderButton.id = `${PANEL_ID}-new-folder`;
  newFolderButton.className = "subviewbutton subviewbutton-iconic subviewbutton-nav";
  setAttributes(newFolderButton, {
    closemenu: "none",
    image: FOLDER_ICON,
    label: "New Folder…",
    "data-folder-picker-item": "true",
    tabindex: "-1",
  });
  const folderSeparator = xul(document, "toolbarseparator");
  const destinations = xul(document, "vbox");
  destinations.id = `${PANEL_ID}-destinations`;
  mainBody.append(newFolderButton, folderSeparator, destinations);
  mainView.append(mainHeader, mainSeparator, mainBody);

  const newView = xul(document, "panelview");
  newView.id = `${PANEL_ID}-new-view`;
  newView.className = "PanelUI-subView extended-tab-shortcuts-folder-view";
  newView.setAttribute("title", "New Folder");
  const newBody = xul(document, "vbox");
  newBody.className = "panel-subview-body extended-tab-shortcuts-folder-name-body";
  const nameLabel = html(document, "label");
  nameLabel.className = "extended-tab-shortcuts-folder-name-label";
  nameLabel.htmlFor = nameId;
  nameLabel.textContent = "Name";
  const nameInput = html(document, "input");
  nameInput.id = nameId;
  nameInput.className = "extended-tab-shortcuts-folder-name";
  nameInput.type = "text";
  nameInput.placeholder = "Folder name";
  nameInput.autocomplete = "off";
  newBody.append(nameLabel, nameInput);
  const newSeparator = xul(document, "toolbarseparator");
  const buttonGroup = document.createElementNS(
    XHTML_NAMESPACE,
    "moz-button-group",
  ) as HTMLElement;
  buttonGroup.className = "extended-tab-shortcuts-folder-actions";
  const cancelButton = document.createElementNS(
    XHTML_NAMESPACE,
    "moz-button",
  ) as MozButtonElement;
  cancelButton.label = "Cancel";
  const createButton = document.createElementNS(
    XHTML_NAMESPACE,
    "moz-button",
  ) as MozButtonElement;
  createButton.id = `${PANEL_ID}-create`;
  createButton.label = "Create";
  createButton.setAttribute("type", "primary");
  createButton.disabled = true;
  buttonGroup.append(cancelButton, createButton);
  newView.append(newBody, newSeparator, buttonGroup);

  multiview.append(mainView, newView);
  panel.append(multiview);
  return {
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
  };
};

export const renderFolderDestinations = (
  document: Document,
  container: HTMLElement,
  destinations: readonly FolderMoveDestination[],
  onMove: (folderId: string) => void,
  signal: AbortSignal,
): void => {
  container.replaceChildren();
  for (const destination of destinations) {
    const button = xul(document, "toolbarbutton");
    button.className =
      "subviewbutton subviewbutton-iconic extended-tab-shortcuts-folder-row";
    setAttributes(button, {
      closemenu: "none",
      "data-folder-id": destination.id,
      "data-folder-level": String(Math.max(0, Math.min(4, destination.level))),
      "data-folder-picker-item": "true",
      image: FOLDER_ICON,
      label: destination.label,
      tabindex: "-1",
    });
    if (destination.shortcut) button.setAttribute("shortcut", destination.shortcut);
    button.addEventListener("command", () => onMove(destination.id), { signal });
    container.append(button);
  }
  if (destinations.length === 0) {
    const empty = xul(document, "label");
    empty.className = "subview-subheader";
    empty.setAttribute("value", "No available folders");
    container.append(empty);
  }
};
