// Generated from src/ by build.mjs — do not edit.

// src/core/policy.ts
var PROMOTION_COPY_LINKS = "share.copy-links";
var copyLinksPromotionState = (promotedIds, shareableCount) => ({
  visible: promotedIds.has(PROMOTION_COPY_LINKS),
  disabled: shareableCount < 1,
  labelCount: Math.max(1, shareableCount)
});
var resolveMoreActions = (actions, excludedFromRoot) => {
  const excludedActions = actions.filter((action) => excludedFromRoot.has(action.key)).sort(
    (left, right) => left.label.localeCompare(right.label, void 0, {
      numeric: true,
      sensitivity: "base"
    }) || left.key.localeCompare(right.key)
  );
  return {
    actions: excludedActions,
    visibleActions: excludedActions.filter((action) => action.browserVisible)
  };
};
var coalesceCustomizationActions = (actions) => {
  const byLabel = /* @__PURE__ */ new Map();
  for (const action of actions) {
    const normalizedLabel = action.label.trim().toLocaleLowerCase();
    const variants = byLabel.get(normalizedLabel) ?? [];
    variants.push(action);
    byLabel.set(normalizedLabel, variants);
  }
  return [...byLabel.values()].map((variants) => {
    const keys = variants.map((action) => action.key).sort();
    const first = variants[0];
    return {
      key: keys[0],
      keys,
      label: first.label,
      selected: variants.some((action) => action.selected),
      actions: variants
    };
  });
};
var groupCustomizationActions = (actions) => {
  const alphabetically2 = (left, right) => left.label.localeCompare(right.label, void 0, {
    numeric: true,
    sensitivity: "base"
  }) || left.key.localeCompare(right.key);
  return {
    selected: actions.filter((action) => action.selected).sort(alphabetically2),
    unselected: actions.filter((action) => !action.selected).sort(alphabetically2)
  };
};
var filterCustomizationActions = (actions, query) => {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) {
    return [...actions];
  }
  return actions.filter(
    (action) => `${action.label}
${action.key}`.toLocaleLowerCase().includes(needle)
  );
};
var updateActionSelection = (excludedFromRoot, keys, selected) => {
  const next = new Set(excludedFromRoot);
  for (const key of keys) {
    if (selected) {
      next.delete(key);
    } else {
      next.add(key);
    }
  }
  return next;
};
var actionPreferenceKey = ({
  id,
  l10nId,
  command
}) => {
  if (id.trim()) {
    return id.trim();
  }
  if (l10nId?.trim()) {
    return `l10n:${l10nId.trim()}`;
  }
  if (command?.trim()) {
    return `command:${command.trim()}`;
  }
  return null;
};
var decodeStoredIds = (raw) => {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return /* @__PURE__ */ new Set();
    }
    return new Set(
      parsed.filter((value) => typeof value === "string").map((value) => value.trim()).filter(Boolean)
    );
  } catch {
    return /* @__PURE__ */ new Set();
  }
};
var encodeStoredIds = (ids) => JSON.stringify([...ids].sort());
var resolveExcludedFromRootIds = (stored, discoveredIds) => {
  if (stored !== null) {
    return { ids: new Set(stored), initialized: false };
  }
  return {
    ids: new Set(discoveredIds.map((id) => id.trim()).filter(Boolean)),
    initialized: true
  };
};
var separatorsToHide = (nodes) => {
  const hidden = /* @__PURE__ */ new Set();
  for (const [index, node] of nodes.entries()) {
    if (node.kind !== "separator" || !node.visible) {
      continue;
    }
    let previousItem = -1;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = nodes[cursor];
      if (candidate?.kind === "item" && candidate.visible) {
        previousItem = cursor;
        break;
      }
    }
    const nextItem = nodes.findIndex(
      (candidate, candidateIndex) => candidateIndex > index && candidate.kind === "item" && candidate.visible
    );
    const earlierSeparator = nodes.slice(previousItem + 1, index).some((candidate) => candidate.kind === "separator" && candidate.visible);
    if (previousItem < 0 || nextItem < 0 || earlierSeparator) {
      hidden.add(index);
    }
  }
  return hidden;
};

// ../../packages/browser-chrome-ui/src/anchored-editor-panel.ts
var XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
var BASE_STYLES = `
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
var htmlElement = (document, tagName) => document.createElementNS(XHTML_NAMESPACE, tagName);
var createAnchoredEditorPanel = ({
  document,
  id,
  title,
  description,
  searchLabel,
  searchPlaceholder = "Search",
  styles: productStyles = "",
  onQueryChange,
  onClose
}) => {
  const popupSet = document.getElementById("mainPopupSet");
  const ownerWindow = document.defaultView;
  const createXULElement = document.createXULElement;
  if (!popupSet || typeof createXULElement !== "function") {
    return null;
  }
  document.getElementById(id)?.remove();
  document.getElementById(`${id}-base-styles`)?.remove();
  const styleElement = htmlElement(document, "style");
  styleElement.id = `${id}-base-styles`;
  styleElement.textContent = `${BASE_STYLES}
${productStyles}`;
  document.documentElement.append(styleElement);
  const panel = createXULElement.call(document, "panel");
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
  let opener = null;
  searchInput.addEventListener("input", () => onQueryChange?.(searchInput.value), {
    signal
  });
  closeButton.addEventListener("click", () => panel.hidePopup(), { signal });
  panel.addEventListener(
    "popupshown",
    () => {
      ownerWindow?.requestAnimationFrame(() => searchInput.focus());
    },
    { signal }
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
        const focusHasNoUsefulTarget = !active || active === document.documentElement || active === document.body;
        const focus = closingOpener?.focus;
        if (closingOpener?.isConnected && typeof focus === "function" && (focusStayedInPanel || focusHasNoUsefulTarget)) {
          focus.call(closingOpener);
        }
      });
    },
    { signal }
  );
  panel.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        panel.hidePopup();
      }
    },
    { signal }
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
      const tabsAreRight = document.documentElement.getAttribute("zen-right-side") === "true";
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
    }
  };
};

// src/platform/editor-styles.ts
var TAB_MENU_EDITOR_STYLES = `
  #sidebar-context-menu-customizer-editor-panel {
    --sidebar-menu-box-background: var(
      --background-color-box,
      var(--zen-editor-background)
    );
    --sidebar-menu-list-hover: var(
      --background-color-list-item-hover,
      var(--zen-editor-control-background-hover)
    );
    --sidebar-menu-list-hover-text: var(
      --text-color-list-item-hover,
      var(--zen-editor-text)
    );
    --sidebar-menu-selected-background: var(
      --color-accent-primary-selected,
      var(--zen-editor-primary-background)
    );
    --sidebar-menu-selected-text: var(
      --text-color-accent-primary-selected,
      var(--zen-editor-primary-text)
    );
  }

  #sidebar-context-menu-customizer-editor-panel .zen-editor-body {
    padding: 0;
  }

  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-toolbar {
    position: sticky;
    z-index: 1;
    inset-block-start: 0;
    padding: 0.75em 1em 0.6em;
    background: var(--zen-editor-background);
  }

  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-filters {
    display: inline-flex;
    gap: 0.15em;
  }

  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-filter {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35em;
    min-block-size: 2.45em;
    padding: 0.45em 0.75em;
    border-radius: var(--zen-editor-control-radius);
    color: var(--zen-editor-muted);
    cursor: default;
    line-height: 1;
    white-space: nowrap;
  }

  #sidebar-context-menu-customizer-editor-panel
    .sidebar-menu-editor-filter[aria-selected="true"] {
    color: var(--sidebar-menu-selected-text);
    background: var(--sidebar-menu-selected-background);
    font-weight: var(--font-weight-semibold, 600);
  }

  #sidebar-context-menu-customizer-editor-panel
    .sidebar-menu-editor-filter:hover:not([aria-selected="true"]) {
    color: var(--sidebar-menu-list-hover-text);
    background: var(--sidebar-menu-list-hover);
  }

  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-filter-count {
    min-inline-size: 1.25em;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-list-region {
    padding: 0 1em 1em;
  }

  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-list {
    overflow: hidden;
    border: 1px solid var(--zen-editor-border);
    border-radius: 0.62em;
    background: var(--sidebar-menu-box-background);
  }

  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-action {
    position: relative;
    min-inline-size: 0;
  }

  #sidebar-context-menu-customizer-editor-panel
    .sidebar-menu-editor-action
    + .sidebar-menu-editor-action::before {
    position: absolute;
    z-index: 1;
    inset-block-start: 0;
    inset-inline: 2.7em 0.75em;
    border-block-start: 1px solid var(--zen-editor-border);
    content: "";
    pointer-events: none;
  }

  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-action-toggle {
    display: grid;
    grid-template-columns: 1.23em minmax(0, 1fr);
    align-items: center;
    gap: 0.77em;
    inline-size: 100%;
    min-block-size: 3.08em;
    padding: 0.62em 0.77em;
    color: var(--zen-editor-text);
    cursor: default;
    line-height: normal;
    text-align: start;
  }

  #sidebar-context-menu-customizer-editor-panel
    .sidebar-menu-editor-action-toggle:hover {
    color: var(--sidebar-menu-list-hover-text);
    background: var(--sidebar-menu-list-hover);
  }

  #sidebar-context-menu-customizer-editor-panel
    .sidebar-menu-editor-action-toggle:hover:active {
    background: var(--zen-editor-control-background-active);
  }

  #sidebar-context-menu-customizer-editor-panel
    .sidebar-menu-editor-action-toggle:focus-visible {
    outline-offset: -2px;
  }

  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-check {
    box-sizing: border-box;
    display: grid;
    place-items: center;
    inline-size: 1.23em;
    block-size: 1.23em;
    border: 1px solid var(--border-color-interactive, var(--zen-editor-border));
    border-radius: 0.31em;
    color: var(--sidebar-menu-selected-text);
    background: var(--zen-editor-background);
  }

  #sidebar-context-menu-customizer-editor-panel
    .sidebar-menu-editor-action-toggle[aria-checked="true"]
    .sidebar-menu-editor-check {
    border-color: var(--sidebar-menu-selected-background);
    background: var(--sidebar-menu-selected-background);
  }

  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-check-icon {
    display: none;
    inline-size: 0.92em;
    block-size: 0.92em;
    -moz-context-properties: fill, fill-opacity;
    fill: currentColor;
    fill-opacity: 1;
    pointer-events: none;
  }

  #sidebar-context-menu-customizer-editor-panel
    .sidebar-menu-editor-action-toggle[aria-checked="true"]
    .sidebar-menu-editor-check-icon {
    display: block;
  }

  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-action-label {
    min-inline-size: 0;
    overflow-wrap: break-word;
    color: inherit;
    font: inherit;
    white-space: normal;
  }

  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-empty {
    margin: 0;
    padding: 2.4em 1em;
    color: var(--zen-editor-muted);
    text-align: center;
  }

  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-promotions {
    margin-block-start: 1em;
  }

  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-section-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6em;
    margin: 0 0 0.5em;
    padding-inline: 0.25em;
  }

  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-section-heading h2 {
    margin: 0;
    color: var(--zen-editor-text);
    font: inherit;
    font-weight: var(--font-weight-semibold, 600);
  }

  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-section-note {
    color: var(--zen-editor-muted);
    font-size: 0.85em;
  }

  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-promotion-copy {
    display: flex;
    flex-direction: column;
    min-inline-size: 0;
  }

  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-row-detail {
    margin-block-start: 0.2em;
    color: var(--zen-editor-muted);
    font-size: 0.85em;
    line-height: normal;
  }

  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-status {
    color: var(--zen-editor-muted);
    font-size: 0.85em;
    font-variant-numeric: tabular-nums;
  }

  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-footer-actions {
    display: flex;
    gap: 0.6em;
    margin-inline-start: auto;
  }

  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-button {
    min-block-size: 2.45em;
    padding: 0.5em 0.85em;
    border: 1px solid var(--zen-editor-border);
    border-radius: var(--zen-editor-control-radius);
    color: var(--zen-editor-control-text);
    background: var(--zen-editor-control-background);
    cursor: default;
    line-height: 1;
  }

  #sidebar-context-menu-customizer-editor-panel
    .sidebar-menu-editor-button:hover:not(:disabled) {
    background: var(--zen-editor-control-background-hover);
  }

  #sidebar-context-menu-customizer-editor-panel
    .sidebar-menu-editor-button:hover:active:not(:disabled) {
    background: var(--zen-editor-control-background-active);
  }

  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-button:disabled {
    opacity: 0.4;
  }

  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-button-primary {
    border-color: transparent;
    color: var(--zen-editor-primary-text);
    background: var(--zen-editor-primary-background);
    font-weight: var(--font-weight-semibold, 600);
  }

  #sidebar-context-menu-customizer-editor-panel
    .sidebar-menu-editor-button-primary:hover:not(:disabled) {
    color: var(--zen-editor-primary-text-hover);
    background: var(--zen-editor-primary-background-hover);
  }

  #sidebar-context-menu-customizer-editor-panel
    .sidebar-menu-editor-button-primary:hover:active:not(:disabled) {
    color: var(--zen-editor-primary-text-active);
    background: var(--zen-editor-primary-background-active);
  }

  @container zen-editor-panel (max-width: 28em) {
    #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-filters {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      inline-size: 100%;
    }
  }

  @media (forced-colors: active) {
    #sidebar-context-menu-customizer-editor-panel {
      --sidebar-menu-box-background: Canvas;
      --sidebar-menu-list-hover: Highlight;
      --sidebar-menu-list-hover-text: HighlightText;
      --sidebar-menu-selected-background: Highlight;
      --sidebar-menu-selected-text: HighlightText;
    }
  }
`;

// src/platform/editor.ts
var XHTML_NAMESPACE2 = "http://www.w3.org/1999/xhtml";
var PANEL_ID = "sidebar-context-menu-customizer-editor-panel";
var ACTION_LIST_ID = `${PANEL_ID}-actions`;
var PROMOTION_COPY_LINKS_KEY = "promotion-copy-links";
var filters = [
  { id: "all", label: "All" },
  { id: "selected", label: "Selected" },
  { id: "unselected", label: "Not selected" }
];
var htmlElement2 = (document, tagName) => document.createElementNS(XHTML_NAMESPACE2, tagName);
var button = (document, label, className) => {
  const node = htmlElement2(document, "button");
  node.type = "button";
  node.className = className;
  node.textContent = label;
  return node;
};
var alphabetically = (left, right) => left.label.localeCompare(right.label, void 0, {
  numeric: true,
  sensitivity: "base"
}) || left.key.localeCompare(right.key);
var nextFrame = (document, callback) => {
  const ownerWindow = document.defaultView;
  if (ownerWindow) {
    ownerWindow.requestAnimationFrame(callback);
  } else {
    callback();
  }
};
var createTabMenuEditor = ({
  document,
  actions,
  readExcludedFromRootIds,
  writeExcludedFromRootIds,
  copyLinksIsPromoted,
  setCopyLinksPromoted
}) => {
  let activeFilter = "all";
  let visibleActions = [];
  let render = (_focusKey, _resetScroll) => {
  };
  const panel = createAnchoredEditorPanel({
    document,
    id: PANEL_ID,
    title: "Customize tab menu",
    description: "Checked actions appear directly in the tab menu. Unchecked actions remain under More actions.",
    searchLabel: "Search tab menu actions",
    searchPlaceholder: "Search actions",
    styles: TAB_MENU_EDITOR_STYLES,
    onQueryChange: () => render(void 0, true)
  });
  if (!panel) {
    return null;
  }
  const status = htmlElement2(document, "span");
  status.className = "sidebar-menu-editor-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const footerActions = htmlElement2(document, "div");
  footerActions.className = "sidebar-menu-editor-footer-actions";
  const selectAll = button(document, "Select all", "sidebar-menu-editor-button");
  selectAll.title = "Put every action directly in the tab menu";
  const done = button(
    document,
    "Done",
    "sidebar-menu-editor-button sidebar-menu-editor-button-primary"
  );
  footerActions.append(selectAll, done);
  panel.footer.append(status, footerActions);
  const toolbar = htmlElement2(document, "div");
  toolbar.className = "sidebar-menu-editor-toolbar";
  const filterGroup = htmlElement2(document, "div");
  filterGroup.className = "sidebar-menu-editor-filters";
  filterGroup.setAttribute("role", "tablist");
  filterGroup.setAttribute("aria-label", "Filter tab menu actions");
  const filterButtons = /* @__PURE__ */ new Map();
  const filterCounts = /* @__PURE__ */ new Map();
  const selectFilter = (filter, focus) => {
    activeFilter = filter;
    render(void 0, true);
    if (focus) {
      nextFrame(document, () => filterButtons.get(filter)?.focus());
    }
  };
  for (const filter of filters) {
    const tab = button(document, "", "sidebar-menu-editor-filter");
    tab.id = `${PANEL_ID}-filter-${filter.id}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", ACTION_LIST_ID);
    const label = htmlElement2(document, "span");
    label.textContent = filter.label;
    const count = htmlElement2(document, "span");
    count.className = "sidebar-menu-editor-filter-count";
    tab.append(label, count);
    tab.addEventListener("click", () => selectFilter(filter.id, false));
    tab.addEventListener("keydown", (event) => {
      const currentIndex = filters.findIndex((candidate) => candidate.id === filter.id);
      let nextIndex = null;
      const rtl = document.documentElement.getAttribute("dir") === "rtl";
      if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = filters.length - 1;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const movesForward = event.key === "ArrowRight" !== rtl;
        nextIndex = (currentIndex + (movesForward ? 1 : -1) + filters.length) % filters.length;
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
  const listRegion = htmlElement2(document, "div");
  listRegion.className = "sidebar-menu-editor-list-region";
  panel.body.append(toolbar, listRegion);
  const checkMarker = () => {
    const marker = htmlElement2(document, "span");
    marker.className = "sidebar-menu-editor-check";
    marker.setAttribute("aria-hidden", "true");
    const icon = htmlElement2(document, "img");
    icon.className = "sidebar-menu-editor-check-icon";
    icon.src = "chrome://global/skin/icons/check.svg";
    icon.alt = "";
    icon.setAttribute("role", "presentation");
    marker.append(icon);
    return marker;
  };
  const actionRow = (action) => {
    const row = htmlElement2(document, "div");
    row.className = "sidebar-menu-editor-action";
    row.dataset.actionKey = action.key;
    const toggle = button(document, "", "sidebar-menu-editor-action-toggle");
    toggle.setAttribute("role", "checkbox");
    toggle.setAttribute("aria-checked", String(action.selected));
    toggle.setAttribute("aria-label", `Show ${action.label} directly in the tab menu`);
    toggle.title = action.selected ? "Move to More actions" : "Show directly in the tab menu";
    const label = htmlElement2(document, "span");
    label.className = "sidebar-menu-editor-action-label";
    label.textContent = action.label;
    toggle.append(checkMarker(), label);
    toggle.addEventListener("click", () => {
      const index = visibleActions.findIndex((candidate) => candidate.key === action.key);
      const adjacent = visibleActions[index + 1] ?? visibleActions[index - 1];
      const focusKey = activeFilter === "all" ? action.key : adjacent?.key ?? null;
      writeExcludedFromRootIds(
        updateActionSelection(readExcludedFromRootIds(), action.keys, !action.selected)
      );
      render(focusKey);
    });
    row.append(toggle);
    return row;
  };
  const promotionSection = () => {
    const section = htmlElement2(document, "section");
    section.className = "sidebar-menu-editor-promotions";
    const heading = htmlElement2(document, "div");
    heading.className = "sidebar-menu-editor-section-heading";
    const title = htmlElement2(document, "h2");
    title.textContent = "From submenus";
    const note = htmlElement2(document, "span");
    note.className = "sidebar-menu-editor-section-note";
    note.textContent = "Optional shortcuts";
    heading.append(title, note);
    const list = htmlElement2(document, "div");
    list.className = "sidebar-menu-editor-list";
    list.setAttribute("role", "list");
    const row = htmlElement2(document, "div");
    row.className = "sidebar-menu-editor-action";
    row.dataset.actionKey = PROMOTION_COPY_LINKS_KEY;
    row.setAttribute("role", "listitem");
    const promoted = copyLinksIsPromoted();
    const toggle = button(document, "", "sidebar-menu-editor-action-toggle");
    toggle.setAttribute("role", "checkbox");
    toggle.setAttribute("aria-checked", String(promoted));
    toggle.setAttribute("aria-label", "Show Copy Link shortcut directly in the tab menu");
    toggle.title = promoted ? "Remove shortcut from the main menu" : "Add shortcut to the main menu";
    const copy = htmlElement2(document, "span");
    copy.className = "sidebar-menu-editor-promotion-copy";
    const label = htmlElement2(document, "span");
    label.className = "sidebar-menu-editor-action-label";
    label.textContent = "Copy Link(s)";
    const detail = htmlElement2(document, "span");
    detail.className = "sidebar-menu-editor-row-detail";
    detail.textContent = "Also show the Share command directly in the tab menu";
    copy.append(label, detail);
    toggle.append(checkMarker(), copy);
    toggle.addEventListener("click", () => {
      setCopyLinksPromoted(!copyLinksIsPromoted());
      render(PROMOTION_COPY_LINKS_KEY);
    });
    row.append(toggle);
    list.append(row);
    section.append(heading, list);
    return section;
  };
  const focusAction = (key) => {
    const row = [...listRegion.querySelectorAll("[data-action-key]")].find(
      (candidate) => candidate.dataset.actionKey === key
    );
    const toggle = row?.querySelector(".sidebar-menu-editor-action-toggle");
    if (!toggle) {
      return false;
    }
    toggle.focus();
    row?.scrollIntoView({ block: "nearest" });
    return true;
  };
  render = (focusKey, resetScroll = false) => {
    const previousScroll = panel.body.scrollTop;
    const allActions = actions();
    const totals = groupCustomizationActions(allActions);
    const matching = filterCustomizationActions(allActions, panel.searchInput.value).sort(
      alphabetically
    );
    visibleActions = matching.filter((action) => {
      if (activeFilter === "selected") {
        return action.selected;
      }
      if (activeFilter === "unselected") {
        return !action.selected;
      }
      return true;
    });
    const list = htmlElement2(document, "div");
    list.id = ACTION_LIST_ID;
    list.className = "sidebar-menu-editor-list";
    list.setAttribute("role", "tabpanel");
    list.setAttribute("aria-labelledby", `${PANEL_ID}-filter-${activeFilter}`);
    if (visibleActions.length === 0) {
      const empty = htmlElement2(document, "p");
      empty.className = "sidebar-menu-editor-empty";
      empty.textContent = panel.searchInput.value.trim() ? "No matching actions" : activeFilter === "selected" ? "No actions are selected" : activeFilter === "unselected" ? "Every action is selected" : "No actions are available";
      list.append(empty);
    } else {
      list.append(...visibleActions.map(actionRow));
    }
    const content = [list];
    const query = panel.searchInput.value.trim().toLocaleLowerCase();
    const promotionMatches = !query || "copy link links share submenu shortcut".includes(query);
    if (activeFilter === "all" && promotionMatches) {
      content.push(promotionSection());
    }
    listRegion.replaceChildren(...content);
    panel.body.scrollTop = resetScroll ? 0 : previousScroll;
    const counts = {
      all: allActions.length,
      selected: totals.selected.length,
      unselected: totals.unselected.length
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
    if (focusKey !== void 0) {
      nextFrame(document, () => {
        if (!focusKey || !focusAction(focusKey)) {
          filterButtons.get(activeFilter)?.focus();
        }
      });
    }
  };
  panel.searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !panel.searchInput.value) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    panel.searchInput.value = "";
    render(void 0, true);
  });
  panel.element.addEventListener("keydown", (event) => {
    const keyboardEvent = event;
    const target = keyboardEvent.target;
    const targetIsTextInput = target instanceof Element && ["input", "textarea"].includes(target.localName);
    const isSearchShortcut = keyboardEvent.key === "/" || (keyboardEvent.metaKey || keyboardEvent.ctrlKey) && keyboardEvent.key.toLocaleLowerCase() === "f";
    if (!targetIsTextInput && isSearchShortcut) {
      keyboardEvent.preventDefault();
      panel.searchInput.focus();
    }
  });
  selectAll.addEventListener("click", () => {
    writeExcludedFromRootIds(/* @__PURE__ */ new Set());
    render();
  });
  done.addEventListener("click", () => panel.close());
  return {
    open(anchor) {
      activeFilter = "all";
      panel.searchInput.value = "";
      render(void 0, true);
      panel.open(anchor);
    },
    destroy() {
      panel.destroy();
    }
  };
};

// src/platform/menu.ts
var { SharingUtils } = ChromeUtils.importESModule(
  "resource:///modules/SharingUtils.sys.mjs"
);
var TAB_MENU_ID = "tabContextMenu";
var CUSTOMIZER_SEPARATOR_ID = "sidebar-context-menu-customizer-tab-separator";
var CUSTOMIZER_ITEM_ID = "sidebar-context-menu-customizer-tab-menu";
var MORE_ACTIONS_MENU_ID = "sidebar-context-menu-customizer-more-actions-menu";
var MORE_ACTIONS_POPUP_ID = "sidebar-context-menu-customizer-more-actions-popup";
var PROMOTED_COPY_LINKS_ID = "sidebar-context-menu-customizer-promoted-copy-links";
var EMPTY_SEPARATOR_ATTRIBUTE = "data-sidebar-context-menu-customizer-empty";
var ownIds = /* @__PURE__ */ new Set([
  CUSTOMIZER_SEPARATOR_ID,
  CUSTOMIZER_ITEM_ID,
  MORE_ACTIONS_MENU_ID,
  MORE_ACTIONS_POPUP_ID,
  PROMOTED_COPY_LINKS_ID
]);
var preferenceKey = (node) => actionPreferenceKey({
  id: node.id,
  l10nId: node.getAttribute("data-l10n-id") ?? node.getAttribute("data-lazy-l10n-id"),
  command: node.getAttribute("command"),
  className: node.getAttribute("class")
});
var isAction = (node) => (node.localName === "menu" || node.localName === "menuitem") && !ownIds.has(node.id) && preferenceKey(node) !== null;
var browserShows = (node) => !node.hidden;
var fallbackLabel = (id) => id.replace(/^context_/, "").replace(/^zen-/, "").replaceAll(/[-_]+/g, " ").replaceAll(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (first) => first.toUpperCase());
var itemLabel = (node) => node.getAttribute("label")?.trim() || fallbackLabel(
  node.id || node.getAttribute("data-l10n-id") || node.getAttribute("data-lazy-l10n-id") || preferenceKey(node) || "action"
);
var cleanSeparators = (menu, hideTemporarily) => {
  const nodes = [...menu.children];
  const hiddenIndexes = separatorsToHide(
    nodes.map((node) => ({
      kind: node.localName === "menuseparator" ? "separator" : "item",
      visible: browserShows(node)
    }))
  );
  for (const [index, node] of nodes.entries()) {
    if (node.localName !== "menuseparator") {
      continue;
    }
    if (hiddenIndexes.has(index)) {
      hideTemporarily(node, EMPTY_SEPARATOR_ATTRIBUTE);
    } else {
      node.removeAttribute(EMPTY_SEPARATOR_ATTRIBUTE);
    }
  }
};
var installTabMenuCustomizer = (readExcludedFromRootIds, writeExcludedFromRootIds, readPromotedIds, writePromotedIds) => {
  const document = window.document;
  const tabMenu = document.getElementById(TAB_MENU_ID);
  if (!tabMenu || typeof document.createXULElement !== "function") {
    console.error("[sidebar-context-menu-customizer] tab context menu is unavailable");
    return () => {
    };
  }
  document.getElementById(CUSTOMIZER_SEPARATOR_ID)?.remove();
  document.getElementById(CUSTOMIZER_ITEM_ID)?.remove();
  document.getElementById(MORE_ACTIONS_MENU_ID)?.remove();
  document.getElementById(PROMOTED_COPY_LINKS_ID)?.remove();
  const promotedCopyLinks = document.createXULElement("menuitem");
  promotedCopyLinks.id = PROMOTED_COPY_LINKS_ID;
  promotedCopyLinks.classList.add("menuitem-iconic");
  promotedCopyLinks.setAttribute("image", "chrome://global/skin/icons/link.svg");
  promotedCopyLinks.hidden = true;
  tabMenu.append(promotedCopyLinks);
  const customizerSeparator = document.createXULElement("menuseparator");
  customizerSeparator.id = CUSTOMIZER_SEPARATOR_ID;
  const moreActionsMenu = document.createXULElement("menu");
  moreActionsMenu.id = MORE_ACTIONS_MENU_ID;
  moreActionsMenu.setAttribute("label", "More actions");
  const moreActionsPopup = document.createXULElement("menupopup");
  moreActionsPopup.id = MORE_ACTIONS_POPUP_ID;
  moreActionsMenu.append(moreActionsPopup);
  const customizerItem = document.createXULElement("menuitem");
  customizerItem.id = CUSTOMIZER_ITEM_ID;
  customizerItem.setAttribute("label", "Customize tab menu…");
  tabMenu.append(customizerSeparator, moreActionsMenu, customizerItem);
  const browserHiddenStates = /* @__PURE__ */ new Map();
  const movedActions = /* @__PURE__ */ new Set();
  let rootOrderSnapshot = [];
  let presentedExcludedFromRootIds = /* @__PURE__ */ new Set();
  let presentationActive = false;
  const restoreSeparatorPresentation = () => {
    for (const [node, hidden] of browserHiddenStates) {
      node.hidden = hidden;
      node.removeAttribute(EMPTY_SEPARATOR_ATTRIBUTE);
    }
    browserHiddenStates.clear();
    for (const node of tabMenu.children) {
      node.removeAttribute(EMPTY_SEPARATOR_ATTRIBUTE);
    }
  };
  const restoreMoreActions = () => {
    const stableBoundary = [customizerSeparator, moreActionsMenu, customizerItem].find(
      (node) => node.parentElement === tabMenu
    );
    const boundaryIndex = stableBoundary ? rootOrderSnapshot.indexOf(stableBoundary) : -1;
    for (let index = rootOrderSnapshot.length - 1; index >= 0; index -= 1) {
      const node = rootOrderSnapshot[index];
      if (!node || !movedActions.has(node)) {
        continue;
      }
      if (node.parentElement !== moreActionsPopup) {
        continue;
      }
      const nextSurvivingSibling = rootOrderSnapshot.slice(index + 1).find((candidate) => candidate.parentElement === tabMenu);
      const fallbackBoundary = !nextSurvivingSibling && stableBoundary?.parentElement === tabMenu && boundaryIndex >= 0 && index < boundaryIndex ? stableBoundary : null;
      tabMenu.insertBefore(node, nextSurvivingSibling ?? fallbackBoundary);
    }
    movedActions.clear();
    rootOrderSnapshot = [];
    presentedExcludedFromRootIds.clear();
    moreActionsMenu.hidden = true;
  };
  const clearPresentation = () => {
    presentationActive = false;
    presentationObserver.disconnect();
    presentationObserver.takeRecords();
    restoreMoreActions();
    restoreSeparatorPresentation();
  };
  const hideTemporarily = (node, attribute) => {
    if (!browserHiddenStates.has(node)) {
      browserHiddenStates.set(node, node.hidden);
    }
    node.setAttribute(attribute, "true");
    node.hidden = true;
  };
  const currentExcludedFromRootIds = () => {
    const resolved = resolveExcludedFromRootIds(
      readExcludedFromRootIds(),
      [...tabMenu.children].filter(isAction).map(preferenceKey).filter((key) => key !== null)
    );
    if (resolved.initialized) {
      writeExcludedFromRootIds(resolved.ids);
    }
    return resolved.ids;
  };
  const currentPromotedIds = () => new Set(readPromotedIds());
  const currentShareMenu = () => {
    const [primary, ...duplicates] = [
      ...tabMenu.querySelectorAll(".share-tab-url-item")
    ];
    for (const duplicate of duplicates) {
      duplicate.remove();
    }
    return primary ?? null;
  };
  const updatePromotedCopyLinks = () => {
    const shareMenu = currentShareMenu();
    if (!shareMenu) {
      promotedCopyLinks.hidden = true;
      return;
    }
    shareMenu.after(promotedCopyLinks);
    const state2 = copyLinksPromotionState(
      currentPromotedIds(),
      SharingUtils.getLinksToShare(shareMenu).length
    );
    document.l10n.setAttributes(promotedCopyLinks, "menu-share-copy-links", {
      count: state2.labelCount
    });
    promotedCopyLinks.toggleAttribute("disabled", state2.disabled);
    promotedCopyLinks.hidden = !state2.visible;
  };
  const moreActionFacts = () => [...moreActionsPopup.children].flatMap((node) => {
    if (!isAction(node)) {
      return [];
    }
    const key = preferenceKey(node);
    return key ? [
      {
        key,
        label: itemLabel(node),
        browserVisible: browserShows(node),
        node
      }
    ] : [];
  });
  const organizeMoreActions = () => {
    const facts = moreActionFacts();
    const organized = resolveMoreActions(facts, new Set(facts.map((action) => action.key)));
    const currentOrder = facts.map((action) => action.node);
    const desiredOrder = organized.actions.map((action) => action.node);
    if (desiredOrder.some((node, index) => currentOrder[index] !== node)) {
      moreActionsPopup.append(...desiredOrder);
    }
    moreActionsMenu.hidden = organized.visibleActions.length === 0;
  };
  const mergeCurrentRootOrder = () => {
    const rootChildren = [...tabMenu.children];
    for (const node of rootChildren) {
      if (rootOrderSnapshot.includes(node) || !isAction(node)) {
        continue;
      }
      const key = preferenceKey(node);
      if (!key) {
        continue;
      }
      const staleIndex = rootOrderSnapshot.findIndex(
        (candidate) => candidate !== node && !candidate.isConnected && isAction(candidate) && preferenceKey(candidate) === key
      );
      if (staleIndex >= 0) {
        const [staleNode] = rootOrderSnapshot.splice(staleIndex, 1);
        if (staleNode) {
          movedActions.delete(staleNode);
        }
      }
    }
    let anchorIndex = null;
    for (let index = rootChildren.length - 1; index >= 0; index -= 1) {
      const node = rootChildren[index];
      if (!node) {
        continue;
      }
      const existingIndex = rootOrderSnapshot.indexOf(node);
      if (existingIndex >= 0) {
        anchorIndex = existingIndex;
        continue;
      }
      const insertionIndex = anchorIndex ?? rootOrderSnapshot.length;
      rootOrderSnapshot.splice(insertionIndex, 0, node);
      anchorIndex = insertionIndex;
    }
  };
  const moveLateExcludedActions = () => {
    mergeCurrentRootOrder();
    const lateActions = [...tabMenu.children].filter((node) => {
      if (!isAction(node)) {
        return false;
      }
      const key = preferenceKey(node);
      return key !== null && presentedExcludedFromRootIds.has(key);
    });
    for (const node of lateActions) {
      movedActions.add(node);
      moreActionsPopup.append(node);
    }
  };
  const moveExcludedActions = (excludedFromRoot) => {
    const rootChildren = [...tabMenu.children];
    rootOrderSnapshot = [...rootChildren];
    presentedExcludedFromRootIds = new Set(excludedFromRoot);
    const organized = resolveMoreActions(
      rootChildren.flatMap((node) => {
        if (!isAction(node)) {
          return [];
        }
        const key = preferenceKey(node);
        return key ? [
          {
            key,
            label: itemLabel(node),
            browserVisible: browserShows(node),
            node
          }
        ] : [];
      }),
      excludedFromRoot
    );
    for (const { node } of organized.actions) {
      movedActions.add(node);
    }
    moreActionsPopup.append(...organized.actions.map(({ node }) => node));
    moreActionsMenu.hidden = organized.visibleActions.length === 0;
  };
  const presentationObserver = new MutationObserver((records) => {
    if (!presentationActive) {
      return;
    }
    const rootChanged = records.some((record) => record.target === tabMenu);
    const moreActionsChanged = records.some((record) => record.target === moreActionsPopup);
    if (!rootChanged && !moreActionsChanged) {
      return;
    }
    if (rootChanged) {
      moveLateExcludedActions();
      restoreSeparatorPresentation();
      cleanSeparators(tabMenu, hideTemporarily);
    }
    organizeMoreActions();
    presentationObserver.takeRecords();
  });
  const observePresentation = () => {
    presentationActive = true;
    presentationObserver.observe(tabMenu, { childList: true });
    presentationObserver.observe(moreActionsPopup, { childList: true });
  };
  const refreshPresentation = () => {
    clearPresentation();
    updatePromotedCopyLinks();
    moveExcludedActions(currentExcludedFromRootIds());
    cleanSeparators(tabMenu, hideTemporarily);
    observePresentation();
  };
  const editorActions = () => {
    const excludedFromRoot = currentExcludedFromRootIds();
    const actions = [...tabMenu.children].flatMap((source) => {
      if (!isAction(source)) {
        return [];
      }
      const key = preferenceKey(source);
      return key ? [{ key, label: itemLabel(source), selected: !excludedFromRoot.has(key) }] : [];
    });
    return coalesceCustomizationActions(actions).map(
      ({ key, keys, label, selected }) => ({ key, keys, label, selected })
    );
  };
  const editor = createTabMenuEditor({
    document,
    actions: editorActions,
    readExcludedFromRootIds: currentExcludedFromRootIds,
    writeExcludedFromRootIds,
    copyLinksIsPromoted: () => currentPromotedIds().has(PROMOTION_COPY_LINKS),
    setCopyLinksPromoted: (promoted) => {
      const promotedIds = currentPromotedIds();
      if (promoted) {
        promotedIds.add(PROMOTION_COPY_LINKS);
      } else {
        promotedIds.delete(PROMOTION_COPY_LINKS);
      }
      writePromotedIds(promotedIds);
    }
  });
  if (!editor) {
    console.error("[sidebar-context-menu-customizer] editor panel is unavailable");
  }
  let editorAnchor = null;
  const onBeforeShowing = (event) => {
    if (event.target === tabMenu) {
      clearPresentation();
    }
  };
  const onShowing = (event) => {
    if (event.target === tabMenu) {
      editorAnchor = window.TabContextMenu?.contextTab ?? null;
      refreshPresentation();
    }
  };
  const onHidden = (event) => {
    if (event.target === tabMenu) {
      clearPresentation();
    }
  };
  const onCustomize = () => {
    const anchor = editorAnchor ?? window.TabContextMenu?.contextTab ?? document.getElementById("tabbrowser-tabs") ?? document.documentElement;
    window.requestAnimationFrame(() => editor?.open(anchor));
  };
  const onPromotedCopyLinks = () => {
    const shareMenu = currentShareMenu();
    if (shareMenu) {
      SharingUtils.copyLink(shareMenu);
    }
  };
  tabMenu.addEventListener("popupshowing", onBeforeShowing, true);
  tabMenu.addEventListener("popupshowing", onShowing);
  tabMenu.addEventListener("popuphidden", onHidden);
  customizerItem.addEventListener("command", onCustomize);
  promotedCopyLinks.addEventListener("command", onPromotedCopyLinks);
  return () => {
    tabMenu.removeEventListener("popupshowing", onBeforeShowing, true);
    tabMenu.removeEventListener("popupshowing", onShowing);
    tabMenu.removeEventListener("popuphidden", onHidden);
    customizerItem.removeEventListener("command", onCustomize);
    promotedCopyLinks.removeEventListener("command", onPromotedCopyLinks);
    editor?.destroy();
    clearPresentation();
    promotedCopyLinks.remove();
    customizerSeparator.remove();
    moreActionsMenu.remove();
    customizerItem.remove();
  };
};

// src/platform/prefs.ts
var PREF_EXCLUDED_ROOT_TAB_ITEMS = "zen.sidebar-context-menu-customizer.tab.excluded-root-items";
var PREF_LEGACY_HIDDEN_TAB_ITEMS = "zen.sidebar-context-menu-customizer.tab.hidden-items";
var PREF_TAB_ITEMS_INITIALIZED = "zen.sidebar-context-menu-customizer.tab.opt-in-initialized";
var PREF_PROMOTED_TAB_ITEMS = "zen.sidebar-context-menu-customizer.tab.promoted-items";
var readExcludedRootTabItems = () => {
  try {
    if (!Services.prefs.prefHasUserValue(PREF_TAB_ITEMS_INITIALIZED)) {
      return null;
    }
    const pref = Services.prefs.prefHasUserValue(PREF_EXCLUDED_ROOT_TAB_ITEMS) ? PREF_EXCLUDED_ROOT_TAB_ITEMS : PREF_LEGACY_HIDDEN_TAB_ITEMS;
    return decodeStoredIds(Services.prefs.getStringPref(pref, "[]"));
  } catch (error) {
    console.error("[sidebar-context-menu-customizer] could not read preferences", error);
    return /* @__PURE__ */ new Set();
  }
};
var writeExcludedRootTabItems = (ids) => {
  try {
    Services.prefs.setStringPref(PREF_EXCLUDED_ROOT_TAB_ITEMS, encodeStoredIds(ids));
    Services.prefs.setBoolPref(PREF_TAB_ITEMS_INITIALIZED, true);
  } catch (error) {
    console.error("[sidebar-context-menu-customizer] could not save preferences", error);
  }
};
var readPromotedTabItems = () => {
  try {
    return decodeStoredIds(Services.prefs.getStringPref(PREF_PROMOTED_TAB_ITEMS, "[]"));
  } catch (error) {
    console.error(
      "[sidebar-context-menu-customizer] could not read promoted actions",
      error
    );
    return /* @__PURE__ */ new Set();
  }
};
var writePromotedTabItems = (ids) => {
  try {
    Services.prefs.setStringPref(PREF_PROMOTED_TAB_ITEMS, encodeStoredIds(ids));
  } catch (error) {
    console.error(
      "[sidebar-context-menu-customizer] could not save promoted actions",
      error
    );
  }
};

// src/platform/sine.ts
window.zenSidebarContextMenuCustomizer ??= { disposers: [] };
var state = window.zenSidebarContextMenuCustomizer;
var runDisposers = () => {
  for (const dispose of state.disposers) {
    try {
      dispose();
    } catch (error) {
      console.error("[sidebar-context-menu-customizer] disposer failed", error);
    }
  }
  state.disposers = [];
};
var onUnload = (teardown2) => {
  if (typeof window.addUnloadListener === "function") {
    window.addUnloadListener(teardown2);
  } else {
    console.error("[sidebar-context-menu-customizer] Sine unload hook is unavailable");
  }
};

// src/main.ts
var teardown = () => {
  runDisposers();
  console.info("[sidebar-context-menu-customizer] unloaded");
};
runDisposers();
onUnload(teardown);
state.disposers.push(
  installTabMenuCustomizer(
    readExcludedRootTabItems,
    writeExcludedRootTabItems,
    readPromotedTabItems,
    writePromotedTabItems
  )
);
console.info("[sidebar-context-menu-customizer] ready");
