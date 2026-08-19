// Generated from src/ by build.mjs — do not edit.

// src/core/policy.ts
var presentationCollator = new Intl.Collator(void 0, {
  numeric: true,
  sensitivity: "base"
});
var compareKeys = (left, right) => left < right ? -1 : left > right ? 1 : 0;
var compareCustomizationActions = (left, right) => presentationCollator.compare(left.label, right.label) || compareKeys(left.key, right.key);
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
  return {
    selected: actions.filter((action) => action.selected).sort(compareCustomizationActions),
    unselected: actions.filter((action) => !action.selected).sort(compareCustomizationActions)
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

// src/core/presentation.ts
var createPresentationSnapshot = (sources, storedExcludedFromRoot, deriveActionKey = actionPreferenceKey) => {
  const discoveredActionIds = [];
  const keyed = sources.map((source) => {
    if (source.kind !== "action") {
      return source;
    }
    const actionKey = source.identity ? deriveActionKey(source.identity) : null;
    if (!actionKey) {
      return { ...source, kind: "control" };
    }
    discoveredActionIds.push(actionKey);
    return { ...source, key: actionKey };
  });
  const resolved = resolveExcludedFromRootIds(
    storedExcludedFromRoot,
    discoveredActionIds
  );
  return {
    excludedFromRootIds: resolved.ids,
    facts: keyed.map(({ identity: _identity, ...fact }) => ({
      ...fact,
      selected: fact.kind !== "action" || !resolved.ids.has(fact.key)
    })),
    initialized: resolved.initialized
  };
};
var sortPresentationActions = (actions) => [...actions].sort(compareCustomizationActions);
var planMenuPresentation = (facts) => {
  const moreActions = sortPresentationActions(
    facts.filter((fact) => fact.kind === "action" && !fact.selected)
  );
  const visibleMoreActions = moreActions.filter((action) => action.browserVisible);
  const moreActionsVisible = visibleMoreActions.length > 0;
  const structuralFacts = facts.map((fact) => ({
    kind: fact.kind === "separator" ? "separator" : "item",
    visible: fact.kind === "action" ? fact.selected && fact.browserVisible : fact.kind === "control" && fact.controlRole === "more-actions" ? moreActionsVisible : fact.browserVisible
  }));
  const hiddenPositions = separatorsToHide(structuralFacts);
  const hiddenSeparatorIndexes = /* @__PURE__ */ new Set();
  for (const position of hiddenPositions) {
    const fact = facts[position];
    if (fact) {
      hiddenSeparatorIndexes.add(fact.originalIndex);
    }
  }
  return {
    hiddenSeparatorIndexes,
    moreActions,
    moreActionsVisible,
    visibleMoreActions
  };
};

// ../../packages/browser-chrome-ui/src/anchored-editor-panel.css
var anchored_editor_panel_default = '.zen-editor-panel {\n  /*\n     * Keep products insulated from Firefox and Zen token churn. The paired\n     * foreground/background variables are particularly important: mixing an old\n     * Zen foreground token with a system AccentColor produced unreadable controls.\n     */\n  --zen-editor-background: var(--arrowpanel-background, Canvas);\n  --zen-editor-text: var(--arrowpanel-color, var(--panel-text-color, CanvasText));\n  --zen-editor-muted: var(\n    --text-color-deemphasized,\n    color-mix(in srgb, var(--zen-editor-text) 69%, transparent)\n  );\n  --zen-editor-border: var(\n    --border-color-deemphasized,\n    color-mix(in srgb, var(--zen-editor-text) 18%, transparent)\n  );\n  --zen-editor-subtle: color-mix(in srgb, var(--zen-editor-text) 6%, transparent);\n  --zen-editor-field-background: var(\n    --toolbar-field-background-color,\n    var(--zen-editor-subtle)\n  );\n  --zen-editor-field-text: var(--toolbar-field-text-color, var(--zen-editor-text));\n  --zen-editor-control-background: var(\n    --button-background-color,\n    var(--zen-editor-subtle)\n  );\n  --zen-editor-control-background-hover: var(\n    --button-background-color-hover,\n    color-mix(in srgb, var(--zen-editor-text) 12%, transparent)\n  );\n  --zen-editor-control-background-active: var(\n    --button-background-color-active,\n    color-mix(in srgb, var(--zen-editor-text) 18%, transparent)\n  );\n  --zen-editor-control-text: var(--button-text-color, var(--zen-editor-text));\n  --zen-editor-primary-background: var(--button-background-color-primary, AccentColor);\n  --zen-editor-primary-background-hover: var(\n    --button-background-color-primary-hover,\n    var(--zen-editor-primary-background)\n  );\n  --zen-editor-primary-background-active: var(\n    --button-background-color-primary-active,\n    var(--zen-editor-primary-background-hover)\n  );\n  --zen-editor-primary-text: var(--button-text-color-primary, AccentColorText);\n  --zen-editor-primary-text-hover: var(\n    --button-text-color-primary-hover,\n    var(--zen-editor-primary-text)\n  );\n  --zen-editor-primary-text-active: var(\n    --button-text-color-primary-active,\n    var(--zen-editor-primary-text-hover)\n  );\n  --zen-editor-control-radius: var(--button-border-radius, 0.55em);\n  --zen-editor-focus-color: var(--focus-outline-color, AccentColor);\n  --zen-editor-focus-outline: var(\n    --focus-outline,\n    2px solid var(--zen-editor-focus-color)\n  );\n}\n\n.zen-editor-panel .zen-editor-surface {\n  box-sizing: border-box;\n  display: flex;\n  flex-direction: column;\n  inline-size: 40em;\n  max-inline-size: calc(100vw - 2em);\n  max-block-size: min(42em, calc(100vh - 3em));\n  overflow: hidden;\n  color: var(--zen-editor-text);\n  background: var(--zen-editor-background);\n  font: menu;\n  container-name: zen-editor-panel;\n  container-type: inline-size;\n}\n\n/*\n   * HTML controls in a browser-chrome document otherwise retain macOS native\n   * form rendering through appearance: auto. :where() keeps this reset at zero\n   * specificity so product styles appended after the base sheet can replace it.\n   */\n:where(.zen-editor-panel .zen-editor-surface button) {\n  appearance: none;\n  box-sizing: border-box;\n  min-inline-size: 0;\n  margin: 0;\n  padding: 0;\n  border: 0;\n  color: inherit;\n  background: transparent;\n  font: inherit;\n  text-align: inherit;\n  text-shadow: none;\n}\n\n:where(.zen-editor-panel .zen-editor-surface button:focus-visible) {\n  outline: var(--zen-editor-focus-outline);\n  outline-offset: var(--focus-outline-offset, 2px);\n}\n\n.zen-editor-panel .zen-editor-header {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) auto;\n  gap: 0.2em 0.8em;\n  padding: 1em 1em 0.85em;\n  border-bottom: 1px solid var(--zen-editor-border);\n}\n\n.zen-editor-panel .zen-editor-heading {\n  min-width: 0;\n}\n\n.zen-editor-panel .zen-editor-title {\n  margin: 0;\n  font-size: 1.15em;\n  font-weight: var(--font-weight-semibold, 600);\n  line-height: 1.25;\n}\n\n.zen-editor-panel .zen-editor-description {\n  margin: 0.25em 0 0;\n  color: var(--zen-editor-muted);\n  font-size: 0.9em;\n  line-height: 1.35;\n}\n\n.zen-editor-panel .zen-editor-close {\n  align-self: start;\n  display: grid;\n  place-items: center;\n  inline-size: 2.15em;\n  block-size: 2.15em;\n  padding: 0;\n  border: 0;\n  border-radius: var(--zen-editor-control-radius);\n  color: var(--zen-editor-control-text);\n  background: transparent;\n  cursor: default;\n}\n\n.zen-editor-panel .zen-editor-close:hover {\n  background: var(--zen-editor-control-background-hover);\n}\n\n.zen-editor-panel .zen-editor-close:hover:active {\n  background: var(--zen-editor-control-background-active);\n}\n\n.zen-editor-panel .zen-editor-close-icon {\n  inline-size: 1em;\n  block-size: 1em;\n  -moz-context-properties: fill, fill-opacity;\n  fill: currentColor;\n  fill-opacity: 1;\n  pointer-events: none;\n}\n\n.zen-editor-panel .zen-editor-search-row {\n  grid-column: 1 / -1;\n  margin-block-start: 0.7em;\n}\n\n.zen-editor-panel .zen-editor-search {\n  appearance: none;\n  box-sizing: border-box;\n  inline-size: 100%;\n  min-block-size: 2.55em;\n  padding-block: 0.5em;\n  padding-inline: 2.4em 0.75em;\n  border: 1px solid var(--zen-editor-border);\n  border-radius: var(--zen-editor-control-radius);\n  color: var(--zen-editor-field-text);\n  background-color: var(--zen-editor-field-background);\n  background-image: url("chrome://global/skin/icons/search-glass.svg");\n  background-position: left 0.75em center;\n  background-repeat: no-repeat;\n  background-size: 1em;\n  -moz-context-properties: fill, fill-opacity;\n  fill: currentColor;\n  fill-opacity: 0.8;\n  outline: none;\n  font: inherit;\n}\n\n.zen-editor-panel .zen-editor-search:dir(rtl) {\n  background-position: right 0.75em center;\n}\n\n.zen-editor-panel .zen-editor-search::placeholder {\n  color: var(--zen-editor-muted);\n  opacity: 1;\n}\n\n.zen-editor-panel .zen-editor-search:focus-visible {\n  border-color: var(--zen-editor-focus-color);\n  outline: var(--zen-editor-focus-outline);\n  outline-offset: 1px;\n}\n\n.zen-editor-panel .zen-editor-body {\n  min-block-size: 0;\n  overflow: auto;\n  overscroll-behavior: contain;\n  scrollbar-gutter: stable;\n  padding: 0.8em 1em;\n}\n\n.zen-editor-panel .zen-editor-footer {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  justify-content: space-between;\n  gap: 0.6em 0.8em;\n  min-block-size: 2.25em;\n  padding: 0.7em 1em;\n  border-top: 1px solid var(--zen-editor-border);\n  background: var(--zen-editor-background);\n}\n\n.zen-editor-panel .zen-editor-footer > * {\n  min-inline-size: 0;\n}\n\n@media (prefers-reduced-motion: no-preference) {\n  .zen-editor-panel .zen-editor-close {\n    transition: background-color 120ms ease;\n  }\n}\n\n@media (prefers-contrast) {\n  .zen-editor-panel {\n    --zen-editor-border: var(--border-color-interactive, currentColor);\n  }\n}\n\n@media (forced-colors: active) {\n  .zen-editor-panel {\n    --zen-editor-background: Canvas;\n    --zen-editor-text: CanvasText;\n    --zen-editor-muted: CanvasText;\n    --zen-editor-border: ButtonText;\n    --zen-editor-subtle: transparent;\n    --zen-editor-field-background: Field;\n    --zen-editor-field-text: FieldText;\n    --zen-editor-control-background: ButtonFace;\n    --zen-editor-control-background-hover: Highlight;\n    --zen-editor-control-background-active: Highlight;\n    --zen-editor-control-text: ButtonText;\n    --zen-editor-primary-background: Highlight;\n    --zen-editor-primary-background-hover: Highlight;\n    --zen-editor-primary-background-active: Highlight;\n    --zen-editor-primary-text: HighlightText;\n    --zen-editor-primary-text-hover: HighlightText;\n    --zen-editor-primary-text-active: HighlightText;\n    --zen-editor-focus-color: Highlight;\n    --zen-editor-focus-outline: 2px solid Highlight;\n  }\n\n  .zen-editor-panel .zen-editor-footer {\n    background: Canvas;\n  }\n\n  .zen-editor-panel .zen-editor-close:hover,\n  .zen-editor-panel .zen-editor-close:hover:active {\n    color: HighlightText;\n  }\n}\n';

// ../../packages/browser-chrome-ui/src/anchored-editor-panel.ts
var XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
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
  styleElement.textContent = `${anchored_editor_panel_default}
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
  let destroyed = false;
  let opener = null;
  let searchFocusFrame = null;
  let searchFocusEpoch = 0;
  let openerFocusFrame = null;
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
  const scheduleOpenerFocus = (closingOpener) => {
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
      const focusHasNoUsefulTarget = !active || active === document.documentElement || active === document.body;
      const focus = closingOpener.focus;
      if (closingOpener.isConnected && typeof focus === "function" && (focusStayedInPanel || focusHasNoUsefulTarget)) {
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
    signal
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
    { signal }
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
    { signal }
  );
  panel.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        hidePanel();
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
      const tabsAreRight = document.documentElement.getAttribute("zen-right-side") === "true";
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
    }
  };
};

// src/platform/editor-styles.css
var editor_styles_default = '#sidebar-context-menu-customizer-editor-panel {\n  --sidebar-menu-box-background: var(\n    --background-color-box,\n    var(--zen-editor-background)\n  );\n  --sidebar-menu-list-hover: var(\n    --background-color-list-item-hover,\n    var(--zen-editor-control-background-hover)\n  );\n  --sidebar-menu-list-hover-text: var(\n    --text-color-list-item-hover,\n    var(--zen-editor-text)\n  );\n  --sidebar-menu-selected-background: var(\n    --color-accent-primary-selected,\n    var(--zen-editor-primary-background)\n  );\n  --sidebar-menu-selected-text: var(\n    --text-color-accent-primary-selected,\n    var(--zen-editor-primary-text)\n  );\n}\n\n#sidebar-context-menu-customizer-editor-panel .zen-editor-body {\n  padding: 0;\n}\n\n#sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-toolbar {\n  position: sticky;\n  z-index: 1;\n  inset-block-start: 0;\n  padding: 0.75em 1em 0.6em;\n  background: var(--zen-editor-background);\n}\n\n#sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-filters {\n  display: inline-flex;\n  gap: 0.15em;\n}\n\n#sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-filter {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 0.35em;\n  min-block-size: 2.45em;\n  padding: 0.45em 0.75em;\n  border-radius: var(--zen-editor-control-radius);\n  color: var(--zen-editor-muted);\n  cursor: default;\n  line-height: 1;\n  white-space: nowrap;\n}\n\n#sidebar-context-menu-customizer-editor-panel\n  .sidebar-menu-editor-filter[aria-selected="true"] {\n  color: var(--sidebar-menu-selected-text);\n  background: var(--sidebar-menu-selected-background);\n  font-weight: var(--font-weight-semibold, 600);\n}\n\n#sidebar-context-menu-customizer-editor-panel\n  .sidebar-menu-editor-filter:hover:not([aria-selected="true"]) {\n  color: var(--sidebar-menu-list-hover-text);\n  background: var(--sidebar-menu-list-hover);\n}\n\n#sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-filter-count {\n  min-inline-size: 1.25em;\n  font-variant-numeric: tabular-nums;\n  text-align: center;\n}\n\n#sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-list-region {\n  padding: 0 1em 1em;\n}\n\n#sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-list {\n  overflow: hidden;\n  border: 1px solid var(--zen-editor-border);\n  border-radius: 0.62em;\n  background: var(--sidebar-menu-box-background);\n}\n\n#sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-action {\n  position: relative;\n  min-inline-size: 0;\n}\n\n#sidebar-context-menu-customizer-editor-panel\n  .sidebar-menu-editor-action\n  + .sidebar-menu-editor-action::before {\n  position: absolute;\n  z-index: 1;\n  inset-block-start: 0;\n  inset-inline: 2.7em 0.75em;\n  border-block-start: 1px solid var(--zen-editor-border);\n  content: "";\n  pointer-events: none;\n}\n\n#sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-action-toggle {\n  display: grid;\n  grid-template-columns: 1.23em minmax(0, 1fr);\n  align-items: center;\n  gap: 0.77em;\n  inline-size: 100%;\n  min-block-size: 3.08em;\n  padding: 0.62em 0.77em;\n  color: var(--zen-editor-text);\n  cursor: default;\n  line-height: normal;\n  text-align: start;\n}\n\n#sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-action-toggle:hover {\n  color: var(--sidebar-menu-list-hover-text);\n  background: var(--sidebar-menu-list-hover);\n}\n\n#sidebar-context-menu-customizer-editor-panel\n  .sidebar-menu-editor-action-toggle:hover:active {\n  background: var(--zen-editor-control-background-active);\n}\n\n#sidebar-context-menu-customizer-editor-panel\n  .sidebar-menu-editor-action-toggle:focus-visible {\n  outline-offset: -2px;\n}\n\n#sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-check {\n  box-sizing: border-box;\n  display: grid;\n  place-items: center;\n  inline-size: 1.23em;\n  block-size: 1.23em;\n  border: 1px solid var(--border-color-interactive, var(--zen-editor-border));\n  border-radius: 0.31em;\n  color: var(--sidebar-menu-selected-text);\n  background: var(--zen-editor-background);\n}\n\n#sidebar-context-menu-customizer-editor-panel\n  .sidebar-menu-editor-action-toggle[aria-checked="true"]\n  .sidebar-menu-editor-check {\n  border-color: var(--sidebar-menu-selected-background);\n  background: var(--sidebar-menu-selected-background);\n}\n\n#sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-check-icon {\n  display: none;\n  inline-size: 0.92em;\n  block-size: 0.92em;\n  -moz-context-properties: fill, fill-opacity;\n  fill: currentColor;\n  fill-opacity: 1;\n  pointer-events: none;\n}\n\n#sidebar-context-menu-customizer-editor-panel\n  .sidebar-menu-editor-action-toggle[aria-checked="true"]\n  .sidebar-menu-editor-check-icon {\n  display: block;\n}\n\n#sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-action-label {\n  min-inline-size: 0;\n  overflow-wrap: break-word;\n  color: inherit;\n  font: inherit;\n  white-space: normal;\n}\n\n#sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-empty {\n  margin: 0;\n  padding: 2.4em 1em;\n  color: var(--zen-editor-muted);\n  text-align: center;\n}\n\n#sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-status {\n  color: var(--zen-editor-muted);\n  font-size: 0.85em;\n  font-variant-numeric: tabular-nums;\n}\n\n#sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-footer-actions {\n  display: flex;\n  gap: 0.6em;\n  margin-inline-start: auto;\n}\n\n#sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-button {\n  min-block-size: 2.45em;\n  padding: 0.5em 0.85em;\n  border: 1px solid var(--zen-editor-border);\n  border-radius: var(--zen-editor-control-radius);\n  color: var(--zen-editor-control-text);\n  background: var(--zen-editor-control-background);\n  cursor: default;\n  line-height: 1;\n}\n\n#sidebar-context-menu-customizer-editor-panel\n  .sidebar-menu-editor-button:hover:not(:disabled) {\n  background: var(--zen-editor-control-background-hover);\n}\n\n#sidebar-context-menu-customizer-editor-panel\n  .sidebar-menu-editor-button:hover:active:not(:disabled) {\n  background: var(--zen-editor-control-background-active);\n}\n\n#sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-button:disabled {\n  opacity: 0.4;\n}\n\n#sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-button-primary {\n  border-color: transparent;\n  color: var(--zen-editor-primary-text);\n  background: var(--zen-editor-primary-background);\n  font-weight: var(--font-weight-semibold, 600);\n}\n\n#sidebar-context-menu-customizer-editor-panel\n  .sidebar-menu-editor-button-primary:hover:not(:disabled) {\n  color: var(--zen-editor-primary-text-hover);\n  background: var(--zen-editor-primary-background-hover);\n}\n\n#sidebar-context-menu-customizer-editor-panel\n  .sidebar-menu-editor-button-primary:hover:active:not(:disabled) {\n  color: var(--zen-editor-primary-text-active);\n  background: var(--zen-editor-primary-background-active);\n}\n\n@container zen-editor-panel (max-width: 28em) {\n  #sidebar-context-menu-customizer-editor-panel .sidebar-menu-editor-filters {\n    display: grid;\n    grid-template-columns: repeat(3, minmax(0, 1fr));\n    inline-size: 100%;\n  }\n}\n\n@media (forced-colors: active) {\n  #sidebar-context-menu-customizer-editor-panel {\n    --sidebar-menu-box-background: Canvas;\n    --sidebar-menu-list-hover: Highlight;\n    --sidebar-menu-list-hover-text: HighlightText;\n    --sidebar-menu-selected-background: Highlight;\n    --sidebar-menu-selected-text: HighlightText;\n  }\n}\n';

// src/platform/editor.ts
var XHTML_NAMESPACE2 = "http://www.w3.org/1999/xhtml";
var PANEL_ID = "sidebar-context-menu-customizer-editor-panel";
var ACTION_LIST_ID = `${PANEL_ID}-actions`;
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
var createTabMenuEditor = ({
  document,
  actions,
  readExcludedFromRootIds,
  writeExcludedFromRootIds,
  onClose
}) => {
  const ownerWindow = document.defaultView;
  let destroyed = false;
  let focusFrame = null;
  let focusEpoch = 0;
  let activeFilter = "all";
  let visibleActions = [];
  let render = (_focusKey, _resetScroll) => {
  };
  const cancelPendingFocus = () => {
    focusEpoch += 1;
    if (focusFrame !== null) {
      ownerWindow?.cancelAnimationFrame(focusFrame);
      focusFrame = null;
    }
  };
  const scheduleFocus = (callback) => {
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
    description: "Checked actions appear directly in the tab menu. Unchecked actions remain under More actions.",
    searchLabel: "Search tab menu actions",
    searchPlaceholder: "Search actions",
    styles: editor_styles_default,
    onQueryChange: () => render(void 0, true),
    onClose: () => {
      cancelPendingFocus();
      onClose?.();
    }
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
    if (destroyed) {
      return;
    }
    activeFilter = filter;
    render(void 0, true);
    if (focus) {
      scheduleFocus(() => filterButtons.get(filter)?.focus());
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
      if (destroyed) {
        return;
      }
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
    cancelPendingFocus();
    if (destroyed) {
      return;
    }
    const previousScroll = panel.body.scrollTop;
    const allActions = actions();
    const totals = groupCustomizationActions(allActions);
    const matching = filterCustomizationActions(allActions, panel.searchInput.value).sort(
      compareCustomizationActions
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
    listRegion.replaceChildren(list);
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
      scheduleFocus(() => {
        if (!focusKey || !focusAction(focusKey)) {
          filterButtons.get(activeFilter)?.focus();
        }
      });
    }
  };
  panel.searchInput.addEventListener("keydown", (event) => {
    if (destroyed) {
      return;
    }
    if (event.key !== "Escape" || !panel.searchInput.value) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    panel.searchInput.value = "";
    render(void 0, true);
  });
  panel.element.addEventListener("keydown", (event) => {
    if (destroyed) {
      return;
    }
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
    if (destroyed) {
      return;
    }
    writeExcludedFromRootIds(/* @__PURE__ */ new Set());
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
      render(void 0, true);
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
    }
  };
};

// src/platform/presentation-session.ts
var EMPTY_SEPARATOR_ATTRIBUTE = "data-sidebar-context-menu-customizer-empty";
var PresentationSession = class {
  excludedFromRootIds;
  #actionKeys = /* @__PURE__ */ new Map();
  #browserHiddenStates = /* @__PURE__ */ new Map();
  #closed = false;
  #moreActionsMenu;
  #moreActionsPopup;
  #movedActions = /* @__PURE__ */ new Set();
  #observer = null;
  #root;
  #rootOrder;
  constructor({
    excludedFromRootIds,
    moreActionsMenu,
    moreActionsPopup,
    root,
    rootOrder
  }) {
    this.excludedFromRootIds = new Set(excludedFromRootIds);
    this.#moreActionsMenu = moreActionsMenu;
    this.#moreActionsPopup = moreActionsPopup;
    this.#root = root;
    this.#rootOrder = [...rootOrder];
  }
  get closed() {
    return this.#closed;
  }
  attachObserver(observer) {
    if (this.#closed) {
      observer.disconnect();
      observer.takeRecords();
      return;
    }
    if (this.#observer) {
      observer.disconnect();
      observer.takeRecords();
      throw new Error("presentation session already owns an observer");
    }
    this.#observer = observer;
  }
  discardObserverRecords() {
    this.#observer?.takeRecords();
  }
  recordActionKeys(nodes, facts) {
    if (this.#closed) {
      return;
    }
    for (const fact of facts) {
      if (fact.kind === "action") {
        const node = nodes[fact.originalIndex];
        if (node) {
          this.#actionKeys.set(node, fact.key);
        }
      }
    }
  }
  moveActions(nodes) {
    if (this.#closed) {
      return;
    }
    for (const node of nodes) {
      this.#movedActions.add(node);
    }
    this.#moreActionsPopup.append(...nodes);
  }
  hideTemporarily(node) {
    if (this.#closed) {
      return;
    }
    if (!this.#browserHiddenStates.has(node)) {
      this.#browserHiddenStates.set(node, node.hidden);
    }
    node.setAttribute(EMPTY_SEPARATOR_ATTRIBUTE, "true");
    node.hidden = true;
  }
  restoreSeparatorPresentation() {
    if (this.#closed) {
      return;
    }
    for (const [node, hidden] of this.#browserHiddenStates) {
      node.hidden = hidden;
      node.removeAttribute(EMPTY_SEPARATOR_ATTRIBUTE);
    }
    this.#browserHiddenStates.clear();
    for (const node of this.#root.children) {
      node.removeAttribute(EMPTY_SEPARATOR_ATTRIBUTE);
    }
  }
  mergeCurrentRootOrder(rootChildren) {
    if (this.#closed) {
      return;
    }
    for (const node of rootChildren) {
      if (this.#rootOrder.includes(node)) {
        continue;
      }
      const key = this.#actionKeys.get(node);
      if (!key) {
        continue;
      }
      const staleIndex = this.#rootOrder.findIndex(
        (candidate) => candidate !== node && !candidate.isConnected && this.#actionKeys.get(candidate) === key
      );
      if (staleIndex >= 0) {
        const [staleNode] = this.#rootOrder.splice(staleIndex, 1);
        if (staleNode) {
          this.#movedActions.delete(staleNode);
          this.#actionKeys.delete(staleNode);
        }
      }
    }
    let anchorIndex = null;
    for (let index = rootChildren.length - 1; index >= 0; index -= 1) {
      const node = rootChildren[index];
      if (!node) {
        continue;
      }
      const existingIndex = this.#rootOrder.indexOf(node);
      if (existingIndex >= 0) {
        anchorIndex = existingIndex;
        continue;
      }
      const insertionIndex = anchorIndex ?? this.#rootOrder.length;
      this.#rootOrder.splice(insertionIndex, 0, node);
      anchorIndex = insertionIndex;
    }
  }
  close() {
    if (this.#closed) {
      return false;
    }
    this.#closed = true;
    this.#observer?.disconnect();
    this.#observer?.takeRecords();
    this.#observer = null;
    let nextSurvivingSibling = null;
    for (let index = this.#rootOrder.length - 1; index >= 0; index -= 1) {
      const node = this.#rootOrder[index];
      if (!node) {
        continue;
      }
      if (node.parentElement === this.#root) {
        nextSurvivingSibling = node;
        continue;
      }
      if (this.#movedActions.has(node) && node.parentElement === this.#moreActionsPopup) {
        this.#root.insertBefore(node, nextSurvivingSibling);
        nextSurvivingSibling = node;
      }
    }
    for (const [node, hidden] of this.#browserHiddenStates) {
      node.hidden = hidden;
      node.removeAttribute(EMPTY_SEPARATOR_ATTRIBUTE);
    }
    for (const node of this.#root.children) {
      node.removeAttribute(EMPTY_SEPARATOR_ATTRIBUTE);
    }
    this.#moreActionsMenu.hidden = true;
    this.#actionKeys.clear();
    this.#browserHiddenStates.clear();
    this.#movedActions.clear();
    this.#rootOrder = [];
    return true;
  }
};
var armSynchronousPopupFinalizer = (ownerWindow, sourceEvent, finalize, deferCleanup = queueMicrotask) => {
  let active = true;
  const cancel = () => {
    if (!active) {
      return;
    }
    active = false;
    ownerWindow.removeEventListener("popupshowing", onWindowShowing);
  };
  const onWindowShowing = (event) => {
    if (!active || event !== sourceEvent) {
      return;
    }
    cancel();
    finalize();
  };
  ownerWindow.addEventListener("popupshowing", onWindowShowing);
  deferCleanup(cancel);
  return cancel;
};

// src/platform/menu.ts
var TAB_MENU_ID = "tabContextMenu";
var CUSTOMIZER_SEPARATOR_ID = "sidebar-context-menu-customizer-tab-separator";
var CUSTOMIZER_ITEM_ID = "sidebar-context-menu-customizer-tab-menu";
var MORE_ACTIONS_MENU_ID = "sidebar-context-menu-customizer-more-actions-menu";
var MORE_ACTIONS_POPUP_ID = "sidebar-context-menu-customizer-more-actions-popup";
var COMPACT_MODE_MARKER_ID = "sidebar-context-menu-customizer-compact-mode-marker";
var ownIds = /* @__PURE__ */ new Set([
  CUSTOMIZER_SEPARATOR_ID,
  CUSTOMIZER_ITEM_ID,
  MORE_ACTIONS_MENU_ID,
  MORE_ACTIONS_POPUP_ID
]);
var actionIdentity = (node) => ({
  id: node.id,
  l10nId: node.getAttribute("data-l10n-id") ?? node.getAttribute("data-lazy-l10n-id"),
  command: node.getAttribute("command"),
  className: node.getAttribute("class")
});
var isActionCandidate = (node) => (node.localName === "menu" || node.localName === "menuitem") && !ownIds.has(node.id);
var browserShows = (node) => !node.hidden;
var fallbackLabel = (id) => id.replace(/^context_/, "").replace(/^zen-/, "").replaceAll(/[-_]+/g, " ").replaceAll(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (first) => first.toUpperCase());
var itemLabel = (node) => {
  const command = node.getAttribute("command");
  return node.getAttribute("label")?.trim() || fallbackLabel(
    node.id || node.getAttribute("data-l10n-id") || node.getAttribute("data-lazy-l10n-id") || (command ? `command:${command}` : "action")
  );
};
var presentationSources = (nodes) => nodes.map((node, originalIndex) => {
  const kind = node.localName === "menuseparator" ? "separator" : isActionCandidate(node) ? "action" : "control";
  return {
    browserVisible: browserShows(node),
    controlRole: node.id === MORE_ACTIONS_MENU_ID ? "more-actions" : "ordinary",
    identity: kind === "action" ? actionIdentity(node) : null,
    key: node.id || `${node.localName}:${originalIndex}`,
    kind,
    label: kind === "separator" ? "" : itemLabel(node),
    originalIndex
  };
});
var installTabMenuCustomizer = (readExcludedFromRootIds, writeExcludedFromRootIds) => {
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
  document.getElementById(COMPACT_MODE_MARKER_ID)?.remove();
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
  customizerItem.setAttribute("label", "Customize context menu…");
  tabMenu.append(customizerSeparator, moreActionsMenu, customizerItem);
  const compactModeMarker = document.createXULElement("box");
  compactModeMarker.id = COMPACT_MODE_MARKER_ID;
  compactModeMarker.hidden = true;
  document.getElementById("navigator-toolbox")?.append(compactModeMarker);
  const releaseCompactMode = () => {
    compactModeMarker.removeAttribute("open");
  };
  let activeSession = null;
  let cancelPendingFinalizer = null;
  const cancelFinalizer = () => {
    cancelPendingFinalizer?.();
    cancelPendingFinalizer = null;
  };
  const closePresentation = () => {
    activeSession?.close();
    activeSession = null;
  };
  const clearPresentation = () => {
    cancelFinalizer();
    closePresentation();
  };
  const snapshotNodes = (nodes, excludedFromRoot) => ({
    nodes,
    snapshot: createPresentationSnapshot(presentationSources(nodes), excludedFromRoot)
  });
  const currentRootSnapshot = () => {
    const presentation = snapshotNodes(
      [...tabMenu.children],
      readExcludedFromRootIds()
    );
    if (presentation.snapshot.initialized) {
      writeExcludedFromRootIds(presentation.snapshot.excludedFromRootIds);
    }
    return presentation;
  };
  const currentExcludedFromRootIds = () => currentRootSnapshot().snapshot.excludedFromRootIds;
  const organizeMoreActions = (session) => {
    const presentation = snapshotNodes(
      [...moreActionsPopup.children],
      session.excludedFromRootIds
    );
    session.recordActionKeys(presentation.nodes, presentation.snapshot.facts);
    const actionsInCurrentOrder = presentation.snapshot.facts.filter(
      (fact) => fact.kind === "action"
    );
    const actions = sortPresentationActions(actionsInCurrentOrder);
    const currentOrder = actionsInCurrentOrder.map(
      (fact) => presentation.nodes[fact.originalIndex]
    );
    const desiredOrder = actions.map(
      (fact) => presentation.nodes[fact.originalIndex]
    );
    if (desiredOrder.some((node, index) => currentOrder[index] !== node)) {
      moreActionsPopup.append(...desiredOrder);
    }
    moreActionsMenu.hidden = !actions.some((action) => action.browserVisible);
  };
  const moveLateExcludedActions = (session) => {
    const presentation = snapshotNodes(
      [...tabMenu.children],
      session.excludedFromRootIds
    );
    session.recordActionKeys(presentation.nodes, presentation.snapshot.facts);
    session.mergeCurrentRootOrder(presentation.nodes);
    const lateActions = presentation.snapshot.facts.filter((fact) => fact.kind === "action" && !fact.selected).map((fact) => presentation.nodes[fact.originalIndex]);
    session.moveActions(lateActions);
    return presentation;
  };
  const applySeparatorPlan = (session, nodes, plan) => {
    for (const originalIndex of plan.hiddenSeparatorIndexes) {
      const separator = nodes[originalIndex];
      if (separator?.localName === "menuseparator") {
        session.hideTemporarily(separator);
      }
    }
  };
  const moveExcludedActions = (session, presentation) => {
    session.recordActionKeys(presentation.nodes, presentation.snapshot.facts);
    const plan = planMenuPresentation(presentation.snapshot.facts);
    const actionNodes = plan.moreActions.map(
      (fact) => presentation.nodes[fact.originalIndex]
    );
    session.moveActions(actionNodes);
    moreActionsMenu.hidden = !plan.moreActionsVisible;
    applySeparatorPlan(session, presentation.nodes, plan);
  };
  const updatePresentation = (session, records) => {
    if (activeSession !== session || session.closed) {
      return;
    }
    const rootChanged = records.some((record) => record.target === tabMenu);
    const moreActionsChanged = records.some((record) => record.target === moreActionsPopup);
    if (!rootChanged && !moreActionsChanged) {
      return;
    }
    if (rootChanged) {
      const presentation = moveLateExcludedActions(session);
      session.restoreSeparatorPresentation();
      applySeparatorPlan(
        session,
        presentation.nodes,
        planMenuPresentation(presentation.snapshot.facts)
      );
    }
    organizeMoreActions(session);
    session.discardObserverRecords();
  };
  const createPresentationSession = () => {
    const presentation = currentRootSnapshot();
    const session = new PresentationSession({
      excludedFromRootIds: presentation.snapshot.excludedFromRootIds,
      moreActionsMenu,
      moreActionsPopup,
      root: tabMenu,
      rootOrder: presentation.nodes
    });
    activeSession = session;
    try {
      moveExcludedActions(session, presentation);
      const observer = new MutationObserver(
        (records) => updatePresentation(session, records)
      );
      session.attachObserver(observer);
      observer.observe(tabMenu, { childList: true });
      observer.observe(moreActionsPopup, { childList: true });
    } catch (error) {
      session.close();
      if (activeSession === session) {
        activeSession = null;
      }
      throw error;
    }
  };
  const editorActions = () => {
    const presentation = currentRootSnapshot();
    const actions = presentation.snapshot.facts.filter(
      (fact) => fact.kind === "action"
    );
    return coalesceCustomizationActions(actions).map(
      ({ key, keys, label, selected }) => ({ key, keys, label, selected })
    );
  };
  const editor = createTabMenuEditor({
    document,
    actions: editorActions,
    readExcludedFromRootIds: currentExcludedFromRootIds,
    writeExcludedFromRootIds,
    onClose: releaseCompactMode
  });
  if (!editor) {
    console.error("[sidebar-context-menu-customizer] editor panel is unavailable");
  }
  const ownerWindow = window;
  let destroyed = false;
  let editorOpenFrame = null;
  let editorOpenEpoch = 0;
  let editorAnchor = null;
  const cancelDeferredEditorOpen = () => {
    editorOpenEpoch += 1;
    if (editorOpenFrame !== null) {
      ownerWindow.cancelAnimationFrame(editorOpenFrame);
      editorOpenFrame = null;
    }
  };
  const onBeforeShowing = (event) => {
    if (!destroyed && event.target === tabMenu) {
      clearPresentation();
    }
  };
  const onShowing = (event) => {
    if (!destroyed && event.target === tabMenu) {
      editorAnchor = window.TabContextMenu?.contextTab ?? null;
      cancelFinalizer();
      let cancel = () => {
      };
      cancel = armSynchronousPopupFinalizer(
        ownerWindow,
        event,
        () => {
          if (cancelPendingFinalizer === cancel) {
            cancelPendingFinalizer = null;
          }
          if (!destroyed) {
            createPresentationSession();
          }
        },
        (callback) => ownerWindow.queueMicrotask(callback)
      );
      cancelPendingFinalizer = cancel;
    }
  };
  const onHidden = (event) => {
    if (!destroyed && event.target === tabMenu) {
      clearPresentation();
    }
  };
  const onCustomize = () => {
    if (destroyed || !editor) {
      return;
    }
    if (document.documentElement.getAttribute("zen-compact-mode") === "true") {
      compactModeMarker.setAttribute("open", "true");
    }
    const anchor = editorAnchor ?? ownerWindow.TabContextMenu?.contextTab ?? document.getElementById("tabbrowser-tabs") ?? document.documentElement;
    cancelDeferredEditorOpen();
    const epoch = editorOpenEpoch;
    editorOpenFrame = ownerWindow.requestAnimationFrame(() => {
      if (destroyed || epoch !== editorOpenEpoch) {
        return;
      }
      editorOpenFrame = null;
      editor?.open(anchor);
    });
  };
  tabMenu.addEventListener("popupshowing", onBeforeShowing, true);
  tabMenu.addEventListener("popupshowing", onShowing);
  tabMenu.addEventListener("popuphidden", onHidden);
  customizerItem.addEventListener("command", onCustomize);
  return () => {
    if (destroyed) {
      return;
    }
    destroyed = true;
    cancelDeferredEditorOpen();
    tabMenu.removeEventListener("popupshowing", onBeforeShowing, true);
    tabMenu.removeEventListener("popupshowing", onShowing);
    tabMenu.removeEventListener("popuphidden", onHidden);
    customizerItem.removeEventListener("command", onCustomize);
    editorAnchor = null;
    releaseCompactMode();
    editor?.destroy();
    clearPresentation();
    customizerSeparator.remove();
    moreActionsMenu.remove();
    customizerItem.remove();
    compactModeMarker.remove();
  };
};

// src/platform/prefs.ts
var PREF_EXCLUDED_ROOT_TAB_ITEMS = "zen.sidebar-context-menu-customizer.tab.excluded-root-items";
var PREF_LEGACY_HIDDEN_TAB_ITEMS = "zen.sidebar-context-menu-customizer.tab.hidden-items";
var PREF_TAB_ITEMS_INITIALIZED = "zen.sidebar-context-menu-customizer.tab.opt-in-initialized";
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

// ../../packages/sine-lifecycle/dist/errors.js
var isThenable = (value) => (typeof value === "object" || typeof value === "function") && value !== null && "then" in value && typeof value.then === "function";
var safeReporter = (report = () => {
}) => (error) => {
  try {
    const result = report(error);
    if (isThenable(result)) {
      void Promise.resolve(result).catch(() => {
      });
    }
  } catch {
  }
};
var synchronousDisposer = (disposer, report) => () => {
  const result = disposer();
  if (!isThenable(result)) {
    return;
  }
  void Promise.resolve(result).catch(report);
  throw new TypeError("lifecycle disposers must finish synchronously");
};

// ../../packages/sine-lifecycle/dist/disposable-scope.js
var DisposableScope = class {
  #disposers;
  #report;
  #live = true;
  constructor({ onDisposeError } = {}) {
    if (typeof DisposableStack !== "function") {
      throw new Error("@zen-mods/sine-lifecycle requires DisposableStack");
    }
    this.#disposers = new DisposableStack();
    this.#report = safeReporter(onDisposeError);
  }
  isLive() {
    return this.#live;
  }
  defer(disposer) {
    const synchronous = synchronousDisposer(disposer, this.#report);
    if (this.#live) {
      this.#disposers.defer(synchronous);
      return;
    }
    try {
      synchronous();
    } catch (error) {
      this.#report(error);
    }
  }
  stop() {
    if (!this.#live) {
      return false;
    }
    this.#live = false;
    try {
      this.#disposers.dispose();
    } catch (error) {
      this.#report(error);
    }
    return true;
  }
};

// ../../packages/sine-lifecycle/dist/sine-window.js
var bindSineWindowLifecycle = (target, owner) => {
  const stopForSine = () => owner.stop("sine-unload");
  const stopForWindow = () => owner.stop("window-unload");
  owner.defer(() => {
    target.removeEventListener("unload", stopForWindow, { capture: false });
  });
  target.addEventListener("unload", stopForWindow, { capture: false, once: true });
  const sineUnload = typeof target.addUnloadListener === "function" ? "registered" : "unavailable";
  if (sineUnload === "registered") {
    target.addUnloadListener?.(stopForSine);
  }
  return { sineUnload };
};

// src/platform/sine.ts
var startGeneration = () => {
  window.zenSidebarContextMenuCustomizer?.stop("replacement");
  const scope = new DisposableScope({
    onDisposeError: (error) => {
      console.error("[sidebar-context-menu-customizer] disposer failed", error);
    }
  });
  let stopReason = null;
  const generation2 = {
    get stopReason() {
      return stopReason;
    },
    defer: (disposer) => scope.defer(disposer),
    isLive: () => scope.isLive(),
    stop(reason = "manual") {
      if (!scope.isLive()) {
        return false;
      }
      stopReason = reason;
      return scope.stop();
    }
  };
  window.zenSidebarContextMenuCustomizer = generation2;
  generation2.defer(() => {
    if (window.zenSidebarContextMenuCustomizer === generation2) {
      delete window.zenSidebarContextMenuCustomizer;
    }
  });
  try {
    const binding = bindSineWindowLifecycle(window, generation2);
    if (binding.sineUnload === "unavailable") {
      console.error("[sidebar-context-menu-customizer] Sine unload hook is unavailable");
    }
  } catch (error) {
    generation2.stop("startup-failure");
    throw error;
  }
  return generation2;
};

// src/main.ts
var generation = startGeneration();
generation.defer(() => {
  console.info("[sidebar-context-menu-customizer] unloaded");
});
try {
  generation.defer(
    installTabMenuCustomizer(readExcludedRootTabItems, writeExcludedRootTabItems)
  );
} catch (error) {
  generation.stop("startup-failure");
  throw error;
}
console.info("[sidebar-context-menu-customizer] ready");
