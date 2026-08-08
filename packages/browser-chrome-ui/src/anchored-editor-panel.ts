/**
 * Reusable browser-chrome editor surface. Firefox declares `#mainPopupSet` in
 * `browser/base/content/main-popupset.inc.xhtml`; its own panels use the same
 * `openPopup(anchor, position, ...)` contract throughout `browser/`, including
 * `AutoTabGrouping.sys.mjs`. Zen's `ZenUIManager.mjs` mirrors sidebar placement to
 * `documentElement[zen-right-side]`, which lets the arrow point inward on either side.
 */

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

const BASE_STYLES = `
  .zen-editor-panel {
    /*
     * Keep products insulated from Firefox and Zen token churn. The paired
     * foreground/background variables are particularly important: mixing an old
     * Zen foreground token with a system AccentColor produced unreadable controls.
     */
    --zen-editor-background: var(--arrowpanel-background, Canvas);
    --zen-editor-text: var(
      --arrowpanel-color,
      var(--panel-text-color, CanvasText)
    );
    --zen-editor-muted: var(
      --text-color-deemphasized,
      color-mix(in srgb, var(--zen-editor-text) 69%, transparent)
    );
    --zen-editor-border: var(
      --border-color-deemphasized,
      color-mix(in srgb, var(--zen-editor-text) 18%, transparent)
    );
    --zen-editor-subtle: color-mix(
      in srgb,
      var(--zen-editor-text) 6%,
      transparent
    );
    --zen-editor-field-background: var(
      --toolbar-field-background-color,
      var(--zen-editor-subtle)
    );
    --zen-editor-field-text: var(
      --toolbar-field-text-color,
      var(--zen-editor-text)
    );
    --zen-editor-control-background: var(
      --button-background-color,
      var(--zen-editor-subtle)
    );
    --zen-editor-control-background-hover: var(
      --button-background-color-hover,
      color-mix(in srgb, var(--zen-editor-text) 12%, transparent)
    );
    --zen-editor-control-background-active: var(
      --button-background-color-active,
      color-mix(in srgb, var(--zen-editor-text) 18%, transparent)
    );
    --zen-editor-control-text: var(--button-text-color, var(--zen-editor-text));
    --zen-editor-primary-background: var(
      --button-background-color-primary,
      AccentColor
    );
    --zen-editor-primary-background-hover: var(
      --button-background-color-primary-hover,
      var(--zen-editor-primary-background)
    );
    --zen-editor-primary-background-active: var(
      --button-background-color-primary-active,
      var(--zen-editor-primary-background-hover)
    );
    --zen-editor-primary-text: var(--button-text-color-primary, AccentColorText);
    --zen-editor-primary-text-hover: var(
      --button-text-color-primary-hover,
      var(--zen-editor-primary-text)
    );
    --zen-editor-primary-text-active: var(
      --button-text-color-primary-active,
      var(--zen-editor-primary-text-hover)
    );
    --zen-editor-control-radius: var(--button-border-radius, 0.55em);
    --zen-editor-focus-color: var(--focus-outline-color, AccentColor);
    --zen-editor-focus-outline: var(
      --focus-outline,
      2px solid var(--zen-editor-focus-color)
    );
  }

  .zen-editor-panel .zen-editor-surface {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    inline-size: 40em;
    max-inline-size: calc(100vw - 2em);
    max-block-size: min(42em, calc(100vh - 3em));
    overflow: hidden;
    color: var(--zen-editor-text);
    background: var(--zen-editor-background);
    font: menu;
    container-name: zen-editor-panel;
    container-type: inline-size;
  }

  /*
   * HTML controls in a browser-chrome document otherwise retain macOS native
   * form rendering through appearance: auto. :where() keeps this reset at zero
   * specificity so product styles appended after the base sheet can replace it.
   */
  :where(.zen-editor-panel .zen-editor-surface button) {
    appearance: none;
    box-sizing: border-box;
    min-inline-size: 0;
    margin: 0;
    padding: 0;
    border: 0;
    color: inherit;
    background: transparent;
    font: inherit;
    text-align: inherit;
    text-shadow: none;
  }

  :where(.zen-editor-panel .zen-editor-surface button:focus-visible) {
    outline: var(--zen-editor-focus-outline);
    outline-offset: var(--focus-outline-offset, 2px);
  }

  .zen-editor-panel .zen-editor-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.2em 0.8em;
    padding: 1em 1em 0.85em;
    border-bottom: 1px solid var(--zen-editor-border);
  }

  .zen-editor-panel .zen-editor-heading {
    min-width: 0;
  }

  .zen-editor-panel .zen-editor-title {
    margin: 0;
    font-size: 1.15em;
    font-weight: var(--font-weight-semibold, 600);
    line-height: 1.25;
  }

  .zen-editor-panel .zen-editor-description {
    margin: 0.25em 0 0;
    color: var(--zen-editor-muted);
    font-size: 0.9em;
    line-height: 1.35;
  }

  .zen-editor-panel .zen-editor-close {
    align-self: start;
    display: grid;
    place-items: center;
    inline-size: 2.15em;
    block-size: 2.15em;
    padding: 0;
    border: 0;
    border-radius: var(--zen-editor-control-radius);
    color: var(--zen-editor-control-text);
    background: transparent;
    cursor: default;
  }

  .zen-editor-panel .zen-editor-close:hover {
    background: var(--zen-editor-control-background-hover);
  }

  .zen-editor-panel .zen-editor-close:hover:active {
    background: var(--zen-editor-control-background-active);
  }

  .zen-editor-panel .zen-editor-close-icon {
    inline-size: 1em;
    block-size: 1em;
    -moz-context-properties: fill, fill-opacity;
    fill: currentColor;
    fill-opacity: 1;
    pointer-events: none;
  }

  .zen-editor-panel .zen-editor-search-row {
    grid-column: 1 / -1;
    margin-block-start: 0.7em;
  }

  .zen-editor-panel .zen-editor-search {
    appearance: none;
    box-sizing: border-box;
    inline-size: 100%;
    min-block-size: 2.55em;
    padding-block: 0.5em;
    padding-inline: 2.4em 0.75em;
    border: 1px solid var(--zen-editor-border);
    border-radius: var(--zen-editor-control-radius);
    color: var(--zen-editor-field-text);
    background-color: var(--zen-editor-field-background);
    background-image: url("chrome://global/skin/icons/search-glass.svg");
    background-position: left 0.75em center;
    background-repeat: no-repeat;
    background-size: 1em;
    -moz-context-properties: fill, fill-opacity;
    fill: currentColor;
    fill-opacity: 0.8;
    outline: none;
    font: inherit;
  }

  .zen-editor-panel .zen-editor-search:dir(rtl) {
    background-position: right 0.75em center;
  }

  .zen-editor-panel .zen-editor-search::placeholder {
    color: var(--zen-editor-muted);
    opacity: 1;
  }

  .zen-editor-panel .zen-editor-search:focus-visible {
    border-color: var(--zen-editor-focus-color);
    outline: var(--zen-editor-focus-outline);
    outline-offset: 1px;
  }

  .zen-editor-panel .zen-editor-body {
    min-block-size: 0;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    padding: 0.8em 1em;
  }

  .zen-editor-panel .zen-editor-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.6em 0.8em;
    min-block-size: 2.25em;
    padding: 0.7em 1em;
    border-top: 1px solid var(--zen-editor-border);
    background: var(--zen-editor-background);
  }

  .zen-editor-panel .zen-editor-footer > * {
    min-inline-size: 0;
  }

  @media (prefers-reduced-motion: no-preference) {
    .zen-editor-panel .zen-editor-close {
      transition: background-color 120ms ease;
    }
  }

  @media (prefers-contrast) {
    .zen-editor-panel {
      --zen-editor-border: var(--border-color-interactive, currentColor);
    }
  }

  @media (forced-colors: active) {
    .zen-editor-panel {
      --zen-editor-background: Canvas;
      --zen-editor-text: CanvasText;
      --zen-editor-muted: CanvasText;
      --zen-editor-border: ButtonText;
      --zen-editor-subtle: transparent;
      --zen-editor-field-background: Field;
      --zen-editor-field-text: FieldText;
      --zen-editor-control-background: ButtonFace;
      --zen-editor-control-background-hover: Highlight;
      --zen-editor-control-background-active: Highlight;
      --zen-editor-control-text: ButtonText;
      --zen-editor-primary-background: Highlight;
      --zen-editor-primary-background-hover: Highlight;
      --zen-editor-primary-background-active: Highlight;
      --zen-editor-primary-text: HighlightText;
      --zen-editor-primary-text-hover: HighlightText;
      --zen-editor-primary-text-active: HighlightText;
      --zen-editor-focus-color: Highlight;
      --zen-editor-focus-outline: 2px solid Highlight;
    }

    .zen-editor-panel .zen-editor-footer {
      background: Canvas;
    }

    .zen-editor-panel .zen-editor-close:hover,
    .zen-editor-panel .zen-editor-close:hover:active {
      color: HighlightText;
    }
  }
`;

interface PopupPanelElement extends HTMLElement {
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
  /**
   * Product-specific CSS appended to the panel's author-origin stylesheet.
   * Rules should be scoped to `id` so multiple editors can coexist.
   */
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
  let opener: Element | null = null;
  searchInput.addEventListener("input", () => onQueryChange?.(searchInput.value), {
    signal,
  });
  closeButton.addEventListener("click", () => panel.hidePopup(), { signal });
  panel.addEventListener(
    "popupshown",
    () => {
      ownerWindow?.requestAnimationFrame(() => searchInput.focus());
    },
    { signal },
  );
  panel.addEventListener(
    "popuphidden",
    () => {
      const closingOpener = opener;
      opener = null;
      onClose?.();
      ownerWindow?.requestAnimationFrame(() => {
        const active = document.activeElement;
        const focusStayedInPanel = active ? panel.contains(active) : true;
        const focusHasNoUsefulTarget =
          !active || active === document.documentElement || active === document.body;
        const focus = (closingOpener as (Element & { focus?: () => void }) | null)?.focus;
        if (
          closingOpener?.isConnected &&
          typeof focus === "function" &&
          (focusStayedInPanel || focusHasNoUsefulTarget)
        ) {
          focus.call(closingOpener);
        }
      });
    },
    { signal },
  );
  panel.addEventListener(
    "keydown",
    event => {
      if ((event as KeyboardEvent).key === "Escape") {
        event.preventDefault();
        panel.hidePopup();
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
      if (panel.state && panel.state !== "closed") {
        panel.hidePopup();
      }
      opener = anchor;
      panel.hidden = false;
      const tabsAreRight =
        document.documentElement.getAttribute("zen-right-side") === "true";
      const position = tabsAreRight ? "leftcenter rightcenter" : "rightcenter leftcenter";
      panel.openPopup(anchor, position, 0, 0, false, false);
    },
    close() {
      if (!panel.state || panel.state !== "closed") {
        panel.hidePopup();
      }
    },
    destroy() {
      abortController.abort();
      if (!panel.state || panel.state !== "closed") {
        panel.hidePopup();
      }
      panel.remove();
      styleElement.remove();
    },
  };
};
