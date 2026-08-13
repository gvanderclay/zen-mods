import { afterEach, describe, expect, it, vi } from "vitest";
import { installDedupeMenuItem, installEmptySidebarDedupeMenuItem } from "./menu.ts";

class FakeElement extends EventTarget {
  parentElement: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  hidden = false;

  constructor(readonly id: string) {
    super();
  }

  append(...nodes: FakeElement[]) {
    for (const node of nodes) {
      node.remove();
      node.parentElement = this;
      this.children.push(node);
    }
  }

  before(node: FakeElement) {
    const parent = this.parentElement;
    if (!parent) {
      return;
    }
    node.remove();
    const index = parent.children.indexOf(this);
    node.parentElement = parent;
    parent.children.splice(index, 0, node);
  }

  remove() {
    const index = this.parentElement?.children.indexOf(this) ?? -1;
    if (index >= 0) {
      this.parentElement?.children.splice(index, 1);
    }
    this.parentElement = null;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  toggleAttribute(name: string, force: boolean) {
    if (force) {
      this.attributes.set(name, "true");
    } else {
      this.attributes.delete(name);
    }
  }
}

class FakeDocument {
  readonly nodes = new Map<string, FakeElement>();

  add(node: FakeElement) {
    this.nodes.set(node.id, node);
    return node;
  }

  getElementById(id: string) {
    const node = this.nodes.get(id);
    if (!node) {
      return null;
    }
    if (id === "toolbar-context-menu" || id === "tabContextMenu" || node.parentElement) {
      return node;
    }
    return null;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("installEmptySidebarDedupeMenuItem", () => {
  it("adds a tabbar-only action before Reopen Closed Tabs and runs the shared close", async () => {
    const document = new FakeDocument();
    const menu = document.add(new FakeElement("toolbar-context-menu"));
    const selectAll = document.add(new FakeElement("toolbar-context-selectAllTabs"));
    const reopen = document.add(new FakeElement("toolbar-context-undoCloseTab"));
    menu.append(selectAll, reopen);
    vi.stubGlobal("window", {
      document,
      MozXULElement: {
        parseXULToFragment: (markup: string) => {
          const id = markup.match(/id="([^"]+)"/)?.[1];
          if (!id) {
            throw new Error("missing item id");
          }
          const item = document.add(new FakeElement(id));
          const contextType = markup.match(/contexttype="([^"]+)"/)?.[1];
          if (contextType) {
            item.setAttribute("contexttype", contextType);
          }
          return item;
        },
      },
    });
    const run = vi.fn();

    const dispose = installEmptySidebarDedupeMenuItem(
      () => ({ label: "Close Duplicate Tabs", disabled: false }),
      run,
    );
    const item = document.getElementById("tab-deduplicator-toolbar-context-item");
    if (!item) {
      throw new Error("missing dedupe action");
    }

    expect(menu.children).toEqual([selectAll, item, reopen]);
    expect(item.attributes.get("contexttype")).toBe("tabbar");
    menu.dispatchEvent(new Event("popupshowing"));
    expect(item.attributes.get("label")).toBe("Close Duplicate Tabs");
    expect(item.attributes.has("disabled")).toBe(false);

    item.dispatchEvent(new Event("command"));
    await Promise.resolve();
    await Promise.resolve();
    expect(run).toHaveBeenCalledWith(item);

    dispose();
    expect(item.parentElement).toBeNull();
  });
});

describe("installDedupeMenuItem", () => {
  it("supersedes Firefox's action without removing it and restores it on teardown", async () => {
    const document = new FakeDocument();
    const menu = document.add(new FakeElement("tabContextMenu"));
    const native = document.add(new FakeElement("context_closeDuplicateTabs"));
    menu.append(native);
    vi.stubGlobal("window", {
      document,
      TabContextMenu: { contextTab: { id: "context-tab" } },
      MozXULElement: {
        parseXULToFragment: (markup: string) => {
          const id = markup.match(/id="([^"]+)"/)?.[1];
          if (!id) {
            throw new Error("missing item id");
          }
          return document.add(new FakeElement(id));
        },
      },
    });
    const run = vi.fn();

    const dispose = installDedupeMenuItem(
      () => ({ label: "Close Duplicate Tabs", disabled: false }),
      run,
    );
    const item = document.getElementById("tab-deduplicator-context-item");
    if (!item) {
      throw new Error("missing dedupe action");
    }

    expect(menu.children).toEqual([item, native]);
    expect(native.hidden).toBe(true);
    expect(document.getElementById("context_closeDuplicateTabs")).toBe(native);

    native.hidden = false;
    menu.dispatchEvent(new Event("popupshowing"));
    expect(native.hidden).toBe(true);
    expect(item.attributes.get("label")).toBe("Close Duplicate Tabs");

    item.dispatchEvent(new Event("command"));
    await Promise.resolve();
    await Promise.resolve();
    expect(run).toHaveBeenCalledWith({ id: "context-tab" });

    dispose();
    expect(item.parentElement).toBeNull();
    expect(native.hidden).toBe(false);
  });

  it("restores a pre-existing hidden native action", () => {
    const document = new FakeDocument();
    const menu = document.add(new FakeElement("tabContextMenu"));
    const native = document.add(new FakeElement("context_closeDuplicateTabs"));
    native.hidden = true;
    menu.append(native);
    vi.stubGlobal("window", {
      document,
      MozXULElement: {
        parseXULToFragment: () =>
          document.add(new FakeElement("tab-deduplicator-context-item")),
      },
    });

    const dispose = installDedupeMenuItem(
      () => ({ label: "Close Duplicate Tabs", disabled: true }),
      vi.fn(),
    );
    dispose();

    expect(native.hidden).toBe(true);
  });
});
