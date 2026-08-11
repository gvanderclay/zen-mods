/**
 * The complete semantic state of the status panel. Pure: it owns no DOM and receives
 * one already-inspected snapshot, so a renderer never has to combine a new body with an
 * action left over from an older inventory.
 */

import { type ButtonState, wakeButtonState } from "./actions.ts";
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

interface MessagePanelPresentation extends PanelControls {
  readonly action: ButtonState;
  readonly content: MessageContent;
  readonly kind: "loading" | "unavailable";
}

interface ReportPanelPresentation extends PanelControls {
  readonly action: ButtonState;
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
      readonly feedback: string | null;
      readonly hasRecoveryAttempts: boolean;
      readonly kept: number;
      readonly kind: "snapshot";
      readonly report: PanelReport;
      readonly sleeping: number;
    };

const hasCrashedRow = (report: PanelReport) =>
  report.groups.some(group => group.rows.some(row => row.state === "crashed"));

export function panelPresentation(input: PanelPresentationInput): PanelPresentation {
  switch (input.kind) {
    case "loading":
      return {
        action: { disabled: true, label: "Checking…" },
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
        action: { disabled: true, label: "Unavailable" },
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
      const action = wakeButtonState({
        busy: input.busy,
        kept: input.kept,
        sleeping: input.sleeping,
      });
      const content = { kind: "report" as const, report: input.report };
      const controls: PanelControls = {
        feedback: input.feedback,
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
        kind: hasCrashedRow(input.report) ? "recovery" : "ready",
        ...controls,
      };
    }
  }
}
