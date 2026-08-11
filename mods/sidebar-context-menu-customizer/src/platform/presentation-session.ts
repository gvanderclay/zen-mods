import type { PresentationFact } from "../core/presentation.ts";

const EMPTY_SEPARATOR_ATTRIBUTE = "data-sidebar-context-menu-customizer-empty";

type SessionObserver = Pick<MutationObserver, "disconnect" | "takeRecords">;

export interface PresentationSessionOptions {
  excludedFromRootIds: ReadonlySet<string>;
  moreActionsMenu: XulElement;
  moreActionsPopup: XulElement;
  root: XulElement;
  rootOrder: readonly XulElement[];
}

/** Owns every temporary mutation made for one tab-menu opening. */
export class PresentationSession {
  readonly excludedFromRootIds: ReadonlySet<string>;

  #actionKeys = new Map<XulElement, string>();
  #browserHiddenStates = new Map<XulElement, boolean>();
  #closed = false;
  #moreActionsMenu: XulElement;
  #moreActionsPopup: XulElement;
  #movedActions = new Set<XulElement>();
  #observer: SessionObserver | null = null;
  #root: XulElement;
  #rootOrder: XulElement[];

  constructor({
    excludedFromRootIds,
    moreActionsMenu,
    moreActionsPopup,
    root,
    rootOrder,
  }: PresentationSessionOptions) {
    this.excludedFromRootIds = new Set(excludedFromRootIds);
    this.#moreActionsMenu = moreActionsMenu;
    this.#moreActionsPopup = moreActionsPopup;
    this.#root = root;
    this.#rootOrder = [...rootOrder];
  }

  get closed(): boolean {
    return this.#closed;
  }

  attachObserver(observer: SessionObserver): void {
    if (this.#closed) {
      observer.disconnect();
      observer.takeRecords();
      return;
    }
    if (this.#observer) {
      observer.disconnect();
      observer.takeRecords();
      throw new Error("presentation session already owns an observer");
    }
    this.#observer = observer;
  }

  discardObserverRecords(): void {
    this.#observer?.takeRecords();
  }

  recordActionKeys(
    nodes: readonly XulElement[],
    facts: readonly PresentationFact[],
  ): void {
    if (this.#closed) {
      return;
    }
    for (const fact of facts) {
      if (fact.kind === "action") {
        const node = nodes[fact.originalIndex];
        if (node) {
          this.#actionKeys.set(node, fact.key);
        }
      }
    }
  }

  moveActions(nodes: readonly XulElement[]): void {
    if (this.#closed) {
      return;
    }
    for (const node of nodes) {
      this.#movedActions.add(node);
    }
    this.#moreActionsPopup.append(...nodes);
  }

  hideTemporarily(node: XulElement): void {
    if (this.#closed) {
      return;
    }
    if (!this.#browserHiddenStates.has(node)) {
      this.#browserHiddenStates.set(node, node.hidden);
    }
    node.setAttribute(EMPTY_SEPARATOR_ATTRIBUTE, "true");
    node.hidden = true;
  }

  restoreSeparatorPresentation(): void {
    if (this.#closed) {
      return;
    }
    for (const [node, hidden] of this.#browserHiddenStates) {
      node.hidden = hidden;
      node.removeAttribute(EMPTY_SEPARATOR_ATTRIBUTE);
    }
    this.#browserHiddenStates.clear();

    for (const node of this.#root.children) {
      node.removeAttribute(EMPTY_SEPARATOR_ATTRIBUTE);
    }
  }

  mergeCurrentRootOrder(rootChildren: readonly XulElement[]): void {
    if (this.#closed) {
      return;
    }

    // WebExtension menus can replace a live node in response to menus.onShown.
    for (const node of rootChildren) {
      if (this.#rootOrder.includes(node)) {
        continue;
      }
      const key = this.#actionKeys.get(node);
      if (!key) {
        continue;
      }
      const staleIndex = this.#rootOrder.findIndex(
        candidate =>
          candidate !== node &&
          !candidate.isConnected &&
          this.#actionKeys.get(candidate) === key,
      );
      if (staleIndex >= 0) {
        const [staleNode] = this.#rootOrder.splice(staleIndex, 1);
        if (staleNode) {
          this.#movedActions.delete(staleNode);
          this.#actionKeys.delete(staleNode);
        }
      }
    }

    // Merge direct-root additions right-to-left around surviving browser siblings.
    let anchorIndex: number | null = null;
    for (let index = rootChildren.length - 1; index >= 0; index -= 1) {
      const node = rootChildren[index];
      if (!node) {
        continue;
      }
      const existingIndex = this.#rootOrder.indexOf(node);
      if (existingIndex >= 0) {
        anchorIndex = existingIndex;
        continue;
      }
      const insertionIndex: number = anchorIndex ?? this.#rootOrder.length;
      this.#rootOrder.splice(insertionIndex, 0, node);
      anchorIndex = insertionIndex;
    }
  }

  close(): boolean {
    if (this.#closed) {
      return false;
    }
    this.#closed = true;
    this.#observer?.disconnect();
    this.#observer?.takeRecords();
    this.#observer = null;

    // One reverse traversal maintains the next surviving root anchor. No suffix scan.
    let nextSurvivingSibling: XulElement | null = null;
    for (let index = this.#rootOrder.length - 1; index >= 0; index -= 1) {
      const node = this.#rootOrder[index];
      if (!node) {
        continue;
      }
      if (node.parentElement === this.#root) {
        nextSurvivingSibling = node;
        continue;
      }
      if (this.#movedActions.has(node) && node.parentElement === this.#moreActionsPopup) {
        this.#root.insertBefore(node, nextSurvivingSibling);
        nextSurvivingSibling = node;
      }
    }

    for (const [node, hidden] of this.#browserHiddenStates) {
      node.hidden = hidden;
      node.removeAttribute(EMPTY_SEPARATOR_ATTRIBUTE);
    }
    for (const node of this.#root.children) {
      node.removeAttribute(EMPTY_SEPARATOR_ATTRIBUTE);
    }
    this.#moreActionsMenu.hidden = true;

    this.#actionKeys.clear();
    this.#browserHiddenStates.clear();
    this.#movedActions.clear();
    this.#rootOrder = [];
    return true;
  }
}

export type PopupFinalizerCleanup = (callback: () => void) => void;

/**
 * Arms a finalizer for the exact popupshowing event currently leaving its target.
 * The listener is appended at the highest bubbling node during dispatch, after all
 * listeners registered before that dispatch. Deferred work only removes a finalizer
 * whose event never reached the window; it never performs presentation work.
 */
export const armSynchronousPopupFinalizer = (
  ownerWindow: EventTarget,
  sourceEvent: Event,
  finalize: () => void,
  deferCleanup: PopupFinalizerCleanup = queueMicrotask,
): (() => void) => {
  let active = true;
  const cancel = () => {
    if (!active) {
      return;
    }
    active = false;
    ownerWindow.removeEventListener("popupshowing", onWindowShowing);
  };
  const onWindowShowing = (event: Event) => {
    if (!active || event !== sourceEvent) {
      return;
    }
    cancel();
    finalize();
  };

  ownerWindow.addEventListener("popupshowing", onWindowShowing);
  deferCleanup(cancel);
  return cancel;
};
