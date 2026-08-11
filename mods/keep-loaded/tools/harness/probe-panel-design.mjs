/**
 * Renders the M16.C04 production status-panel structure in the exact Zen chrome document.
 *
 * This visual acceptance fixture uses the production XUL classes, committed stylesheet,
 * native CustomizableUI/PanelMultiView surface, and Firefox platform tokens. Headless
 * Gecko does not include popup layers in screenshots, so the probe records the native
 * popup's layout first and then captures the same XUL contents in the chrome document for
 * hierarchy, wrapping, density, and token-contrast review. Generated PNGs are ignored
 * under `.benchmarks/ui/m16-c04/`.
 *
 *     node tools/harness/probe-panel-design.mjs
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { openMarionette } from "./marionette.mjs";
import { launchZen } from "./zen.mjs";

const OUTPUT = new URL("../../../../.benchmarks/ui/m16-c04/", import.meta.url);
const WIDTHS = [280, 320, 480];
const THEMES = ["light", "dark"];
const TEXT_SCALES = [1, 2];

const overflowGroups = Array.from({ length: 5 }, (_, space) => ({
  space: `Space ${space + 1}`,
  rows: Array.from({ length: 4 }, (_, row) => ({
    title: `kept-${space + 1}-${row + 1}.example.test`,
    state: row === 0 ? "Sleeping" : "Awake",
    severity: row === 0 ? "attention" : undefined,
    detail: row === 0 ? "Unloaded 2m ago" : "Title changed 12s ago",
  })),
}));

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
  {
    name: "overflow",
    total: "20 kept tabs",
    summary: "5 sleeping · 15 awake",
    primary: "Wake 5 sleeping tabs",
    groups: overflowGroups,
  },
];

const INSTALL = `
  const [css, initialState] = arguments;
  const done = arguments[arguments.length - 1];
  const VIEW_ID = "keep-loaded-panelview";
  const BUTTON_ID = "keep-loaded-button";

  const sheet = document.createElementNS("http://www.w3.org/1999/xhtml", "style");
  sheet.id = "keep-loaded-visual-styles";
  sheet.textContent = css;
  document.documentElement.appendChild(sheet);

  const cache = document.getElementById("appMenu-viewCache");
  const markup =
    '<panelview id="' + VIEW_ID + '" class="PanelUI-subView keep-loaded-panelview" mainview-with-header="true">' +
      '<box class="panel-header"><html:h1><html:span>Keep Loaded</html:span></html:h1></box>' +
      '<toolbarseparator/>' +
      '<vbox id="keep-loaded-panel-body" class="panel-subview-body"/>' +
      '<toolbarseparator/>' +
      '<vbox class="keep-loaded-panel-footer">' +
        '<toolbarbutton id="keep-loaded-wake-button" class="subviewbutton panel-subview-footer-button keep-loaded-wake-button" closemenu="none"/>' +
        '<toolbarbutton id="keep-loaded-reset-button" class="subviewbutton panel-subview-footer-button keep-loaded-reset-button" closemenu="none" label="Reset crash recovery history"/>' +
        '<label id="keep-loaded-panel-feedback" class="keep-loaded-panel-feedback" role="status" aria-live="polite" aria-atomic="true"/>' +
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
    const body = document.getElementById("keep-loaded-panel-body") ||
      cache.content.querySelector("#keep-loaded-panel-body");
    const primary = document.getElementById("keep-loaded-wake-button") ||
      cache.content.querySelector("#keep-loaded-wake-button");
    const reset = document.getElementById("keep-loaded-reset-button") ||
      cache.content.querySelector("#keep-loaded-reset-button");
    const feedback = document.getElementById("keep-loaded-panel-feedback") ||
      cache.content.querySelector("#keep-loaded-panel-feedback");
    body.textContent = "";

    const summary = document.createXULElement("vbox");
    summary.className = state.unavailable
      ? "keep-loaded-panel-summary keep-loaded-panel-message"
      : "keep-loaded-panel-summary";
    summary.appendChild(value(document, "keep-loaded-panel-total", state.total));
    summary.appendChild(value(document, "keep-loaded-panel-summary-line", state.summary));
    body.appendChild(summary);

    if (state.groups?.length) {
      const groups = document.createXULElement("vbox");
      groups.className = "keep-loaded-panel-groups";
      for (const group of state.groups) {
        const section = document.createXULElement("vbox");
        section.className = "keep-loaded-panel-group";
        section.appendChild(value(document, "keep-loaded-space", group.space));
        for (const row of group.rows) {
          const rowNode = document.createXULElement("vbox");
          rowNode.className = "keep-loaded-row";
          if (row.severity) rowNode.dataset.severity = row.severity;
          const head = document.createXULElement("hbox");
          head.className = "keep-loaded-row-head";
          head.appendChild(value(document, "keep-loaded-row-title", row.title));
          const spacer = document.createXULElement("spacer");
          spacer.setAttribute("flex", "1");
          head.appendChild(spacer);
          head.appendChild(value(document, "keep-loaded-row-state", row.state));
          rowNode.appendChild(head);
          const evidence = [row.detail, row.diagnostic].filter(Boolean).join(" · ");
          rowNode.appendChild(value(document, "keep-loaded-row-detail", evidence));
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
  CustomizableUI.destroyWidget("keep-loaded-button");
  document.getElementById("keep-loaded-visual-capture")?.remove();
  document.getElementById("keep-loaded-panelview")?.remove();
  document.getElementById("appMenu-viewCache")?.content
    .querySelector("#keep-loaded-panelview")?.remove();
  document.getElementById("keep-loaded-visual-styles")?.remove();
`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const main = async () => {
  await mkdir(OUTPUT, { recursive: true });
  const css = await readFile(new URL("../../styles/chrome.css", import.meta.url), "utf8");
  const zen = await launchZen();
  let client;
  try {
    client = await openMarionette({ port: zen.port });
    await client.setScriptTimeout(40_000);
    const installed = await client.executeAsync(INSTALL, [css, STATES[0]]);
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
      const view = document.getElementById("keep-loaded-panelview");
      const viewWidth = view?.getBoundingClientRect().width;
      const panel = view?.closest("panel");
      panel?.hidePopup();
      const capture = document.createXULElement("vbox");
      capture.id = "keep-loaded-visual-capture";
      capture.className = "PanelUI-subView keep-loaded-panelview";
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
    for (const theme of THEMES) {
      for (const width of WIDTHS) {
        for (const textScale of TEXT_SCALES) {
          for (const state of STATES) {
            await client.execute(
              `
              const [state, width, theme, textScale] = arguments;
              const panel = document.getElementById("keep-loaded-visual-capture");
              panel.style.colorScheme = theme;
              panel.style.fontSize = textScale === 2 ? "200%" : "";
              panel.style.width = width + "px";
              panel.style.setProperty("--keep-loaded-panel-inline-size", width + "px");
              panel.style.setProperty("--arrowpanel-background", "Canvas");
              panel.style.setProperty("--arrowpanel-color", "CanvasText");
              panel.style.setProperty("--arrowpanel-border-color", "ButtonBorder");
              window.__keepLoadedDesignRender(state);
            `,
              [state, width, theme, textScale],
            );
            await sleep(120);
            const layout = await client.execute(`
        const view = document.getElementById("keep-loaded-panelview");
        const body = document.getElementById("keep-loaded-panel-body");
        const panel = document.getElementById("keep-loaded-visual-capture");
        const box = node => {
          const rect = node?.getBoundingClientRect();
          return rect ? { height: Math.round(rect.height), width: Math.round(rect.width) } : null;
        };
        const style = panel ? getComputedStyle(panel) : null;
        return {
          body: box(body),
          panel: box(panel),
          state: panel?.state ?? null,
          theme: panel?.style.colorScheme ?? null,
          colors: style ? { background: style.backgroundColor, text: style.color } : null,
          view: box(view),
        };
      `);
            if (
              !layout?.body ||
              !layout?.panel ||
              layout.body.width < width - 4 ||
              layout.body.width > width + 4 ||
              layout.body.height < 36 ||
              layout.panel.height < 100
            ) {
              throw new Error(
                `production visual capture has no meaningful layout: ${JSON.stringify(layout)}`,
              );
            }
            // Capture the explicit chrome-document review surface. WebDriver's
            // chrome-context screenshot and drawWindow both omit the native popup
            // compositor layer in headless Gecko, which is why the same panel contents
            // were moved above.
            const encoded = await client.execute(`
        const panel = document.getElementById("keep-loaded-visual-capture");
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
                `Zen did not return a panel PNG screenshot: ${JSON.stringify(layout)}`,
              );
            }
            const target = new URL(
              `${state.name}-${width}-${theme}-${textScale * 100}pct.png`,
              OUTPUT,
            );
            await writeFile(target, Buffer.from(encoded, "base64"));
            report.push({
              file: target.pathname,
              layout,
              name: state.name,
              textScale,
              theme,
              width,
            });
          }
        }
      }
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
