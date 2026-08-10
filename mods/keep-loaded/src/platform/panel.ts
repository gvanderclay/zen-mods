/**
 * The status panel: a button in Zen's sidebar that opens a panel view. Privileged —
 * `CustomizableUI` and the chrome DOM.
 *
 * The button is a real CustomizableUI widget rather than a node pushed into someone
 * else's container, because Zen registers `zen-sidebar-foot-buttons` as a toolbar area
 * of its own (`ZenCustomizableUI.sys.mjs` 29). So it can be moved or removed from
 * Customize like any other button, and it lands somewhere always visible instead of the
 * nav-bar, which Zen relocates into the content area and compact mode can hide.
 *
 * A panelview that is not in `browser.xhtml` has to live in the `#appMenu-viewCache`
 * template: that is the fallback `PanelMultiView.getViewNode` looks in
 * (`PanelMultiView.sys.mjs` 467).
 */

import type { ButtonState } from "../core/actions.ts";
import type { PanelReport } from "../core/rows.ts";
import { log } from "./log.ts";

const BUTTON_ID = "keep-loaded-button";
const VIEW_ID = "keep-loaded-panelview";
const BODY_ID = "keep-loaded-panel-body";
const WAKE_ID = "keep-loaded-wake-button";
const CACHE_ID = "appMenu-viewCache";
const AREA = "zen-sidebar-foot-buttons";

export type PanelDisposalScope = "application" | "window";
export type StatusPanelDisposer = (scope?: PanelDisposalScope) => void;

// The action sits outside `.panel-subview-body`, after a separator, the way every other
// panel footer button in `browser.xhtml` does (2779-2783). Outside is load-bearing:
// refilling the body must not destroy the button that triggered the refill.
const VIEW_XUL = `
  <panelview id="${VIEW_ID}" class="PanelUI-subView keep-loaded-panelview">
    <vbox id="${BODY_ID}" class="panel-subview-body"/>
    <toolbarseparator/>
    <toolbarbutton id="${WAKE_ID}"
                   class="subviewbutton panel-subview-footer-button"
                   closemenu="none"/>
  </panelview>
`;

/** XUL labels carry their text in `value`, not as a child text node. */
const labelNode = (document: Document, className: string, value: string) => {
  const label = document.createXULElement("label");
  label.className = className;
  label.setAttribute("value", value);
  return label;
};

/**
 * Everything below takes the panelview rather than its body, because the action button
 * is a sibling of the body and refilling one has to be able to update the other.
 */
const bodyOf = (view: Element) => view.querySelector(`#${BODY_ID}`);

/** Replaces the panel's contents with one line each. For messages, not for rows. */
export const renderPanelLines = (view: Element, lines: readonly string[]) => {
  const body = bodyOf(view);
  if (!body) {
    return;
  }
  body.textContent = "";
  for (const line of lines) {
    body.appendChild(labelNode(body.ownerDocument, "keep-loaded-panel-line", line));
  }
};

/** The action button's own text, which carries the count it would act on. */
export const renderPanelAction = (view: Element, state: ButtonState) => {
  const button = view.querySelector(`#${WAKE_ID}`);
  if (!button) {
    return;
  }
  button.setAttribute("label", state.label);
  if (state.disabled) {
    button.setAttribute("disabled", "true");
  } else {
    button.removeAttribute("disabled");
  }
};

/**
 * The rows themselves: a heading, then each space with its kept tabs under it. The
 * state is written out as a word as well as being styled, so it survives a theme that
 * flattens the styling and reads the same to someone who cannot tell the colours apart.
 */
export const renderPanelReport = (view: Element, report: PanelReport) => {
  const body = bodyOf(view);
  if (!body) {
    return;
  }
  const document = body.ownerDocument;
  body.textContent = "";
  body.appendChild(labelNode(document, "keep-loaded-panel-heading", report.heading));

  for (const group of report.groups) {
    body.appendChild(labelNode(document, "keep-loaded-space", group.space));
    for (const row of group.rows) {
      const box = document.createXULElement("vbox");
      box.className = "keep-loaded-row";
      box.setAttribute("data-state", row.state);
      if (row.url) {
        box.setAttribute("tooltiptext", row.url);
      }

      const head = document.createXULElement("hbox");
      head.className = "keep-loaded-row-head";
      head.appendChild(labelNode(document, "keep-loaded-row-title", row.title));
      const spacer = document.createXULElement("spacer");
      spacer.setAttribute("flex", "1");
      head.appendChild(spacer);
      head.appendChild(labelNode(document, "keep-loaded-row-state", row.state));

      box.appendChild(head);
      box.appendChild(labelNode(document, "keep-loaded-row-detail", row.detail));
      body.appendChild(box);
    }
  }
};

const viewCache = (document: Document) =>
  document.getElementById(CACHE_ID) as HTMLTemplateElement | null;

/** Both places the view can be: still in the cache, or moved out by a first showing. */
const removeView = (document: Document) => {
  document.getElementById(VIEW_ID)?.remove();
  viewCache(document)?.content.querySelector(`#${VIEW_ID}`)?.remove();
};

/**
 * Fills one window's panel, through the state parked on that window. Shared by the
 * widget's `onViewShowing` and by the action button's own refresh.
 *
 * `ownerDocument.defaultView`, not `ownerGlobal`: that property is undefined on this
 * panelview even once it is in the document, and reading through it threw a TypeError
 * that PanelMultiView swallowed, leaving an empty panel and no console line. Measured,
 * not guessed — `tools/harness/probe-panel.mjs`.
 */
const fillView = (view: Element) => {
  const fill = view.ownerDocument.defaultView?.zenKeepLoaded?.fillPanel;
  if (fill) {
    fill(view);
  } else {
    renderPanelLines(view, ["Keep Loaded is not running in this window"]);
    renderPanelAction(view, { label: "Nothing to wake", disabled: true });
  }
};

/**
 * @param actions what the footer button does. The controller receives the view so it
 *   can render both the immediate busy state and the eventual result while its own
 *   generation is still live. This platform adapter deliberately owns no async work.
 * @returns a disposer that always removes this window's view and, for application
 *   teardown, also removes the application-global widget registration
 */
export const installStatusPanel = (actions: {
  onWake: (view: Element) => void;
}): StatusPanelDisposer => {
  const document = window.document;
  const ui = window.CustomizableUI;
  if (!ui || !window.MozXULElement) {
    log("no CustomizableUI or MozXULElement — skipping the status panel");
    return () => {};
  }

  const cache = viewCache(document);
  if (!cache) {
    log(`no #${CACHE_ID} — skipping the status panel`);
    return () => {};
  }

  // A reload that failed to dispose would otherwise leave two views with one id.
  removeView(document);
  cache.content.appendChild(window.MozXULElement.parseXULToFragment(VIEW_XUL));

  // A closure is safe here, unlike the widget's callback: the view is built per window
  // by this call, and the disposer takes it back out, so this listener cannot outlive
  // the module instance that made it. `command`, not `click`, so the keyboard works too.
  const view = cache.content.querySelector(`#${VIEW_ID}`);
  if (view) {
    view.querySelector(`#${WAKE_ID}`)?.addEventListener("command", () => {
      actions.onWake(view);
    });
  }

  // The widget belongs to the application and this module runs in every window, so a
  // second window must not try to create it again — `createWidget` throws on a
  // duplicate id. Same guard DevTools uses for its own toggle
  // (`DevToolsStartup.sys.mjs` 656).
  const existing = ui.getWidget(BUTTON_ID);
  if (existing?.provider !== ui.PROVIDER_API) {
    ui.createWidget({
      id: BUTTON_ID,
      type: "view",
      viewId: VIEW_ID,
      localized: false,
      label: "Keep Loaded",
      tooltiptext: "Tabs being kept loaded, and when each was last alive",
      defaultArea: AREA,
      // Routed through the window rather than a closure: this callback outlives the
      // module instance that created it, and in a second window it belongs to a
      // different one entirely (D022).
      onViewShowing: event => {
        fillView(event.target);
      },
    });
  }

  return (scope = "application") => {
    if (scope === "application") {
      try {
        ui.destroyWidget(BUTTON_ID);
      } catch (error) {
        console.error("[keep-loaded] could not remove the status button", error);
      }
    }
    removeView(document);
  };
};
