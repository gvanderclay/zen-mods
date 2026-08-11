import type { CloseReview, CloseReviewDecision, CloseReviewRow } from "../core/review.ts";

const DIALOG_ID = "tab-deduplicator-review";
const XHTML = "http://www.w3.org/1999/xhtml";

const create = <Name extends keyof HTMLElementTagNameMap>(
  document: Document,
  name: Name,
  className: string,
) => {
  const element = document.createElementNS(XHTML, name) as HTMLElementTagNameMap[Name];
  element.className = className;
  return element;
};

interface MozButtonElement extends HTMLElement {
  disabled: boolean;
}

const createButton = (
  document: Document,
  className: string,
  type: "default" | "primary",
) => {
  const button = document.createElementNS(XHTML, "moz-button") as MozButtonElement;
  button.className = className;
  button.setAttribute("type", type);
  button.setAttribute("size", "small");
  return button;
};

const countLabel = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

const rowDetail = (row: CloseReviewRow) => {
  if (row.essential) {
    return "Essential";
  }
  return row.pinned ? "Pinned" : null;
};

const staticStateLabel = (row: CloseReviewRow) => {
  if (row.state === "closing") {
    return "Close";
  }
  if (row.state === "protected") {
    return "Protected";
  }
  return "Keep";
};

export interface CloseReviewPresenter {
  show(review: CloseReview, status: { changed: boolean }): Promise<CloseReviewDecision>;
  dispose(): void;
}

interface InstallCloseReviewDialogOptions {
  document: Document;
  isLive: () => boolean;
}

export const installCloseReviewDialog = ({
  document,
  isLive,
}: InstallCloseReviewDialogOptions): CloseReviewPresenter => {
  const stale = document.getElementById(DIALOG_ID);
  stale?.dispatchEvent(new Event("tab-deduplicator-review-replaced"));
  stale?.remove();

  const dialog = create(document, "dialog", "tab-deduplicator-review");
  dialog.id = DIALOG_ID;
  dialog.setAttribute("aria-labelledby", `${DIALOG_ID}-title`);
  dialog.setAttribute("aria-describedby", `${DIALOG_ID}-summary ${DIALOG_ID}-changed`);

  const surface = create(document, "article", "tab-deduplicator-review-surface");
  const header = create(document, "header", "tab-deduplicator-review-header");
  const title = create(document, "h1", "tab-deduplicator-review-title");
  title.id = `${DIALOG_ID}-title`;
  title.textContent = "Review duplicates";
  const summary = create(document, "p", "tab-deduplicator-review-summary");
  summary.id = `${DIALOG_ID}-summary`;
  const changed = create(document, "p", "tab-deduplicator-review-changed");
  changed.id = `${DIALOG_ID}-changed`;
  changed.textContent = "The duplicate set changed. Review the updated tabs.";
  header.append(title, summary, changed);

  const groups = create(document, "div", "tab-deduplicator-review-groups");
  const pinnedControl = create(
    document,
    "label",
    "tab-deduplicator-review-pinned-control",
  );
  const pinnedChoice = create(document, "input", "tab-deduplicator-review-pinned-choice");
  pinnedChoice.type = "checkbox";
  const pinnedLabel = create(document, "span", "tab-deduplicator-review-pinned-label");
  pinnedControl.append(pinnedChoice, pinnedLabel);

  const footer = create(document, "footer", "tab-deduplicator-review-footer");
  const cancel = createButton(document, "tab-deduplicator-review-cancel", "default");
  cancel.textContent = "Cancel";
  const confirm = createButton(document, "tab-deduplicator-review-confirm", "primary");
  footer.append(cancel, confirm);
  surface.append(header, groups, pinnedControl, footer);
  dialog.append(surface);
  document.documentElement.append(dialog);

  let active = true;
  let pending: ((decision: CloseReviewDecision) => void) | null = null;
  let currentReview: CloseReview | null = null;
  let pinnedRows: Array<{ row: HTMLElement; status: HTMLElement }> = [];

  const closeCount = () =>
    (currentReview?.ordinaryCount ?? 0) +
    (pinnedChoice.checked ? (currentReview?.pinnedChoiceCount ?? 0) : 0);

  const updateChoice = () => {
    const review = currentReview;
    if (!review) {
      return;
    }
    const closing = closeCount();
    const total = review.groups.reduce((count, group) => count + group.rows.length, 0);
    summary.textContent = `${countLabel(closing, "tab")} will close. ${total - closing} will stay.`;
    confirm.textContent = `Close ${countLabel(closing, "tab")}`;
    confirm.disabled = closing === 0;
    for (const item of pinnedRows) {
      item.row.dataset.state = pinnedChoice.checked ? "closing" : "keeping";
      item.status.textContent = pinnedChoice.checked ? "Closing" : "Keeping";
    }
  };

  const render = (review: CloseReview, wasChanged: boolean) => {
    currentReview = review;
    pinnedRows = [];
    pinnedChoice.checked = review.pinnedChoiceCount > 0;
    changed.hidden = !wasChanged;
    pinnedControl.hidden = review.pinnedChoiceCount === 0;
    pinnedLabel.textContent = `Include ${countLabel(review.pinnedChoiceCount, "pinned duplicate")}`;

    const groupNodes = review.groups.map(group => {
      const section = create(document, "section", "tab-deduplicator-review-group");
      const groupHeader = create(document, "div", "tab-deduplicator-review-group-header");
      const groupTitle = create(document, "h2", "tab-deduplicator-review-group-title");
      groupTitle.textContent = group.url;
      groupTitle.title = group.url;
      const context = create(document, "p", "tab-deduplicator-review-context");
      context.textContent =
        group.containerId > 0
          ? `${group.laneLabel} · Container ${group.containerId}`
          : group.laneLabel;
      const url = create(document, "p", "tab-deduplicator-review-url");
      url.textContent = countLabel(group.rows.length, "copy");
      groupHeader.append(context, groupTitle, url);

      const rows = create(document, "div", "tab-deduplicator-review-rows");
      for (const row of group.rows) {
        const rowNode = create(document, "div", "tab-deduplicator-review-row");
        rowNode.dataset.state = row.state;
        if (row.state === "pinned-choice") {
          rowNode.className += " tab-deduplicator-review-row-pinned";
        }
        const copy = create(document, "div", "tab-deduplicator-review-row-copy");
        const rowTitle = create(document, "span", "tab-deduplicator-review-row-title");
        rowTitle.textContent = row.title;
        rowTitle.title = row.title;
        copy.append(rowTitle);
        const detailText = rowDetail(row);
        if (detailText) {
          const detail = create(document, "span", "tab-deduplicator-review-row-detail");
          detail.textContent = detailText;
          copy.append(detail);
        }
        const state = create(document, "span", "tab-deduplicator-review-row-state");
        state.textContent = staticStateLabel(row);
        rowNode.append(copy, state);
        rows.append(rowNode);
        if (row.state === "pinned-choice") {
          pinnedRows.push({ row: rowNode, status: state });
        }
      }
      section.append(groupHeader, rows);
      return section;
    });
    groups.replaceChildren(...groupNodes);
    updateChoice();
  };

  const settle = (decision: CloseReviewDecision, closeDialog = true) => {
    const resolve = pending;
    if (!resolve) {
      return;
    }
    pending = null;
    if (closeDialog && dialog.open) {
      dialog.close();
    }
    resolve(decision);
  };

  const onCancel = (event: Event) => {
    event.preventDefault();
    settle({ kind: "cancel" });
  };
  const onClose = () => settle({ kind: "cancel" }, false);
  const onCancelClick = () => settle({ kind: "cancel" });
  const onConfirmClick = () =>
    settle({ kind: "confirm", includePinned: pinnedChoice.checked });
  const onReplaced = () => settle({ kind: "cancel" }, false);

  dialog.addEventListener("cancel", onCancel);
  dialog.addEventListener("close", onClose);
  dialog.addEventListener("tab-deduplicator-review-replaced", onReplaced);
  cancel.addEventListener("click", onCancelClick);
  confirm.addEventListener("click", onConfirmClick);
  pinnedChoice.addEventListener("change", updateChoice);

  return {
    show(review, status) {
      if (!active || !isLive()) {
        return Promise.resolve({ kind: "cancel" });
      }
      settle({ kind: "cancel" });
      render(review, status.changed);
      return new Promise((resolve, reject) => {
        pending = resolve;
        try {
          dialog.showModal();
          cancel.focus();
        } catch (error) {
          pending = null;
          reject(error);
        }
      });
    },
    dispose() {
      if (!active) {
        return;
      }
      active = false;
      settle({ kind: "cancel" });
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onClose);
      dialog.removeEventListener("tab-deduplicator-review-replaced", onReplaced);
      cancel.removeEventListener("click", onCancelClick);
      confirm.removeEventListener("click", onConfirmClick);
      pinnedChoice.removeEventListener("change", updateChoice);
      dialog.remove();
    },
  };
};
