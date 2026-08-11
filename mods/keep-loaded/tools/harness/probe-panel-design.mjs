/**
 * Renders the M16.C01-D status-panel proposal in the exact Zen chrome document.
 *
 * This is a design probe, not a second implementation. It uses the native
 * CustomizableUI/PanelMultiView surface and Firefox platform tokens. Headless Gecko does
 * not include popup layers in screenshots, so the probe records the native popup's layout
 * first and then captures the same XUL contents in the chrome document for hierarchy,
 * wrapping, density, and token-contrast review. Generated PNGs are ignored under
 * `.benchmarks/ui/m16-c01d/`.
 *
 *     node tools/harness/probe-panel-design.mjs
 */

import { mkdir, writeFile } from "node:fs/promises";
import { openMarionette } from "./marionette.mjs";
import { launchZen } from "./zen.mjs";

const OUTPUT = new URL("../../../../.benchmarks/ui/m16-c01d/", import.meta.url);

const STATES = [
  {
    name: "mixed",
    total: "3 kept tabs",
    summary: "1 sleeping · 2 awake",
    primary: "Wake 1 sleeping tab",
    reset: true,
    groups: [
      {
        space: "Work",
        rows: [
          {
            title: "mail.google.com",
            state: "Sleeping",
            severity: "attention",
            detail: "Unloaded 2m ago",
          },
          {
            title: "slack.com",
            state: "Awake",
            detail: "Title changed 12s ago",
            diagnostic: "WebSocket activity 3s ago",
          },
        ],
      },
      {
        space: "Home",
        rows: [
          {
            title: "calendar.google.com",
            state: "Quiet",
            detail: "Last sign 18m ago",
          },
        ],
      },
    ],
  },
  {
    name: "busy",
    total: "3 kept tabs",
    summary: "1 sleeping · 2 awake",
    primary: "Waking…",
    primaryDisabled: true,
    groups: [
      {
        space: "Work",
        rows: [
          {
            title: "mail.google.com",
            state: "Sleeping",
            severity: "attention",
            detail: "Waiting for SessionStore",
          },
          {
            title: "slack.com",
            state: "Awake",
            detail: "Title changed 12s ago",
          },
        ],
      },
    ],
    feedback: "Waking 1 sleeping tab…",
  },
  {
    name: "recovery-limit",
    total: "2 kept tabs",
    summary: "1 needs attention · 1 awake",
    reset: true,
    groups: [
      {
        space: "Work",
        rows: [
          {
            title: "mail.google.com",
            state: "Crashed",
            severity: "critical",
            detail: "Recovery limit reached · 3 of 3 attempts used",
          },
          {
            title: "slack.com",
            state: "Awake",
            detail: "Title changed 12s ago",
          },
        ],
      },
    ],
  },
  {
    name: "empty",
    empty: true,
    total: "Keep a pinned tab awake",
    summary: "Add sites in Sine settings, or use Keep loaded in a pinned tab’s menu.",
  },
  {
    name: "unavailable",
    unavailable: true,
    total: "Status unavailable",
    summary: "Keep Loaded couldn’t inspect tabs. Check the Browser Console for details.",
    primary: "Unavailable",
    primaryDisabled: true,
  },
];

const DESIGN_CSS = `
  #keep-loaded-design-view {
    --keep-loaded-panel-inline-size: 25em;
  }

  #keep-loaded-design-view label {
    margin: 0;
  }

  #keep-loaded-design-body {
    box-sizing: border-box;
    inline-size: var(--keep-loaded-panel-inline-size);
    max-inline-size: calc(100vw - 2em);
    max-block-size: min(34em, calc(100vh - 10em));
    padding: var(--dimension-12, 12px) !important;
    gap: var(--dimension-8, 8px);
  }

  .keep-loaded-design-summary {
    gap: var(--dimension-2, 2px);
  }

  .keep-loaded-design-total {
    font-size: 1.05em;
    font-weight: var(--font-weight-semibold, 600);
  }

  .keep-loaded-design-summary-line,
  .keep-loaded-design-detail,
  .keep-loaded-design-diagnostic,
  #keep-loaded-design-feedback {
    white-space: pre-wrap;
    color: var(--text-color-deemphasized);
  }

  .keep-loaded-design-groups {
    gap: var(--dimension-12, 12px);
  }

  .keep-loaded-design-group {
    gap: var(--dimension-4, 4px);
  }

  .keep-loaded-design-space {
    color: var(--text-color-deemphasized);
    font-size: var(--font-size-small, 0.9em);
    font-weight: var(--font-weight-semibold, 600);
    text-transform: uppercase;
  }

  .keep-loaded-design-row {
    padding-block: var(--dimension-4, 4px);
    gap: 0;
    border-block-start: 1px solid var(--panel-separator-color);
  }

  .keep-loaded-design-row-head {
    align-items: center;
    gap: var(--dimension-8, 8px);
  }

  .keep-loaded-design-title {
    min-inline-size: 0;
    max-inline-size: 18em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .keep-loaded-design-state {
    padding: 1px var(--dimension-4, 4px);
    color: var(--text-color-deemphasized);
    font-size: var(--font-size-small, 0.9em);
  }

  .keep-loaded-design-row[data-severity="attention"] .keep-loaded-design-state {
    border: 1px solid var(--icon-color-warning, currentColor);
    border-radius: var(--border-radius-small, 4px);
    color: var(--icon-color-warning, currentColor);
    font-weight: var(--font-weight-semibold, 600);
  }

  .keep-loaded-design-row[data-severity="critical"] .keep-loaded-design-state {
    border: 1px solid var(--icon-color-critical, currentColor);
    border-radius: var(--border-radius-small, 4px);
    color: var(--icon-color-critical, currentColor);
    font-weight: var(--font-weight-semibold, 600);
  }

  .keep-loaded-design-diagnostic {
    font-size: var(--font-size-small, 0.9em);
  }

  .keep-loaded-design-message {
    padding: var(--dimension-8, 8px);
    border-inline-start: 3px solid var(--icon-color-critical, currentColor);
    border-radius: var(--border-radius-small, 4px);
    background: var(--background-color-critical, var(--button-background-color));
  }

  #keep-loaded-design-footer {
    box-sizing: border-box;
    inline-size: var(--keep-loaded-panel-inline-size);
    max-inline-size: calc(100vw - 2em);
    padding: 0 var(--dimension-4, 4px) var(--dimension-4, 4px);
  }

  #keep-loaded-design-primary:not([disabled]) {
    color: var(--button-text-color-primary);
    background-color: var(--button-background-color-primary);
  }

  #keep-loaded-design-primary:not([disabled]):hover {
    color: var(--button-text-color-primary-hover, var(--button-text-color-primary));
    background-color: var(--button-background-color-primary-hover);
  }

  #keep-loaded-design-feedback {
    padding-inline: var(--dimension-8, 8px);
    font-size: var(--font-size-small, 0.9em);
  }

  @media (forced-colors: active) {
    .keep-loaded-design-state,
    .keep-loaded-design-message {
      color: CanvasText !important;
      border-color: CanvasText !important;
      background: Canvas !important;
    }
  }
`;

const INSTALL = `
  const [css, initialState] = arguments;
  const done = arguments[arguments.length - 1];
  const VIEW_ID = "keep-loaded-design-view";
  const BUTTON_ID = "keep-loaded-design-button";

  const sheet = document.createElementNS("http://www.w3.org/1999/xhtml", "style");
  sheet.id = "keep-loaded-design-styles";
  sheet.textContent = css;
  document.documentElement.appendChild(sheet);

  const cache = document.getElementById("appMenu-viewCache");
  const markup =
    '<panelview id="' + VIEW_ID + '" class="PanelUI-subView" mainview-with-header="true">' +
      '<box class="panel-header"><html:h1><html:span>Keep Loaded</html:span></html:h1></box>' +
      '<toolbarseparator/>' +
      '<vbox id="keep-loaded-design-body" class="panel-subview-body"/>' +
      '<toolbarseparator/>' +
      '<vbox id="keep-loaded-design-footer">' +
        '<toolbarbutton id="keep-loaded-design-primary" class="subviewbutton panel-subview-footer-button" closemenu="none"/>' +
        '<toolbarbutton id="keep-loaded-design-reset" class="subviewbutton panel-subview-footer-button" closemenu="none" label="Reset crash recovery history"/>' +
        '<label id="keep-loaded-design-feedback" role="status" aria-live="polite" aria-atomic="true"/>' +
      '</vbox>' +
    '</panelview>';
  cache.content.appendChild(MozXULElement.parseXULToFragment(markup));

  const value = (document, className, text) => {
    const node = document.createXULElement("label");
    node.className = className;
    node.setAttribute("value", text);
    return node;
  };

  const render = state => {
    const body = document.getElementById("keep-loaded-design-body") ||
      cache.content.querySelector("#keep-loaded-design-body");
    const primary = document.getElementById("keep-loaded-design-primary") ||
      cache.content.querySelector("#keep-loaded-design-primary");
    const reset = document.getElementById("keep-loaded-design-reset") ||
      cache.content.querySelector("#keep-loaded-design-reset");
    const feedback = document.getElementById("keep-loaded-design-feedback") ||
      cache.content.querySelector("#keep-loaded-design-feedback");
    body.textContent = "";

    const summary = document.createXULElement("vbox");
    summary.className = state.unavailable
      ? "keep-loaded-design-summary keep-loaded-design-message"
      : "keep-loaded-design-summary";
    summary.appendChild(value(document, "keep-loaded-design-total", state.total));
    summary.appendChild(value(document, "keep-loaded-design-summary-line", state.summary));
    body.appendChild(summary);

    if (state.groups?.length) {
      const groups = document.createXULElement("vbox");
      groups.className = "keep-loaded-design-groups";
      for (const group of state.groups) {
        const section = document.createXULElement("vbox");
        section.className = "keep-loaded-design-group";
        section.appendChild(value(document, "keep-loaded-design-space", group.space));
        for (const row of group.rows) {
          const rowNode = document.createXULElement("vbox");
          rowNode.className = "keep-loaded-design-row";
          if (row.severity) rowNode.dataset.severity = row.severity;
          const head = document.createXULElement("hbox");
          head.className = "keep-loaded-design-row-head";
          head.appendChild(value(document, "keep-loaded-design-title", row.title));
          const spacer = document.createXULElement("spacer");
          spacer.setAttribute("flex", "1");
          head.appendChild(spacer);
          head.appendChild(value(document, "keep-loaded-design-state", row.state));
          rowNode.appendChild(head);
          const evidence = [row.detail, row.diagnostic].filter(Boolean).join(" · ");
          rowNode.appendChild(value(document, "keep-loaded-design-detail", evidence));
          section.appendChild(rowNode);
        }
        groups.appendChild(section);
      }
      body.appendChild(groups);
    }

    primary.hidden = !state.primary;
    primary.setAttribute("label", state.primary || "");
    if (state.primaryDisabled) primary.setAttribute("disabled", "true");
    else primary.removeAttribute("disabled");
    reset.hidden = !state.reset;
    feedback.setAttribute("value", state.feedback || "");
  };

  window.__keepLoadedDesignRender = render;
  render(initialState);
  CustomizableUI.createWidget({
    id: BUTTON_ID,
    type: "view",
    viewId: VIEW_ID,
    localized: false,
    label: "Keep Loaded design",
    tooltiptext: "M16 status-panel design probe",
    defaultArea: "zen-sidebar-foot-buttons",
    onViewShowing: () => {},
  });
  const button = document.getElementById(BUTTON_ID);
  PanelUI.showSubView(VIEW_ID, button);
  setTimeout(() => done({ button: Boolean(button), view: Boolean(document.getElementById(VIEW_ID)) }), 700);
`;

const CLEANUP = `
  delete window.__keepLoadedDesignRender;
  CustomizableUI.destroyWidget("keep-loaded-design-button");
  document.getElementById("keep-loaded-design-capture")?.remove();
  document.getElementById("keep-loaded-design-view")?.remove();
  document.getElementById("appMenu-viewCache")?.content
    .querySelector("#keep-loaded-design-view")?.remove();
  document.getElementById("keep-loaded-design-styles")?.remove();
`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const main = async () => {
  await mkdir(OUTPUT, { recursive: true });
  const zen = await launchZen();
  let client;
  try {
    client = await openMarionette({ port: zen.port });
    await client.setScriptTimeout(40_000);
    const installed = await client.executeAsync(INSTALL, [DESIGN_CSS, STATES[0]]);
    if (!installed?.button || !installed?.view) {
      throw new Error(`design panel did not open: ${JSON.stringify(installed)}`);
    }

    // Headless Gecko composites native popups in a layer that neither WebDriver nor
    // drawWindow includes. After exercising the real PanelMultiView once, move the
    // same rendered view contents into a chrome-document capture surface. This
    // preserves the XUL nodes, native panel classes, platform tokens, and measured
    // width while making the pixels independently inspectable. The capture surface
    // itself is not a production proposal.
    await client.execute(`
      const view = document.getElementById("keep-loaded-design-view");
      const viewWidth = view?.getBoundingClientRect().width;
      const panel = view?.closest("panel");
      panel?.hidePopup();
      const capture = document.createXULElement("vbox");
      capture.id = "keep-loaded-design-capture";
      capture.className = "PanelUI-subView";
      capture.style.cssText = [
        "position: fixed",
        "top: 48px",
        "right: 48px",
        "display: flex",
        "width: " + viewWidth + "px",
        "min-height: 1px",
        "z-index: 2147483647",
        "overflow: hidden",
        "color: var(--arrowpanel-color)",
        "background: var(--arrowpanel-background)",
        "border: 1px solid var(--arrowpanel-border-color)",
        "border-radius: var(--arrowpanel-border-radius, 8px)",
        "box-shadow: var(--windows-panel-box-shadow, 0 4px 14px rgb(0 0 0 / 35%))",
      ].join(";");
      while (view.firstChild) capture.appendChild(view.firstChild);
      document.documentElement.appendChild(capture);
    `);

    const report = [];
    for (const state of STATES) {
      await client.execute("window.__keepLoadedDesignRender(arguments[0]);", [state]);
      await sleep(350);
      const layout = await client.execute(`
        const view = document.getElementById("keep-loaded-design-view");
        const body = document.getElementById("keep-loaded-design-body");
        const panel = document.getElementById("keep-loaded-design-capture");
        const box = node => {
          const rect = node?.getBoundingClientRect();
          return rect ? { height: Math.round(rect.height), width: Math.round(rect.width) } : null;
        };
        return { body: box(body), panel: box(panel), state: panel?.state ?? null, view: box(view) };
      `);
      if (
        !layout?.body ||
        !layout?.panel ||
        layout.body.width < 250 ||
        layout.body.height < 50 ||
        layout.panel.height < 100
      ) {
        throw new Error(
          `design capture has no meaningful layout: ${JSON.stringify(layout)}`,
        );
      }
      // Capture the explicit chrome-document review surface. WebDriver's chrome-context
      // screenshot and drawWindow both omit the native popup compositor layer in headless
      // Gecko, which is why the same panel contents were moved above.
      const encoded = await client.execute(`
        const panel = document.getElementById("keep-loaded-design-capture");
        const rect = panel?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return null;
        const scale = window.devicePixelRatio;
        const canvas = document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "canvas",
        );
        canvas.width = Math.ceil(rect.width * scale);
        canvas.height = Math.ceil(rect.height * scale);
        const context = canvas.getContext("2d");
        context.scale(scale, scale);
        context.drawWindow(
          window,
          rect.x,
          rect.y,
          rect.width,
          rect.height,
          "transparent",
        );
        return canvas.toDataURL("image/png").split(",", 2)[1];
      `);
      if (typeof encoded !== "string") {
        throw new TypeError(
          `Zen did not return a popup PNG screenshot: ${JSON.stringify(layout)}`,
        );
      }
      const target = new URL(`${state.name}.png`, OUTPUT);
      await writeFile(target, Buffer.from(encoded, "base64"));
      report.push({ file: target.pathname, layout, name: state.name });
    }

    console.log(JSON.stringify(report, null, 2));
  } finally {
    try {
      await client?.execute(CLEANUP);
    } catch {
      // The throwaway process owns final cleanup if the chrome document already closed.
    }
    await client?.quit();
    await zen.stop();
  }
};

await main();
