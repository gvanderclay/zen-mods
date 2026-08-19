/**
 * Reusable browser-chrome editor surface. Firefox declares `#mainPopupSet` in
 * `browser/base/content/main-popupset.inc.xhtml`; its own panels use the same
 * `openPopup(anchor, position, ...)` contract throughout `browser/`, including
 * `AutoTabGrouping.sys.mjs`. Zen's `ZenUIManager.mjs` mirrors sidebar placement to
 * `documentElement[zen-right-side]`, which lets the arrow point inward on either side.
 */

import BASE_STYLES from "./anchored-editor-panel.css";
import type {
  AnchoredEditorPanel,
  AnchoredEditorPanelOptions,
  PopupPanelElement,
} from "./anchored-editor-panel.types.ts";

export type {
  AnchoredEditorPanel,
  AnchoredEditorPanelOptions,
} from "./anchored-editor-panel.types.ts";

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

const htmlElement = <K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tagName: K,
) => document.createElementNS(XHTML_NAMESPACE, tagName) as HTMLElementTagNameMap[K];

export const createAnchoredEditorPanel = ({
  document,
  id,
  title,
  description,
  searchLabel,
  searchPlaceholder = "Search",
  styles: productStyles = "",
  onQueryChange,
  onClose,
}: AnchoredEditorPanelOptions): AnchoredEditorPanel | null => {
  const popupSet = document.getElementById("mainPopupSet");
  const ownerWindow = document.defaultView;
  const createXULElement = (
    document as Document & { createXULElement?: (tagName: string) => Element }
  ).createXULElement;
  if (!popupSet || typeof createXULElement !== "function") {
    return null;
  }

  document.getElementById(id)?.remove();
  document.getElementById(`${id}-base-styles`)?.remove();

  const styleElement = htmlElement(document, "style");
  styleElement.id = `${id}-base-styles`;
  styleElement.textContent = `${BASE_STYLES}\n${productStyles}`;
  document.documentElement.append(styleElement);

  const panel = createXULElement.call(document, "panel") as PopupPanelElement;
  panel.id = id;
  panel.className = "cui-widget-panel panel-no-padding zen-editor-panel";
  panel.setAttribute("type", "arrow");
  panel.setAttribute("orient", "vertical");
  panel.setAttribute("flip", "slide");
  panel.setAttribute("consumeoutsideclicks", "never");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-labelledby", `${id}-title`);
  panel.setAttribute("aria-describedby", `${id}-description`);
  panel.hidden = true;

  const surface = htmlElement(document, "section");
  surface.className = "zen-editor-surface";

  const header = htmlElement(document, "header");
  header.className = "zen-editor-header";
  const heading = htmlElement(document, "div");
  heading.className = "zen-editor-heading";
  const titleElement = htmlElement(document, "h1");
  titleElement.id = `${id}-title`;
  titleElement.className = "zen-editor-title";
  titleElement.textContent = title;
  const descriptionElement = htmlElement(document, "p");
  descriptionElement.id = `${id}-description`;
  descriptionElement.className = "zen-editor-description";
  descriptionElement.textContent = description;
  heading.append(titleElement, descriptionElement);

  const closeButton = htmlElement(document, "button");
  closeButton.className = "zen-editor-close";
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close");
  closeButton.title = "Close";
  const closeIcon = htmlElement(document, "img");
  closeIcon.className = "zen-editor-close-icon";
  closeIcon.src = "chrome://global/skin/icons/close.svg";
  closeIcon.alt = "";
  closeIcon.setAttribute("role", "presentation");
  closeButton.append(closeIcon);

  const searchRow = htmlElement(document, "div");
  searchRow.className = "zen-editor-search-row";
  const searchInput = htmlElement(document, "input");
  searchInput.className = "zen-editor-search";
  searchInput.type = "search";
  searchInput.placeholder = searchPlaceholder;
  searchInput.setAttribute("aria-label", searchLabel);
  searchInput.autocomplete = "off";
  searchInput.spellcheck = false;
  searchRow.append(searchInput);
  header.append(heading, closeButton, searchRow);

  const body = htmlElement(document, "div");
  body.className = "zen-editor-body";
  const footer = htmlElement(document, "footer");
  footer.className = "zen-editor-footer";
  surface.append(header, body, footer);
  panel.append(surface);
  popupSet.append(panel);

  const abortController = new AbortController();
  const signal = abortController.signal;
  let destroyed = false;
  let opener: Element | null = null;
  let searchFocusFrame: number | null = null;
  let searchFocusEpoch = 0;
  let openerFocusFrame: number | null = null;
  let openerFocusEpoch = 0;

  const cancelSearchFocus = () => {
    searchFocusEpoch += 1;
    if (searchFocusFrame !== null && ownerWindow) {
      ownerWindow.cancelAnimationFrame(searchFocusFrame);
    }
    searchFocusFrame = null;
  };

  const scheduleSearchFocus = () => {
    cancelSearchFocus();
    if (!ownerWindow || destroyed) {
      return;
    }

    const epoch = searchFocusEpoch;
    searchFocusFrame = ownerWindow.requestAnimationFrame(() => {
      if (destroyed || epoch !== searchFocusEpoch) {
        return;
      }
      searchFocusFrame = null;
      if (opener && panel.isConnected) {
        searchInput.focus();
      }
    });
  };

  const cancelOpenerFocus = () => {
    openerFocusEpoch += 1;
    if (openerFocusFrame !== null && ownerWindow) {
      ownerWindow.cancelAnimationFrame(openerFocusFrame);
    }
    openerFocusFrame = null;
  };

  const scheduleOpenerFocus = (closingOpener: Element | null) => {
    cancelOpenerFocus();
    if (!ownerWindow || destroyed || !closingOpener) {
      return;
    }

    const epoch = openerFocusEpoch;
    openerFocusFrame = ownerWindow.requestAnimationFrame(() => {
      if (destroyed || epoch !== openerFocusEpoch) {
        return;
      }
      openerFocusFrame = null;
      if (opener) {
        return;
      }

      const active = document.activeElement;
      const focusStayedInPanel = active ? panel.contains(active) : true;
      const focusHasNoUsefulTarget =
        !active || active === document.documentElement || active === document.body;
      const focus = (closingOpener as Element & { focus?: () => void }).focus;
      if (
        closingOpener.isConnected &&
        typeof focus === "function" &&
        (focusStayedInPanel || focusHasNoUsefulTarget)
      ) {
        focus.call(closingOpener);
      }
    });
  };

  const hidePanel = () => {
    if (destroyed) {
      return;
    }
    cancelSearchFocus();
    panel.hidePopup();
  };

  searchInput.addEventListener("input", () => onQueryChange?.(searchInput.value), {
    signal,
  });
  closeButton.addEventListener("click", hidePanel, { signal });
  panel.addEventListener(
    "popupshown",
    () => {
      if (destroyed) {
        return;
      }
      cancelOpenerFocus();
      scheduleSearchFocus();
    },
    { signal },
  );
  panel.addEventListener(
    "popuphidden",
    () => {
      if (destroyed) {
        return;
      }
      cancelSearchFocus();
      const closingOpener = opener;
      opener = null;
      onClose?.();
      scheduleOpenerFocus(closingOpener);
    },
    { signal },
  );
  panel.addEventListener(
    "keydown",
    event => {
      if ((event as KeyboardEvent).key === "Escape") {
        event.preventDefault();
        hidePanel();
      }
    },
    { signal },
  );

  return {
    element: panel,
    body,
    footer,
    searchInput,
    open(anchor) {
      if (destroyed) {
        return;
      }
      cancelSearchFocus();
      cancelOpenerFocus();
      if (panel.state && panel.state !== "closed") {
        panel.hidePopup();
      }
      cancelOpenerFocus();
      opener = anchor;
      panel.hidden = false;
      const tabsAreRight =
        document.documentElement.getAttribute("zen-right-side") === "true";
      const position = tabsAreRight ? "leftcenter rightcenter" : "rightcenter leftcenter";
      panel.openPopup(anchor, position, 0, 0, false, false);
    },
    close() {
      if (destroyed) {
        return;
      }
      cancelSearchFocus();
      if (!panel.state || panel.state !== "closed") {
        panel.hidePopup();
      }
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      cancelSearchFocus();
      cancelOpenerFocus();
      opener = null;
      abortController.abort();
      if (!panel.state || panel.state !== "closed") {
        panel.hidePopup();
      }
      panel.remove();
      styleElement.remove();
    },
  };
};
