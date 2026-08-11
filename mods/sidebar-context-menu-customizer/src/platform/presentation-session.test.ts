import { describe, expect, it, vi } from "vitest";
import type { PresentationFact } from "../core/presentation.ts";
import {
  armSynchronousPopupFinalizer,
  PresentationSession,
} from "./presentation-session.ts";

class FakeNode {
  readonly attributes = new Set<string>();
  #parentElement: FakeContainer | null = null;
  hidden = false;
  isConnected = true;
  parentReads = 0;

  get parentElement(): FakeContainer | null {
    this.parentReads += 1;
    return this.#parentElement;
  }

  set parentElement(parent: FakeContainer | null) {
    this.#parentElement = parent;
  }

  remove(): void {
    this.parentElement?.detach(this);
    this.isConnected = false;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  setAttribute(name: string): void {
    this.attributes.add(name);
  }
}

class FakeContainer extends FakeNode {
  readonly children: FakeNode[] = [];
  insertions = 0;

  append(...nodes: FakeNode[]): void {
    for (const node of nodes) {
      node.parentElement?.detach(node);
      node.parentElement = this;
      node.isConnected = true;
      this.children.push(node);
    }
  }

  insertBefore(node: FakeNode, anchor: FakeNode | null): void {
    this.insertions += 1;
    node.parentElement?.detach(node);
    const index = anchor ? this.children.indexOf(anchor) : this.children.length;
    node.parentElement = this;
    node.isConnected = true;
    this.children.splice(index < 0 ? this.children.length : index, 0, node);
  }

  detach(node: FakeNode): void {
    const index = this.children.indexOf(node);
    if (index >= 0) {
      this.children.splice(index, 1);
      node.parentElement = null;
    }
  }
}

const asXul = (node: FakeNode): XulElement => node as unknown as XulElement;

const fact = (key: string, originalIndex: number): PresentationFact => ({
  browserVisible: true,
  controlRole: "ordinary",
  key,
  kind: "action",
  label: key,
  originalIndex,
  selected: false,
});

const createSession = (rootNodes: FakeNode[]) => {
  const root = new FakeContainer();
  const moreMenu = new FakeNode();
  const morePopup = new FakeContainer();
  root.append(...rootNodes, moreMenu);
  return {
    moreMenu,
    morePopup,
    root,
    session: new PresentationSession({
      excludedFromRootIds: new Set(["excluded"]),
      moreActionsMenu: asXul(moreMenu),
      moreActionsPopup: asXul(morePopup),
      root: asXul(root),
      rootOrder: root.children.map(asXul),
    }),
  };
};

describe("PresentationSession", () => {
  it("owns observer, moved nodes, separator overrides, and idempotent restoration", () => {
    const first = new FakeNode();
    const moved = new FakeNode();
    const separator = new FakeNode();
    const last = new FakeNode();
    const { moreMenu, morePopup, root, session } = createSession([
      first,
      moved,
      separator,
      last,
    ]);
    const observer = { disconnect: vi.fn(), takeRecords: vi.fn(() => []) };
    session.attachObserver(observer);
    session.moveActions([asXul(moved)]);
    session.hideTemporarily(asXul(separator));

    expect(morePopup.children).toContain(moved);
    expect(separator.hidden).toBe(true);
    expect(session.close()).toBe(true);
    expect(session.close()).toBe(false);
    expect(root.children).toEqual([first, moved, separator, last, moreMenu]);
    expect(separator.hidden).toBe(false);
    expect(separator.attributes.size).toBe(0);
    expect(moreMenu.hidden).toBe(true);
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(observer.takeRecords).toHaveBeenCalledTimes(1);
  });

  it("adopts a same-key replacement and restores it to the browser slot", () => {
    const first = new FakeNode();
    const replaced = new FakeNode();
    const boundary = new FakeNode();
    const { moreMenu, morePopup, root, session } = createSession([
      first,
      replaced,
      boundary,
    ]);
    session.recordActionKeys(
      [asXul(first), asXul(replaced), asXul(boundary)],
      [fact("first", 0), fact("late", 1), fact("boundary", 2)],
    );
    session.moveActions([asXul(replaced)]);

    replaced.remove();
    const replacement = new FakeNode();
    root.insertBefore(replacement, boundary);
    session.recordActionKeys([asXul(replacement)], [fact("late", 0)]);
    session.mergeCurrentRootOrder(root.children.map(asXul));
    session.moveActions([asXul(replacement)]);

    session.close();
    expect(root.children).toEqual([first, replacement, boundary, moreMenu]);
    expect(morePopup.children).toEqual([]);
  });

  it("restores large moved inventories with one reverse membership pass", () => {
    const nodes = Array.from({ length: 500 }, () => new FakeNode());
    const { morePopup, root, session } = createSession(nodes);
    const original = [...root.children];
    session.moveActions(nodes.map(asXul));
    for (const node of [...nodes, ...root.children, morePopup]) {
      node.parentReads = 0;
    }

    session.close();

    expect(root.children).toEqual(original);
    expect(root.insertions).toBe(nodes.length);
    expect(
      nodes.reduce((total, node) => total + node.parentReads, 0),
    ).toBeLessThanOrEqual(nodes.length * 4);
    expect(morePopup.children).toEqual([]);
  });

  it("terminalizes before accepting a late observer", () => {
    const { session } = createSession([new FakeNode()]);
    session.close();
    const observer = { disconnect: vi.fn(), takeRecords: vi.fn(() => []) };

    session.attachObserver(observer);

    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(observer.takeRecords).toHaveBeenCalledTimes(1);
  });

  it("rejects and drains a second observer instead of leaking it", () => {
    const { session } = createSession([new FakeNode()]);
    const owned = { disconnect: vi.fn(), takeRecords: vi.fn(() => []) };
    const duplicate = { disconnect: vi.fn(), takeRecords: vi.fn(() => []) };
    session.attachObserver(owned);

    expect(() => session.attachObserver(duplicate)).toThrow(
      "presentation session already owns an observer",
    );
    expect(duplicate.disconnect).toHaveBeenCalledTimes(1);
    expect(duplicate.takeRecords).toHaveBeenCalledTimes(1);

    session.close();
    expect(owned.disconnect).toHaveBeenCalledTimes(1);
    expect(owned.takeRecords).toHaveBeenCalledTimes(1);
  });
});

describe("armSynchronousPopupFinalizer", () => {
  it("runs once after previously registered window listeners and target/document work", () => {
    const ownerWindow = new EventTarget();
    const sourceEvent = new Event("popupshowing");
    const cleanups: Array<() => void> = [];
    const order: string[] = [];
    ownerWindow.addEventListener("popupshowing", () => order.push("window-before"));
    order.push("target-before");
    armSynchronousPopupFinalizer(
      ownerWindow,
      sourceEvent,
      () => order.push("finalize"),
      callback => cleanups.push(callback),
    );
    order.push("target-after");
    order.push("document");

    ownerWindow.dispatchEvent(sourceEvent);
    ownerWindow.dispatchEvent(new Event("popupshowing"));
    cleanups.forEach(cleanup => {
      cleanup();
    });

    expect(order).toEqual([
      "target-before",
      "target-after",
      "document",
      "window-before",
      "finalize",
      "window-before",
    ]);
  });

  it("invalidates a blocked event before a later opening", () => {
    const ownerWindow = new EventTarget();
    const cleanups: Array<() => void> = [];
    const finalize = vi.fn();
    armSynchronousPopupFinalizer(
      ownerWindow,
      new Event("popupshowing"),
      finalize,
      callback => cleanups.push(callback),
    );

    cleanups.forEach(cleanup => {
      cleanup();
    });
    ownerWindow.dispatchEvent(new Event("popupshowing"));

    expect(finalize).not.toHaveBeenCalled();
  });

  it("lets rapid reopen or teardown cancel the exact pending finalizer", () => {
    const ownerWindow = new EventTarget();
    const cleanups: Array<() => void> = [];
    const oldFinalize = vi.fn();
    const nextFinalize = vi.fn();
    const oldEvent = new Event("popupshowing");
    const nextEvent = new Event("popupshowing");
    const cancelOld = armSynchronousPopupFinalizer(
      ownerWindow,
      oldEvent,
      oldFinalize,
      callback => cleanups.push(callback),
    );
    cancelOld();
    const cancelNext = armSynchronousPopupFinalizer(
      ownerWindow,
      nextEvent,
      nextFinalize,
      callback => cleanups.push(callback),
    );

    ownerWindow.dispatchEvent(oldEvent);
    ownerWindow.dispatchEvent(nextEvent);
    cancelNext();
    cleanups.forEach(cleanup => {
      cleanup();
    });

    expect(oldFinalize).not.toHaveBeenCalled();
    expect(nextFinalize).toHaveBeenCalledTimes(1);
  });
});
