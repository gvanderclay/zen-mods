import { describe, expect, it, vi } from "vitest";
import type { ActivityState } from "../core/activity.ts";
import { createPaneActivityView } from "./view.ts";

class FakeStyle {
  readonly values = new Map<string, string>();

  removeProperty(name: string): string {
    const previous = this.values.get(name) ?? "";
    this.values.delete(name);
    return previous;
  }

  setProperty(name: string, value: string): void {
    this.values.set(name, value);
  }
}

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly style = new FakeStyle();
  layoutReads = 0;
  parentElement: FakeElement | null = null;

  append(...children: FakeElement[]): void {
    for (const child of children) {
      child.remove();
      child.parentElement = this;
      this.children.push(child);
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  getBoundingClientRect(): object {
    this.layoutReads += 1;
    return {};
  }

  querySelector(selector: string): FakeElement | null {
    if (selector !== ":scope > .zen-load-bar") {
      throw new Error(`unsupported selector: ${selector}`);
    }
    return (
      this.children.find(child =>
        (child.getAttribute("class") ?? "").split(" ").includes("zen-load-bar"),
      ) ?? null
    );
  }

  remove(): void {
    const index = this.parentElement?.children.indexOf(this) ?? -1;
    if (index >= 0) {
      this.parentElement?.children.splice(index, 1);
    }
    this.parentElement = null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

class FakeDocument {
  readonly created: FakeElement[] = [];
  readonly nodes = new Map<string, FakeElement>();

  add(id: string, element: FakeElement): void {
    this.nodes.set(id, element);
  }

  createElementNS(): FakeElement {
    const element = new FakeElement();
    this.created.push(element);
    return element;
  }

  getElementById(id: string): FakeElement | null {
    return this.nodes.get(id) ?? null;
  }
}

const state = (value: ActivityState): ActivityState => value;

const setup = () => {
  const browser = {};
  const document = new FakeDocument();
  const panel = new FakeElement();
  const browserContainer = new FakeElement();
  browserContainer.setAttribute("class", "browserContainer");
  panel.append(browserContainer);
  document.add("panel-a", panel);
  const tab = { linkedPanel: "panel-a" };
  const tabs = {
    getTabForBrowser: vi.fn(() => tab),
    selectedBrowser: browser,
  };
  const getComputedStyle = vi.fn(() => ({ transform: "matrix(1, 0, 0, 1, 48, 0)" }));
  return { browser, browserContainer, document, getComputedStyle, panel, tab, tabs };
};

describe("createPaneActivityView", () => {
  it("creates one decorative line in the exact browser container", () => {
    const harness = setup();
    const view = createPaneActivityView({
      browser: harness.browser,
      document: harness.document as unknown as Document,
      generationToken: "generation-a",
      getComputedStyle: harness.getComputedStyle,
      tabs: harness.tabs,
    });

    const root = harness.browserContainer.children[0];
    const segment = root?.children[0];
    expect(root?.getAttribute("class")).toBe("zen-load-bar");
    expect(root?.getAttribute("aria-hidden")).toBe("true");
    expect(root?.getAttribute("data-zen-load-bar-generation")).toBe("generation-a");
    expect(root?.getAttribute("data-zen-load-bar-color")).toBe("firefox");
    expect(root?.getAttribute("data-zen-load-bar-placement")).toBe("top");
    expect(root?.style.values.get("--zen-load-bar-thickness")).toBe("2px");
    expect(segment?.getAttribute("class")).toBe("zen-load-bar__segment");

    view.render(state({ kind: "waiting", token: 1 }));
    expect(root?.getAttribute("data-zen-load-bar-state")).toBe("waiting");
    view.render(state({ kind: "visible", token: 1 }));
    expect(root?.getAttribute("data-zen-load-bar-state")).toBe("visible");
  });

  it("freezes failure in place and clears that snapshot for a later navigation", () => {
    const harness = setup();
    const view = createPaneActivityView({
      browser: harness.browser,
      document: harness.document as unknown as Document,
      generationToken: "generation-a",
      getComputedStyle: harness.getComputedStyle,
      tabs: harness.tabs,
    });
    const root = harness.browserContainer.children[0];
    const segment = root?.children[0];

    view.render(state({ kind: "visible", token: 1 }));
    view.render(state({ kind: "canceling", token: 1, outcome: "network-error" }));

    expect(harness.getComputedStyle).toHaveBeenCalledWith(segment);
    expect(segment?.style.values.get("transform")).toBe("matrix(1, 0, 0, 1, 48, 0)");
    expect(root?.getAttribute("data-zen-load-bar-state")).toBe("canceling");
    expect(root?.getAttribute("data-zen-load-bar-outcome")).toBe("network-error");

    view.render(state({ kind: "waiting", token: 2 }));
    expect(segment?.style.values.has("transform")).toBe(false);
    expect(root?.getAttribute("data-zen-load-bar-outcome")).toBeNull();
  });

  it("starts success completion from the current sweep position", () => {
    const harness = setup();
    const view = createPaneActivityView({
      browser: harness.browser,
      document: harness.document as unknown as Document,
      generationToken: "generation-a",
      getComputedStyle: harness.getComputedStyle,
      tabs: harness.tabs,
    });
    const root = harness.browserContainer.children[0];
    const segment = root?.children[0];

    view.render(state({ kind: "visible", token: 1 }));
    view.render(state({ kind: "completing", token: 1, outcome: "success" }));

    expect(root?.layoutReads).toBe(1);
    expect(segment?.style.values.has("transform")).toBe(false);
    expect(root?.getAttribute("data-zen-load-bar-state")).toBe("completing");
    expect(root?.getAttribute("data-zen-load-bar-outcome")).toBe("success");
  });

  it("removes only its captured node and makes retained rendering inert", () => {
    const harness = setup();
    const view = createPaneActivityView({
      browser: harness.browser,
      document: harness.document as unknown as Document,
      generationToken: "generation-a",
      getComputedStyle: harness.getComputedStyle,
      tabs: harness.tabs,
    });
    const owned = harness.browserContainer.children[0];
    const replacement = new FakeElement();
    replacement.setAttribute("class", "zen-load-bar");
    harness.browserContainer.append(replacement);

    view.dispose();
    view.dispose();
    view.render(state({ kind: "visible", token: 9 }));

    expect(owned?.parentElement).toBeNull();
    expect(replacement.parentElement).toBe(harness.browserContainer);
    expect(replacement.getAttribute("data-zen-load-bar-state")).toBeNull();
  });

  it("fails closed when the exact pane is missing or already contains a line", () => {
    const missing = setup();
    missing.panel.children.length = 0;
    expect(() =>
      createPaneActivityView({
        browser: missing.browser,
        document: missing.document as unknown as Document,
        generationToken: "generation-a",
        getComputedStyle: missing.getComputedStyle,
        tabs: missing.tabs,
      }),
    ).toThrow("browser container is unavailable");

    const duplicate = setup();
    const existing = new FakeElement();
    existing.setAttribute("class", "zen-load-bar");
    duplicate.browserContainer.append(existing);
    expect(() =>
      createPaneActivityView({
        browser: duplicate.browser,
        document: duplicate.document as unknown as Document,
        generationToken: "generation-a",
        getComputedStyle: duplicate.getComputedStyle,
        tabs: duplicate.tabs,
      }),
    ).toThrow("browser container already has a Load Bar");
  });
});
