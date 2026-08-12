import { describe, expect, it, vi } from "vitest";
import { installHistoryEntryRemoveButton } from "./history-entry-remove.ts";

type Listener = (event: Event) => void;

class FakeEventTarget {
  readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback =
      typeof listener === "function"
        ? listener
        : (event: Event) => listener.handleEvent(event);
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(callback);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string, event: Record<string, unknown> = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event as unknown as Event);
    }
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (typeof listener === "function") {
      this.listeners.get(type)?.delete(listener);
    }
  }
}

const createButton = () => {
  const target = new FakeEventTarget();
  const attributes = new Map<string, string>();
  return Object.assign(target, {
    attributes,
    classList: { add: vi.fn() },
    hidden: true,
    localName: "",
    removed: false,
    removeAttribute(name: string) {
      attributes.delete(name);
    },
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    toggleAttribute(name: string, force: boolean) {
      if (force) {
        attributes.set(name, "");
      } else {
        attributes.delete(name);
      }
    },
    remove() {
      this.removed = true;
    },
    style: {} as Record<string, string>,
  });
};

const createDocument = (nodes: Array<{ uri?: string }>) => {
  const tree = Object.assign(new FakeEventTarget(), {
    getBoundingClientRect: () => ({ left: 10, right: 340 }),
    getCellAt: () => ({ col: {}, row: 5 }),
    getFirstVisibleRow: () => 3,
    rowHeight: 40,
    treeBody: { getBoundingClientRect: () => ({ left: 10, right: 310, y: 100 }) },
    view: { nodeForTreeIndex: (row: number) => nodes[row] },
  });
  const button = createButton();
  const setAttributes = vi.fn();
  const document = {
    createXULElement: vi.fn((localName: string) => {
      button.localName = localName;
      return button;
    }),
    defaultView: { getComputedStyle: () => ({ direction: "ltr" }) },
    documentElement: { append: vi.fn() },
    documentURI: "chrome://browser/content/places/historySidebar.xhtml",
    getElementById: (id: string) => (id === "historyTree" ? tree : null),
    l10n: { setAttributes },
  };
  return { button, document, setAttributes, tree };
};

const createBrowser = (contentDocument: object) =>
  Object.assign(new FakeEventTarget(), { contentDocument });

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const isURI = (node: unknown): node is { uri: string } =>
  typeof node === "object" &&
  node !== null &&
  "uri" in node &&
  typeof node.uri === "string";

const interaction = (clientX: number, clientY: number) => ({
  clientX,
  clientY,
  preventDefault: vi.fn(),
  stopImmediatePropagation: vi.fn(),
});

describe("installHistoryEntryRemoveButton", () => {
  it("keeps the tree as the hit target and removes only from the close region", () => {
    const nodes = Array.from({ length: 6 }, () => ({}));
    nodes[5] = { uri: "https://example.com/page" };
    const fixture = createDocument(nodes);
    const browser = createBrowser(fixture.document);
    const remove = vi.fn();

    installHistoryEntryRemoveButton({
      browser: browser as never,
      history: { isURI, remove },
      isLive: () => true,
    });
    fixture.tree.dispatch("mousemove", { clientX: 290, clientY: 200 });

    expect(fixture.button.localName).toBe("image");
    expect(fixture.button.style.pointerEvents).toBe("none");
    expect(fixture.button.hidden).toBe(false);
    expect(fixture.button.style).toMatchObject({ left: "278px", top: "190px" });
    expect(fixture.button.attributes.has("data-hover")).toBe(true);
    expect(fixture.setAttributes).toHaveBeenCalledWith(
      fixture.button,
      "places-delete-page",
      { count: 1 },
    );

    const down = interaction(290, 200);
    fixture.tree.dispatch("mousedown", down);
    expect(down.preventDefault).toHaveBeenCalledOnce();
    expect(down.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(fixture.button.attributes.has("data-pressed")).toBe(true);

    const click = interaction(290, 200);
    fixture.tree.dispatch("click", click);

    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith("https://example.com/page");
    expect(click.preventDefault).toHaveBeenCalledOnce();
    expect(click.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(fixture.button.hidden).toBe(true);
  });

  it("leaves native tree input untouched outside the close region", () => {
    const nodes = Array.from({ length: 6 }, () => ({}));
    nodes[5] = { uri: "https://example.com/page" };
    const fixture = createDocument(nodes);
    const browser = createBrowser(fixture.document);
    const remove = vi.fn();

    installHistoryEntryRemoveButton({
      browser: browser as never,
      history: { isURI, remove },
      isLive: () => true,
    });
    fixture.tree.dispatch("mousemove", { clientX: 100, clientY: 200 });
    const click = interaction(100, 200);
    fixture.tree.dispatch("click", click);

    expect(fixture.button.hidden).toBe(false);
    expect(fixture.button.attributes.has("data-hover")).toBe(false);
    expect(click.preventDefault).not.toHaveBeenCalled();
    expect(click.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("never offers deletion for a History container row", () => {
    const nodes = Array.from({ length: 6 }, () => ({}));
    nodes[5] = { uri: "container://today" };
    const fixture = createDocument(nodes);
    const browser = createBrowser(fixture.document);
    const remove = vi.fn();

    installHistoryEntryRemoveButton({
      browser: browser as never,
      history: { isURI: (_node): _node is { uri: string } => false, remove },
      isLive: () => true,
    });
    fixture.tree.dispatch("mousemove", { clientX: 100, clientY: 200 });
    fixture.tree.dispatch("click", interaction(290, 200));

    expect(fixture.button.hidden).toBe(true);
    expect(remove).not.toHaveBeenCalled();
  });

  it("rebinds on History document replacement and fully disposes retained handlers", () => {
    const first = createDocument(Array.from({ length: 6 }, () => ({})));
    const secondNodes = Array.from({ length: 6 }, () => ({}));
    secondNodes[5] = { uri: "https://example.com/reloaded" };
    const second = createDocument(secondNodes);
    const browser = createBrowser(first.document);
    let live = true;
    const remove = vi.fn();
    const dispose = installHistoryEntryRemoveButton({
      browser: browser as never,
      history: { isURI, remove },
      isLive: () => live,
    });

    browser.contentDocument = second.document;
    browser.dispatch("load", { target: second.document } as never);

    expect(first.button.removed).toBe(true);
    second.tree.dispatch("mousemove", { clientX: 100, clientY: 200 });
    expect(second.button.hidden).toBe(false);

    live = false;
    dispose();
    second.tree.dispatch("click", interaction(290, 200));
    second.tree.dispatch("mousemove", { clientX: 100, clientY: 200 });

    expect(second.button.removed).toBe(true);
    expect(remove).not.toHaveBeenCalled();
    expect(browser.listeners.get("load")?.size ?? 0).toBe(0);
  });

  it("contains and reports a native removal failure", async () => {
    const nodes = Array.from({ length: 6 }, () => ({}));
    nodes[5] = { uri: "https://example.com/failure" };
    const fixture = createDocument(nodes);
    const browser = createBrowser(fixture.document);
    const failure = new Error("history locked");
    const report = vi.fn();

    installHistoryEntryRemoveButton({
      browser: browser as never,
      history: {
        isURI,
        remove: vi.fn(() => Promise.reject(failure)),
      },
      isLive: () => true,
      report,
    });
    fixture.tree.dispatch("mousemove", { clientX: 290, clientY: 200 });
    fixture.tree.dispatch("click", interaction(290, 200));
    await flush();

    expect(report).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(failure);
  });
});
