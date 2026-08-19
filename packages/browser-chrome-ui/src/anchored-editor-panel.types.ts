export interface PopupPanelElement extends HTMLElement {
  hidden: boolean;
  state?: string;
  openPopup(
    anchor: Element,
    position: string,
    x: number,
    y: number,
    isContextMenu: boolean,
    attributesOverride: boolean,
  ): void;
  hidePopup(): void;
}

export interface AnchoredEditorPanelOptions {
  document: Document;
  id: string;
  title: string;
  description: string;
  searchLabel: string;
  searchPlaceholder?: string;
  /** Product CSS scoped to the panel ID. */
  styles?: string;
  onQueryChange?: (query: string) => void;
  onClose?: () => void;
}

export interface AnchoredEditorPanel {
  readonly element: PopupPanelElement;
  readonly body: HTMLElement;
  readonly footer: HTMLElement;
  readonly searchInput: HTMLInputElement;
  open(anchor: Element): void;
  close(): void;
  destroy(): void;
}
