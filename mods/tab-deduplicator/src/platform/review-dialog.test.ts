import { describe, expect, it, vi } from "vitest";
import type { CloseReview } from "../core/review.ts";
import { installCloseReviewDialog } from "./review-dialog.ts";

class FakeElement extends EventTarget {
  readonly localName: string;
  id = "";
  className = "";
  textContent = "";
  title = "";
  hidden = false;
  disabled = false;
  checked = false;
  open = false;
  parentElement: FakeElement | null = null;
  readonly dataset: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  focus = vi.fn();

  constructor(localName = "div") {
    super();
    this.localName = localName;
  }

  append(...children: FakeElement[]) {
    for (const child of children) {
      child.remove();
      child.parentElement = this;
      this.children.push(child);
    }
  }

  replaceChildren(...children: FakeElement[]) {
    for (const child of this.children) {
      child.parentElement = null;
    }
    this.children.length = 0;
    this.append(...children);
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
    if (name === "id") {
      this.id = value;
    }
    if (name === "class") {
      this.className = value;
    }
  }

  showModal() {
    if (this.open) {
      throw new Error("already open");
    }
    this.open = true;
  }

  close() {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  }
}

class FakeDocument {
  readonly documentElement = new FakeElement();

  createElementNS(_namespace: string, name: string) {
    return new FakeElement(name);
  }

  getElementById(id: string) {
    const visit = (node: FakeElement): FakeElement | null => {
      if (node.id === id) {
        return node;
      }
      for (const child of node.children) {
        const match = visit(child);
        if (match) {
          return match;
        }
      }
      return null;
    };
    return visit(this.documentElement);
  }
}

const find = (node: FakeElement, className: string): FakeElement => {
  if (node.className.split(" ").includes(className)) {
    return node;
  }
  for (const child of node.children) {
    try {
      return find(child, className);
    } catch {}
  }
  throw new Error(`Missing .${className}`);
};

const requiredDialog = (document: FakeDocument) => {
  const dialog = document.getElementById("tab-deduplicator-review");
  if (!dialog) {
    throw new Error("Missing review dialog");
  }
  return dialog;
};

const review = (pinnedChoiceCount = 1): CloseReview => ({
  scope: "space",
  ordinaryCount: 1,
  pinnedChoiceCount,
  stayingCount: pinnedChoiceCount + 1,
  groups: [
    {
      key: "group-a",
      url: "https://mail.example/inbox",
      containerId: 2,
      laneLabel: "Work",
      rows: [
        {
          id: "keeper",
          title: "Inbox",
          state: "keeping",
          pinned: true,
          essential: false,
        },
        {
          id: "ordinary",
          title: "Inbox duplicate",
          state: "closing",
          pinned: false,
          essential: false,
        },
        ...(pinnedChoiceCount > 0
          ? [
              {
                id: "pinned",
                title: "Pinned inbox",
                state: "pinned-choice" as const,
                pinned: true,
                essential: false,
              },
            ]
          : []),
      ],
    },
  ],
});

const click = (node: FakeElement) => node.dispatchEvent(new Event("click"));
const change = (node: FakeElement) => node.dispatchEvent(new Event("change"));

describe("installCloseReviewDialog", () => {
  it("renders the compact review and puts safe default focus on Cancel", async () => {
    const document = new FakeDocument();
    const presenter = installCloseReviewDialog({
      document: document as unknown as Document,
      isLive: () => true,
    });
    const decision = presenter.show(review(), { changed: false });
    const dialog = requiredDialog(document);
    const summary = find(dialog, "tab-deduplicator-review-summary");
    const pinnedChoice = find(dialog, "tab-deduplicator-review-pinned-choice");
    const cancel = find(dialog, "tab-deduplicator-review-cancel");
    const confirm = find(dialog, "tab-deduplicator-review-confirm");

    expect(dialog.open).toBe(true);
    expect(pinnedChoice.checked).toBe(true);
    expect(summary.textContent).toBe("2 tabs will close. 1 will stay.");
    expect(confirm.textContent).toBe("Close 2 tabs");
    expect(cancel.localName).toBe("moz-button");
    expect(confirm.localName).toBe("moz-button");
    expect(confirm.attributes.get("type")).toBe("primary");
    expect(find(dialog, "tab-deduplicator-review-group-title").textContent).toBe(
      "https://mail.example/inbox",
    );
    expect(cancel.focus).toHaveBeenCalledOnce();

    click(cancel);
    await expect(decision).resolves.toEqual({ kind: "cancel" });
  });

  it("updates pinned rows, summary, and confirmation count after explicit opt-out", async () => {
    const document = new FakeDocument();
    const presenter = installCloseReviewDialog({
      document: document as unknown as Document,
      isLive: () => true,
    });
    const decision = presenter.show(review(), { changed: false });
    const dialog = requiredDialog(document);
    const pinnedChoice = find(dialog, "tab-deduplicator-review-pinned-choice");
    const summary = find(dialog, "tab-deduplicator-review-summary");
    const confirm = find(dialog, "tab-deduplicator-review-confirm");
    const pinnedRow = find(dialog, "tab-deduplicator-review-row-pinned");

    expect(pinnedChoice.checked).toBe(true);
    pinnedChoice.checked = false;
    change(pinnedChoice);
    expect(summary.textContent).toBe("1 tab will close. 2 will stay.");
    expect(confirm.textContent).toBe("Close 1 tab");
    expect(pinnedRow.dataset.state).toBe("keeping");

    click(confirm);
    await expect(decision).resolves.toEqual({
      kind: "confirm",
      includePinned: false,
    });
  });

  it("explains changed evidence and hides unavailable pinned authorization", () => {
    const document = new FakeDocument();
    const presenter = installCloseReviewDialog({
      document: document as unknown as Document,
      isLive: () => true,
    });
    void presenter.show(review(0), { changed: true });
    const dialog = requiredDialog(document);

    expect(find(dialog, "tab-deduplicator-review-changed").hidden).toBe(false);
    expect(find(dialog, "tab-deduplicator-review-pinned-control").hidden).toBe(true);
  });

  it("treats Escape, replacement opens, and teardown as cancellation", async () => {
    const document = new FakeDocument();
    let live = true;
    const presenter = installCloseReviewDialog({
      document: document as unknown as Document,
      isLive: () => live,
    });
    const dialog = requiredDialog(document);

    const escaped = presenter.show(review(), { changed: false });
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    await expect(escaped).resolves.toEqual({ kind: "cancel" });

    const replaced = presenter.show(review(), { changed: false });
    const current = presenter.show(review(0), { changed: false });
    await expect(replaced).resolves.toEqual({ kind: "cancel" });

    live = false;
    presenter.dispose();
    await expect(current).resolves.toEqual({ kind: "cancel" });
    expect(dialog.parentElement).toBeNull();
    await expect(presenter.show(review(), { changed: false })).resolves.toEqual({
      kind: "cancel",
    });
  });

  it("removes only its captured node when a successor uses the same id", () => {
    const document = new FakeDocument();
    const first = installCloseReviewDialog({
      document: document as unknown as Document,
      isLive: () => true,
    });
    const firstNode = requiredDialog(document);
    const second = installCloseReviewDialog({
      document: document as unknown as Document,
      isLive: () => true,
    });
    const secondNode = requiredDialog(document);

    expect(secondNode).not.toBe(firstNode);
    first.dispose();
    expect(document.getElementById("tab-deduplicator-review")).toBe(secondNode);
    second.dispose();
    expect(document.getElementById("tab-deduplicator-review")).toBeNull();
  });
});
