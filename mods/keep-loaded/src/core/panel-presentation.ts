/**
 * The complete semantic state of the status panel. Pure: it owns no DOM and receives
 * one already-inspected snapshot, so a renderer never has to combine a new body with an
 * action left over from an older inventory.
 */

import { wakeButtonState } from "./actions.ts";
import type { PanelReport } from "./rows.ts";

interface MessageContent {
  readonly kind: "lines";
  readonly lines: readonly string[];
}

interface ReportContent {
  readonly kind: "report";
  readonly report: PanelReport;
}

export interface ResetActionState {
  readonly disabled: boolean;
  readonly label: "Reset crash recovery history";
  readonly visible: boolean;
}

interface PanelControls {
  readonly feedback: string | null;
  readonly reset: ResetActionState;
}

export interface PanelActionState {
  readonly disabled: boolean;
  readonly label: string;
  readonly visible: boolean;
}

interface MessagePanelPresentation extends PanelControls {
  readonly action: PanelActionState;
  readonly content: MessageContent;
  readonly kind: "loading" | "unavailable";
}

interface ReportPanelPresentation extends PanelControls {
  readonly action: PanelActionState;
  readonly content: ReportContent;
  readonly kind: "busy" | "empty" | "ready" | "recovery";
}

export type PanelPresentation =
  | MessagePanelPresentation
  | ReportPanelPresentation
  | { readonly kind: "stopped" };

export type PanelPresentationInput =
  | { readonly kind: "loading" | "stopped" | "unavailable" }
  | {
      readonly busy: boolean;
      readonly busyActionLabel: "Recovering…" | "Refreshing…" | "Waking…";
      readonly feedback: string | null;
      readonly hasRecoveryAttempts: boolean;
      readonly kept: number;
      readonly kind: "snapshot";
      readonly progress: string | null;
      readonly report: PanelReport;
      readonly sleeping: number;
    };

const hasCrashedRow = (report: PanelReport) =>
  report.groups.some(group => group.rows.some(row => row.state === "crashed"));

export function panelPresentation(input: PanelPresentationInput): PanelPresentation {
  switch (input.kind) {
    case "loading":
      return {
        action: { disabled: true, label: "Checking…", visible: true },
        content: { kind: "lines", lines: ["Checking kept tabs…"] },
        kind: "loading",
        feedback: null,
        reset: {
          disabled: true,
          label: "Reset crash recovery history",
          visible: false,
        },
      };
    case "stopped":
      return { kind: "stopped" };
    case "unavailable":
      return {
        action: { disabled: true, label: "Unavailable", visible: true },
        content: {
          kind: "lines",
          lines: [
            "Status unavailable",
            "Keep Loaded couldn’t inspect tabs. Check the Browser Console for details.",
          ],
        },
        kind: "unavailable",
        feedback: null,
        reset: {
          disabled: true,
          label: "Reset crash recovery history",
          visible: false,
        },
      };
    case "snapshot": {
      const button = wakeButtonState({
        busy: input.busy,
        kept: input.kept,
        sleeping: input.sleeping,
      });
      const content = { kind: "report" as const, report: input.report };
      const crashed = hasCrashedRow(input.report);
      const visible = input.kept > 0 && (input.busy || input.sleeping > 0 || !crashed);
      const action: PanelActionState = visible
        ? {
            ...button,
            label: input.busy ? input.busyActionLabel : button.label,
            visible: true,
          }
        : { disabled: true, label: "", visible: false };
      const controls: PanelControls = {
        feedback: input.feedback ?? input.progress,
        reset: {
          disabled: !input.hasRecoveryAttempts,
          label: "Reset crash recovery history",
          visible: input.hasRecoveryAttempts,
        },
      };
      if (!input.kept) {
        return { action, content, kind: "empty", ...controls };
      }
      if (input.busy) {
        return { action, content, kind: "busy", ...controls };
      }
      return {
        action,
        content,
        kind: crashed ? "recovery" : "ready",
        ...controls,
      };
    }
  }
}
