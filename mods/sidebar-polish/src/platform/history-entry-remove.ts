const HISTORY_DOCUMENT = "chrome://browser/content/places/historySidebar.xhtml";
const BUTTON_ID = "sidebar-polish-history-remove";
const BUTTON_SIZE = 24;
const BUTTON_INSET = 8;
const BUTTON_OPTICAL_OFFSET = 2;

interface PlacesHistoryPort {
  isURI(node: unknown): node is { uri: string };
  remove(uri: string): unknown;
}

interface HistoryTreeView {
  nodeForTreeIndex(index: number): unknown;
}

interface HistoryTree extends Element {
  readonly rowHeight: number;
  readonly treeBody: Element;
  readonly view: HistoryTreeView | null;
  getCellAt(x: number, y: number): { row: number };
  getFirstVisibleRow(): number;
}

interface HistoryDocument extends Document {
  readonly documentURI: string;
  readonly l10n?: {
    setAttributes(element: Element, id: string, args?: Record<string, unknown>): void;
  };
  createXULElement(tagName: string): HTMLElement;
}

interface SidebarBrowser extends EventTarget {
  readonly contentDocument: Document | null;
}

interface HistoryEntryRemoveOptions {
  browser: SidebarBrowser;
  history: PlacesHistoryPort;
  isLive(): boolean;
  report?(error: unknown): void;
}

interface ActionBounds {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly uri: string;
}

interface PlacesModule {
  PlacesUtils: {
    history: { remove(uri: string): Promise<boolean> };
    nodeIsURI(node: unknown): boolean;
  };
}

const safelyReport = (report: ((error: unknown) => void) | undefined, error: unknown) => {
  try {
    report?.(error);
  } catch {
    // Error reporting cannot own browser behavior.
  }
};

const attachHistoryDocument = (
  document: HistoryDocument,
  history: PlacesHistoryPort,
  isLive: () => boolean,
  report: ((error: unknown) => void) | undefined,
) => {
  const tree = document.getElementById("historyTree") as HistoryTree | null;
  if (!tree || typeof document.createXULElement !== "function") {
    return () => {};
  }

  const button = document.createXULElement("image");
  button.id = BUTTON_ID;
  button.classList.add("close-icon");
  button.hidden = true;
  button.tabIndex = -1;
  button.style.pointerEvents = "none";
  button.setAttribute("aria-hidden", "true");
  document.l10n?.setAttributes(button, "places-delete-page", { count: 1 });
  document.documentElement.append(button);
  let active = true;
  let actionBounds: ActionBounds | null = null;

  const hide = () => {
    actionBounds = null;
    button.removeAttribute("data-hover");
    button.removeAttribute("data-pressed");
    button.hidden = true;
  };
  const contains = (pointer: MouseEvent) =>
    actionBounds !== null &&
    pointer.clientX >= actionBounds.left &&
    pointer.clientX <= actionBounds.right &&
    pointer.clientY >= actionBounds.top &&
    pointer.clientY <= actionBounds.bottom;
  const suppressTreeAction = (event: MouseEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onMove = (event: Event) => {
    if (!active || !isLive()) {
      hide();
      return;
    }
    const pointer = event as MouseEvent;
    try {
      const { row } = tree.getCellAt(pointer.clientX, pointer.clientY);
      const node = row >= 0 ? tree.view?.nodeForTreeIndex(row) : null;
      if (!node || !history.isURI(node) || typeof node.uri !== "string") {
        hide();
        return;
      }

      const rowHeight = tree.rowHeight;
      const bodyRect = tree.treeBody.getBoundingClientRect();
      if (!Number.isFinite(rowHeight) || rowHeight <= 0) {
        hide();
        return;
      }
      const rowTop = bodyRect.y + rowHeight * (row - tree.getFirstVisibleRow());
      const rtl = document.defaultView?.getComputedStyle(tree).direction === "rtl";
      const left = rtl
        ? bodyRect.left + BUTTON_INSET
        : bodyRect.right - BUTTON_INSET - BUTTON_SIZE;
      const top = rowTop + (rowHeight - BUTTON_SIZE) / 2 + BUTTON_OPTICAL_OFFSET;
      actionBounds = {
        bottom: top + BUTTON_SIZE,
        left,
        right: left + BUTTON_SIZE,
        top,
        uri: node.uri,
      };
      button.style.left = `${left}px`;
      button.style.top = `${top}px`;
      button.hidden = false;
      button.toggleAttribute("data-hover", contains(pointer));
    } catch (error) {
      hide();
      safelyReport(report, error);
    }
  };
  const onMouseDown = (event: Event) => {
    const pointer = event as MouseEvent;
    if (!active || !isLive() || !contains(pointer)) {
      return;
    }
    suppressTreeAction(pointer);
    button.setAttribute("data-pressed", "");
  };
  const onMouseUp = (event: Event) => {
    const pointer = event as MouseEvent;
    button.removeAttribute("data-pressed");
    if (active && isLive() && contains(pointer)) {
      suppressTreeAction(pointer);
    }
  };
  const onClick = (event: Event) => {
    const pointer = event as MouseEvent;
    if (!active || !isLive() || !contains(pointer)) {
      return;
    }
    suppressTreeAction(pointer);
    const uri = actionBounds?.uri ?? null;
    hide();
    if (uri === null) {
      return;
    }
    try {
      void Promise.resolve(history.remove(uri)).catch(error =>
        safelyReport(report, error),
      );
    } catch (error) {
      safelyReport(report, error);
    }
  };
  const onTreeLeave = () => hide();

  tree.addEventListener("mousemove", onMove);
  tree.addEventListener("mouseleave", onTreeLeave);
  tree.addEventListener("mousedown", onMouseDown, true);
  tree.addEventListener("mouseup", onMouseUp, true);
  tree.addEventListener("click", onClick, true);
  tree.addEventListener("scroll", hide, true);
  tree.addEventListener("keydown", hide);

  return () => {
    if (!active) {
      return;
    }
    active = false;
    hide();
    tree.removeEventListener("mousemove", onMove);
    tree.removeEventListener("mouseleave", onTreeLeave);
    tree.removeEventListener("mousedown", onMouseDown, true);
    tree.removeEventListener("mouseup", onMouseUp, true);
    tree.removeEventListener("click", onClick, true);
    tree.removeEventListener("scroll", hide, true);
    tree.removeEventListener("keydown", hide);
    button.remove();
  };
};

export const createPlacesHistoryPort = (): PlacesHistoryPort => {
  const { PlacesUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/PlacesUtils.sys.mjs",
  ) as PlacesModule;
  return {
    isURI: (node): node is { uri: string } => PlacesUtils.nodeIsURI(node),
    // Zen 1.21.13b controller.js:871-878 uses this call for one History URI.
    remove: uri => PlacesUtils.history.remove(uri),
  };
};

export const installHistoryEntryRemoveButton = ({
  browser,
  history,
  isLive,
  report,
}: HistoryEntryRemoveOptions): (() => void) => {
  let active = true;
  let currentDocument: Document | null = null;
  let detachDocument = () => {};
  const bind = (document: Document | null) => {
    if (!active || !isLive() || currentDocument === document) {
      return;
    }
    detachDocument();
    detachDocument = () => {};
    currentDocument = document;
    if (document?.documentURI === HISTORY_DOCUMENT) {
      detachDocument = attachHistoryDocument(
        document as HistoryDocument,
        history,
        isLive,
        report,
      );
    }
  };
  const onLoad = (event: Event) => {
    const document = browser.contentDocument;
    if (event.target === document) {
      bind(document);
    }
  };

  browser.addEventListener("load", onLoad, true);
  bind(browser.contentDocument);

  return () => {
    if (!active) {
      return;
    }
    active = false;
    browser.removeEventListener("load", onLoad, true);
    detachDocument();
    detachDocument = () => {};
    currentDocument = null;
  };
};
