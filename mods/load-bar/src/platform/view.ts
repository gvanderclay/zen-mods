import type { ActivityState } from "../core/activity.ts";
import { DEFAULT_SETTINGS, type LoadBarSettings } from "../core/settings.ts";
import type { ActivityView } from "../runtime.ts";

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

export interface PaneTab {
  readonly linkedPanel: string | null;
}

export interface PaneTabBrowser<Browser extends object> {
  getTabForBrowser?: (browser: Browser) => PaneTab | null;
}

export interface PaneActivityViewOptions<Browser extends object> {
  readonly browser: Browser;
  readonly document: Document;
  readonly generationToken: string;
  readonly getComputedStyle: (element: Element) => Pick<CSSStyleDeclaration, "transform">;
  readonly settings?: LoadBarSettings;
  readonly tabs: PaneTabBrowser<Browser>;
}

const hasClass = (element: Element, name: string): boolean =>
  (element.getAttribute("class") ?? "").split(/\s+/).includes(name);

export const createPaneActivityView = <Browser extends object>({
  browser,
  document,
  generationToken,
  getComputedStyle,
  settings = DEFAULT_SETTINGS,
  tabs,
}: PaneActivityViewOptions<Browser>): ActivityView => {
  const getTab = tabs.getTabForBrowser;
  if (typeof getTab !== "function") {
    throw new Error("Zen tab lookup API is unavailable");
  }
  const linkedPanel = getTab.call(tabs, browser)?.linkedPanel;
  // Zen 1.21.13b tabbrowser.js:1276-1282,2911-2921: panel directly owns browserContainer.
  const panel = linkedPanel ? document.getElementById(linkedPanel) : null;
  const browserContainer = panel
    ? [...panel.children].find(child => hasClass(child, "browserContainer"))
    : null;
  if (!browserContainer) {
    throw new Error("Load Bar browser container is unavailable");
  }
  if (browserContainer.querySelector(":scope > .zen-load-bar")) {
    throw new Error("Load Bar browser container already has a Load Bar");
  }

  const root = document.createElementNS(XHTML_NAMESPACE, "div") as HTMLElement;
  const segment = document.createElementNS(XHTML_NAMESPACE, "div") as HTMLElement;
  root.setAttribute("class", "zen-load-bar");
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("data-zen-load-bar-generation", generationToken);
  root.setAttribute("data-zen-load-bar-color", settings.color);
  root.setAttribute("data-zen-load-bar-placement", settings.placement);
  root.style.setProperty("--zen-load-bar-thickness", `${settings.thickness}px`);
  segment.setAttribute("class", "zen-load-bar__segment");
  root.append(segment);
  browserContainer.append(root);

  let active = true;
  let previous: ActivityState | null = null;
  const updateSettings = (next: LoadBarSettings) => {
    if (!active) return;
    root.setAttribute("data-zen-load-bar-color", next.color);
    root.setAttribute("data-zen-load-bar-placement", next.placement);
    root.style.setProperty("--zen-load-bar-thickness", `${next.thickness}px`);
  };
  return {
    dispose: () => {
      if (!active) {
        return;
      }
      active = false;
      root.remove();
    },
    render: state => {
      if (!active) {
        return;
      }
      const terminal = state.kind === "completing" || state.kind === "canceling";
      if (terminal && previous?.kind === "visible") {
        const transform = getComputedStyle(segment).transform;
        if (transform !== "none") {
          segment.style.setProperty("transform", transform);
        }
      } else if (state.kind === "waiting" || state.kind === "visible") {
        segment.style.removeProperty("transform");
      }

      root.setAttribute("data-zen-load-bar-state", state.kind);
      if (terminal) {
        root.setAttribute("data-zen-load-bar-outcome", state.outcome);
      } else {
        root.removeAttribute("data-zen-load-bar-outcome");
      }

      if (state.kind === "completing" && previous?.kind === "visible") {
        root.getBoundingClientRect();
        segment.style.removeProperty("transform");
      }
      previous = state;
    },
    updateSettings,
  };
};
