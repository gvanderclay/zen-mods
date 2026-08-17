export const TAB_MENU_EDITOR_STYLES = `
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
