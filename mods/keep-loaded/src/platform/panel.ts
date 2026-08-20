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

import { panelPresentation } from "../core/panel-presentation.ts";
import type {
  StatusWidgetHost,
  StatusWidgetLease,
  StatusWidgetViewEvent,
  StatusWidgetViewShowing,
} from "../status-widget-contracts.ts";
import { log } from "./log.ts";
import {
  BODY_ID,
  FEEDBACK_ID,
  RESET_ID,
  renderPanelPresentation,
  WAKE_ID,
} from "./panel-render.ts";

const BUTTON_ID = "keep-loaded-button";
const VIEW_ID = "keep-loaded-panelview";
const CACHE_ID = "appMenu-viewCache";
const AREA = "zen-sidebar-foot-buttons";

export type PanelDisposalScope = "application" | "window";
export type StatusPanelDisposer = (scope?: PanelDisposalScope) => void;

export interface StatusWidgetOwner {
  acquireStatusWidget(host: StatusWidgetHost): StatusWidgetLease;
}

// The action sits outside `.panel-subview-body`, after a separator, the way every other
// panel footer button in `browser.xhtml` does (2779-2783). Outside is load-bearing:
// refilling the body must not destroy the button that triggered the refill.
const VIEW_XUL = `
  <panelview id="${VIEW_ID}"
             class="PanelUI-subView keep-loaded-panelview"
             mainview-with-header="true">
    <box class="panel-header">
      <html:h1><html:span>Keep Loaded</html:span></html:h1>
    </box>
    <toolbarseparator/>
    <vbox id="${BODY_ID}" class="panel-subview-body"/>
    <toolbarseparator/>
    <vbox class="keep-loaded-panel-footer">
      <toolbarbutton id="${WAKE_ID}"
                     class="subviewbutton panel-subview-footer-button keep-loaded-wake-button"
                     closemenu="none"/>
      <toolbarbutton id="${RESET_ID}"
                     class="subviewbutton panel-subview-footer-button keep-loaded-reset-button"
                     closemenu="none"
                     hidden="true"
                     disabled="true"/>
      <label id="${FEEDBACK_ID}"
             class="keep-loaded-panel-feedback"
             role="status"
             aria-live="polite"
             aria-atomic="true"
             hidden="true"/>
    </vbox>
  </panelview>
`;

const viewCache = (document: Document) =>
  document.getElementById(CACHE_ID) as HTMLTemplateElement | null;

/** Sweeps a leftover view only while a new generation is installing its own view. */
const removeExistingView = (document: Document) => {
  document.getElementById(VIEW_ID)?.remove();
  viewCache(document)?.content.querySelector(`#${VIEW_ID}`)?.remove();
};

/**
 * @param actions what the footer button does. The controller receives the view so it
 *   can render both the immediate busy state and the eventual result while its own
 *   generation is still live. This platform adapter deliberately owns no async work.
 * @returns a disposer that always removes this window's view and, for application
 *   teardown, also removes the application-global widget registration
 */
export const installStatusPanel = (actions: {
  /** Owns the generation-local render; the application owner routes persistent UI here. */
  onViewShowing?: (view: Element) => void;
  /** Lets the runtime remember the one panel node this generation is allowed to fill. */
  onViewReady?: (view: Element) => void;
  onWake: (view: Element) => void;
  onReset?: (view: Element) => void;
  /** Rejects retained per-view events once the originating generation is terminal. */
  isLive?: () => boolean;
  /** Stops the exact generation if its delayed application-owner create fails. */
  onWidgetError?: (error: unknown) => void;
  widgetOwner?: StatusWidgetOwner;
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

  // A reload that failed to dispose would otherwise leave two views with one id. This
  // broad id sweep is safe only at installation; the returned disposer removes its
  // exact captured node so stale cleanup cannot touch a replacement view.
  removeExistingView(document);
  cache.content.appendChild(window.MozXULElement.parseXULToFragment(VIEW_XUL));

  const view = cache.content.querySelector(`#${VIEW_ID}`);
  let active = true;
  const isLive = () => actions.isLive?.() ?? true;
  const isCurrentView = (event: StatusWidgetViewEvent) =>
    active && isLive() && event.target === view;

  // This closure is generation-local. The application owner retains only its stable
  // dispatcher and calls this host when (and only when) the event target is this exact
  // live window's view.
  const show = (event: StatusWidgetViewEvent) => {
    if (!isCurrentView(event) || !view) {
      return false;
    }
    actions.onViewShowing?.(view);
    return true;
  };

  if (view) {
    renderPanelPresentation(view, panelPresentation({ kind: "loading" }));
    view.querySelector(`#${WAKE_ID}`)?.addEventListener("command", () => {
      if (!active || !isLive()) {
        return;
      }
      actions.onWake(view);
    });
    view.querySelector(`#${RESET_ID}`)?.addEventListener("command", () => {
      if (!active || !isLive()) {
        return;
      }
      actions.onReset?.(view);
    });
    actions.onViewReady?.(view);
  }

  const createWidget = (onViewShowing: StatusWidgetViewShowing) => {
    if (!active || widgetDestroyed) {
      return;
    }
    // The stable application owner calls this only for the first live window. The
    // provider guard still makes reloads safe if CustomizableUI already retained the
    // widget from a previous generation.
    const existing = ui.getWidget(BUTTON_ID);
    if (existing?.provider === ui.PROVIDER_API) {
      return;
    }
    ui.createWidget({
      id: BUTTON_ID,
      type: "view",
      viewId: VIEW_ID,
      localized: false,
      label: "Keep Loaded",
      tooltiptext: "Tabs being kept loaded, and when each was last alive",
      defaultArea: AREA,
      // The stable application owner owns this callback. It selects an exact current
      // panel host instead of retaining the cache-busted window generation that first
      // registered the widget (D040).
      onViewShowing,
    });
  };
  // `createWidget` can leave a physical CustomizableUI widget behind even when it
  // throws.  Mark destruction before calling into CustomizableUI so the owner's
  // error recovery and this panel's local error recovery can both safely attempt
  // cleanup without a stale/partial install destroying a later generation's widget.
  let widgetDestroyed = false;
  // Only the stable owner holds `host.destroy`. It invokes this exact adapter while
  // its lease transition is serialized, including when `createWidget` synchronously
  // makes this generation terminal before the owner can observe the new widget. A
  // panel's own retained disposer uses `destroyWidget` below and remains locally
  // inert once `active` is false.
  const destroyOwnedWidget = () => {
    if (widgetDestroyed) {
      return;
    }
    widgetDestroyed = true;
    try {
      ui.destroyWidget(BUTTON_ID);
    } catch (error) {
      console.error("[keep-loaded] could not remove the status button", error);
    }
  };
  const destroyWidget = () => {
    if (!active) {
      return;
    }
    destroyOwnedWidget();
  };
  let lease: StatusWidgetLease | undefined;
  const dispose: StatusPanelDisposer = (scope = "application") => {
    if (!active) {
      return;
    }
    // A final release can synchronously call this host's destroy adapter, so retain
    // `active` until after it returns. Any retained adapter invoked later is inert.
    try {
      if (lease) {
        lease.release();
      } else if (scope === "application") {
        destroyWidget();
      }
    } finally {
      active = false;
      view?.remove();
    }
  };

  try {
    const host: StatusWidgetHost = {
      create: createWidget,
      destroy: destroyOwnedWidget,
      fail: error => actions.onWidgetError?.(error),
      show,
    };
    if (actions.widgetOwner) {
      lease = actions.widgetOwner.acquireStatusWidget(host);
    } else {
      createWidget(event => {
        show(event);
      });
    }
  } catch (error) {
    // The application owner destroys a first-edge widget when its host creation
    // throws.  A local/fallback install has no such owner, so make the same
    // best-effort cleanup here. `destroyWidget` is one-shot across both paths.
    try {
      if (lease) {
        lease.release();
      } else {
        destroyWidget();
      }
    } finally {
      active = false;
      view?.remove();
    }
    throw error;
  }

  // `createWidget` can synchronously reenter Sine's staggered reload path. The
  // runtime has not received this disposer yet, so clean up here if that made this
  // generation terminal before installation returned.
  if (!isLive()) {
    dispose();
  }

  return scope => {
    // `scope` remains accepted for callers compiled against M11's local/native
    // disposal distinction. M14 ownership makes the application owner the only
    // authority that may destroy the shared widget, so every generation releases
    // its lease regardless of which close signal arrived first.
    dispose(scope);
  };
};
