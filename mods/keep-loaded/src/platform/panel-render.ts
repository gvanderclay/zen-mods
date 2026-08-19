/**
 * The status panel's presentation DOM: the element ids the view exposes, the accessors
 * that find them, the XUL nodes each body state is built from, and the one function that
 * applies a complete presentation to an installed view. Privileged only in that it uses
 * the chrome document's `createXULElement`; it registers nothing and owns no lifecycle.
 * `panel.ts` owns the view template, `CustomizableUI` installation, and the widget lease,
 * and depends on this module rather than the other way around.
 */

import type { PanelPresentation } from "../core/panel-presentation.ts";
import type { PanelReport } from "../core/rows.ts";

export const BODY_ID = "keep-loaded-panel-body";
export const WAKE_ID = "keep-loaded-wake-button";
export const RESET_ID = "keep-loaded-reset-button";
export const FEEDBACK_ID = "keep-loaded-panel-feedback";

/** XUL labels carry their text in `value`, not as a child text node. */
const labelNode = (document: Document, className: string, value: string) => {
  const label = document.createXULElement("label");
  label.className = className;
  label.setAttribute("value", value);
  return label;
};

/**
 * Everything below takes the panelview rather than its body, because the action button
 * is a sibling of the body and refilling one has to be able to update the other.
 */
const bodyOf = (view: Element) => view.querySelector(`#${BODY_ID}`);
const actionOf = (view: Element) => view.querySelector(`#${WAKE_ID}`);
const resetOf = (view: Element) => view.querySelector(`#${RESET_ID}`);
const feedbackOf = (view: Element) => view.querySelector(`#${FEEDBACK_ID}`);

const messageNodes = (
  document: Document,
  lines: readonly string[],
  kind: "loading" | "unavailable",
) => {
  const summary = document.createXULElement("vbox");
  summary.className =
    kind === "unavailable"
      ? "keep-loaded-panel-summary keep-loaded-panel-message"
      : "keep-loaded-panel-summary";
  const [total, detail] = lines;
  if (total) {
    summary.appendChild(labelNode(document, "keep-loaded-panel-total", total));
  }
  if (detail) {
    summary.appendChild(labelNode(document, "keep-loaded-panel-summary-line", detail));
  }
  return [summary];
};

const reportNodes = (document: Document, report: PanelReport) => {
  const summary = document.createXULElement("vbox");
  summary.className = "keep-loaded-panel-summary";
  summary.appendChild(labelNode(document, "keep-loaded-panel-total", report.total));
  summary.appendChild(
    labelNode(document, "keep-loaded-panel-summary-line", report.summary),
  );
  const nodes: Element[] = [summary];

  const groups = document.createXULElement("vbox");
  groups.className = "keep-loaded-panel-groups";

  for (const group of report.groups) {
    const section = document.createXULElement("vbox");
    section.className = "keep-loaded-panel-group";
    section.appendChild(labelNode(document, "keep-loaded-space", group.space));
    for (const row of group.rows) {
      const box = document.createXULElement("vbox");
      box.className = "keep-loaded-row";
      box.setAttribute("data-state", row.state);
      if (row.state === "crashed") {
        box.setAttribute("data-severity", "critical");
      } else if (row.state === "asleep") {
        box.setAttribute("data-severity", "attention");
      }
      if (row.url) {
        box.setAttribute("tooltiptext", row.url);
      }

      const head = document.createXULElement("hbox");
      head.className = "keep-loaded-row-head";
      head.appendChild(labelNode(document, "keep-loaded-row-title", row.title));
      const spacer = document.createXULElement("spacer");
      spacer.setAttribute("flex", "1");
      head.appendChild(spacer);
      head.appendChild(labelNode(document, "keep-loaded-row-state", row.stateLabel));

      box.appendChild(head);
      if (row.detail) {
        box.appendChild(labelNode(document, "keep-loaded-row-detail", row.detail));
      }
      section.appendChild(box);
    }
    groups.appendChild(section);
  }
  if (report.groups.length > 0) {
    nodes.push(groups);
  }
  return nodes;
};

/**
 * Applies one complete presentation. The body nodes are built before either current
 * region changes, and the action is disabled before publication, so a failed render can
 * never leave a clickable action paired with incomplete or stale content.
 */
export const renderPanelPresentation = (
  view: Element,
  presentation: PanelPresentation,
): boolean => {
  if (presentation.kind === "stopped") {
    return false;
  }
  const body = bodyOf(view);
  const action = actionOf(view);
  const reset = resetOf(view);
  const feedback = feedbackOf(view);
  if (!body || !action || !reset || !feedback) {
    return false;
  }
  const nodes =
    presentation.content.kind === "report"
      ? reportNodes(body.ownerDocument, presentation.content.report)
      : messageNodes(
          body.ownerDocument,
          presentation.content.lines,
          presentation.kind === "unavailable" ? "unavailable" : "loading",
        );

  action.setAttribute("disabled", "true");
  if (presentation.action.visible) {
    action.removeAttribute("hidden");
  } else {
    action.setAttribute("hidden", "true");
  }
  body.replaceChildren(...nodes);
  action.setAttribute("label", presentation.action.label);
  if (!presentation.action.disabled) {
    action.removeAttribute("disabled");
  }
  reset.setAttribute("label", presentation.reset.label);
  reset.setAttribute("disabled", "true");
  if (presentation.reset.visible) {
    reset.removeAttribute("hidden");
    if (!presentation.reset.disabled) {
      reset.removeAttribute("disabled");
    }
  } else {
    reset.setAttribute("hidden", "true");
  }
  feedback.setAttribute("value", presentation.feedback ?? "");
  if (presentation.feedback) {
    feedback.removeAttribute("hidden");
  } else {
    feedback.setAttribute("hidden", "true");
  }
  view.setAttribute("data-presentation", presentation.kind);
  return true;
};
