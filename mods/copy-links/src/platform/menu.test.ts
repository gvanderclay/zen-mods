import { afterEach, describe, expect, it, vi } from "vitest";
import { installCopyLinksMenuItem } from "./menu.ts";

class FakeClassList {
  readonly values = new Set<string>();

  add(...names: string[]) {
    for (const name of names) {
      this.values.add(name);
    }
  }

  contains(name: string) {
    return this.values.has(name);
  }
}

class FakeElement extends EventTarget {
  id = "";
  parentElement: FakeElement | null = null;
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly classList = new FakeClassList();

  constructor(
    readonly localName: string,
    id = "",
  ) {
    super();
    this.id = id;
  }

  get nextElementSibling(): FakeElement | null {
    const index = this.parentElement?.children.indexOf(this) ?? -1;
    return index >= 0 ? (this.parentElement?.children[index + 1] ?? null) : null;
  }

  append(...nodes: FakeElement[]) {
    for (const node of nodes) {
      node.remove();
      node.parentElement = this;
      this.children.push(node);
    }
  }

  after(node: FakeElement) {
    const parent = this.parentElement;
    if (!parent) {
      return;
    }
    node.remove();
    const index = parent.children.indexOf(this);
    node.parentElement = parent;
    parent.children.splice(index + 1, 0, node);
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
  readonly roots: FakeElement[] = [];
  readonly localized: Array<{
    element: FakeElement;
    id: string;
    args: Record<string, number>;
  }> = [];
  readonly l10n = {
    setAttributes: (element: FakeElement, id: string, args: Record<string, number>) => {
      this.localized.push({ element, id, args });
    },
  };

  add(node: FakeElement) {
    this.roots.push(node);
    return node;
  }

  createXULElement(localName: string) {
    return new FakeElement(localName);
  }

  getElementById(id: string): FakeElement | null {
    const visit = (node: FakeElement): FakeElement | null => {
      if (node.id === id) {
        return node;
      }
      for (const child of node.children) {
        const found = visit(child);
        if (found) {
          return found;
        }
      }
      return null;
    };
    for (const root of this.roots) {
      const found = visit(root);
      if (found) {
        return found;
      }
    }
    return null;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("installCopyLinksMenuItem", () => {
  it("uses Firefox's Share context and copies selected links as plain text", () => {
    const document = new FakeDocument();
    const menu = document.add(new FakeElement("menupopup", "tabContextMenu"));
    const anchor = new FakeElement("menu", "context_moveTabOptions");
    const share = new FakeElement("menu");
    share.classList.add("share-tab-url-item");
    const tail = new FakeElement("menuitem", "context_reopenInContainer");
    menu.append(anchor, share, tail);
    vi.stubGlobal("window", { document });
    const copyText = vi.fn();
    const getLinksToShare = vi.fn(() => [
      { url: "https://example.com/one", title: "One" },
      { url: "https://example.com/two", title: "Two" },
    ]);

    const dispose = installCopyLinksMenuItem({
      copyText,
      getLinksToShare,
      report: vi.fn(),
    });
    const item = document.getElementById("copy-links-context-item");
    if (!item) {
      throw new Error("missing Copy Links action");
    }

    expect(menu.children).toEqual([anchor, share, item, tail]);
    menu.dispatchEvent(new Event("popupshowing"));
    expect(getLinksToShare).toHaveBeenCalledWith(share);
    expect(document.localized.at(-1)).toMatchObject({
      element: item,
      id: "menu-share-copy-links",
      args: { count: 2 },
    });
    expect(item.attributes.has("disabled")).toBe(false);

    item.dispatchEvent(new Event("command"));
    expect(copyText).toHaveBeenCalledWith(
      "https://example.com/one\nhttps://example.com/two",
    );

    dispose();
    expect(item.parentElement).toBeNull();
    item.dispatchEvent(new Event("command"));
    expect(copyText).toHaveBeenCalledTimes(1);
  });

  it("allows Firefox to insert Share before the action and disables empty contexts", () => {
    const document = new FakeDocument();
    const menu = document.add(new FakeElement("menupopup", "tabContextMenu"));
    const anchor = new FakeElement("menu", "context_moveTabOptions");
    const tail = new FakeElement("menuitem", "context_reopenInContainer");
    menu.append(anchor, tail);
    vi.stubGlobal("window", { document });
    const copyText = vi.fn();

    installCopyLinksMenuItem({
      copyText,
      getLinksToShare: () => [],
      report: vi.fn(),
    });
    const item = document.getElementById("copy-links-context-item");
    if (!item) {
      throw new Error("missing Copy Links action");
    }
    expect(menu.children).toEqual([anchor, item, tail]);

    const share = new FakeElement("menu");
    share.classList.add("share-tab-url-item");
    anchor.after(share);
    menu.dispatchEvent(new Event("popupshowing"));

    expect(menu.children).toEqual([anchor, share, item, tail]);
    expect(item.attributes.has("disabled")).toBe(true);
    expect(document.localized.at(-1)?.args).toEqual({ count: 1 });
    item.dispatchEvent(new Event("command"));
    expect(copyText).not.toHaveBeenCalled();
  });
});
