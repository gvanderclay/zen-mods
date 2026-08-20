/** The status panel's projection and its widget resource, owned by one generation. */

import type {
  ApplicationOwnerApi,
  ApplicationRegistration,
} from "./application-coordinator.ts";
import type { KeepLoadedController } from "./controller.ts";
import type { CrashFacts } from "./core/crash.ts";
import { panelPresentation } from "./core/panel-presentation.ts";
import { panelReport, type RowFacts } from "./core/rows.ts";
import { shortUrl } from "./core/url.ts";
import { factsFor, spaceNameFor } from "./platform/browser.ts";
import { installStatusPanel } from "./platform/panel.ts";
import { renderPanelPresentation } from "./platform/panel-render.ts";
import type { PreferencesPort } from "./platform/prefs.ts";
import { socketRecordFor } from "./platform/sockets.ts";
import { keptTabs, recordOf } from "./tab-inventory.ts";

export interface StatusPanelPorts {
  readonly application: () => ApplicationRegistration<BrowserTab, CrashFacts> | null;
  readonly applicationOwner: ApplicationOwnerApi<BrowserTab, CrashFacts>;
  readonly controller: KeepLoadedController;
  readonly runSweep: () => Promise<void>;
  readonly settings: PreferencesPort;
}

export const createStatusPanel = ({
  application: applicationPort,
  applicationOwner,
  controller,
  runSweep,
  settings,
}: StatusPanelPorts) => {
  let panelView: Element | null = null;
  let panelFeedback: string | null = null;

  /** Joined here, not in `core`: both readings are keyed on the tab object itself. */
  const panelFacts = (now: number): { rows: RowFacts[]; sleeping: number } => {
    const rows: RowFacts[] = [];
    let sleeping = 0;
    const snapshot = settings.snapshot();
    const operation =
      controller.state.kind === "live" ? controller.state.operation : null;
    for (const { tab, facts } of keptTabs(settings)) {
      if (facts.pending) {
        sleeping += 1;
      }
      const socket = socketRecordFor(tab, facts.space, facts.url);
      rows.push({
        // Zen's own space name, unlike the log lines: a panel is read by a person.
        space: spaceNameFor(tab),
        url: facts.url,
        pending: facts.pending,
        // `recordOf`, not `signFor`: the panel and the console must agree.
        last: recordOf({ tab, facts }).last,
        frames: socket.watching
          ? { in: socket.framesIn, out: socket.framesOut, lastAt: socket.lastFrameAt }
          : null,
        recovery: {
          active: operation?.kind === "recovery" && operation.tab === tab,
          attempts:
            applicationPort()?.recentRecoveryAttempts(tab, now, snapshot.crashWindowMs)
              .length ?? 0,
          maxAttempts: snapshot.crashAttempts,
        },
      });
    }
    return { rows, sleeping };
  };

  const fillPanel = (view: Element) => {
    // The node check stops a retained old facade rendering into a new generation.
    if (!controller.isLive() || view !== panelView) {
      return;
    }
    try {
      const now = Date.now();
      const facts = panelFacts(now);
      const owner = applicationOwner.snapshot();
      const localOperation =
        controller.state.kind === "live" ? controller.state.operation : null;
      const progress = owner.activeKind
        ? owner.activeKind === "recovery"
          ? localOperation?.kind === "recovery"
            ? `Recovering ${shortUrl(factsFor(localOperation.tab).url) || "kept tab"}…`
            : "Recovering a kept tab…"
          : owner.activeKind === "pulse"
            ? "Refreshing kept tabs…"
            : facts.sleeping > 0
              ? `Waking ${facts.sleeping} sleeping ${facts.sleeping === 1 ? "tab" : "tabs"}…`
              : "Checking kept tabs…"
        : null;
      renderPanelPresentation(
        view,
        panelPresentation({
          kind: "snapshot",
          kept: facts.rows.length,
          progress,
          report: panelReport(facts.rows, now),
          sleeping: facts.sleeping,
          busy: applicationPort()?.isApplicationBusy() ?? controller.isBusy(),
          busyActionLabel:
            owner.activeKind === "recovery"
              ? "Recovering…"
              : owner.activeKind === "pulse"
                ? "Refreshing…"
                : "Waking…",
          feedback: panelFeedback,
          hasRecoveryAttempts: applicationPort()?.hasRecoveryAttempts() ?? false,
        }),
      );
    } catch (error) {
      console.error("[keep-loaded] could not fill the status panel", error);
      renderPanelPresentation(view, panelPresentation({ kind: "unavailable" }));
    }
  };

  /** Defers each disposer where it is created, so teardown order stays local. */
  const attach = (registration: ApplicationRegistration<BrowserTab, CrashFacts>) => {
    let panelResource: Readonly<{
      dispose: ReturnType<typeof installStatusPanel>;
      view: Element | null;
    }> | null = null;
    const disposePanelResource = () => {
      const current = panelResource;
      if (!current) {
        return false;
      }
      panelResource = null;
      if (panelView === current.view) {
        panelView = null;
      }
      current.dispose();
      return true;
    };
    const installPanelResource = () => {
      if (!controller.isLive() || panelResource) {
        return false;
      }
      let installedView: Element | null = null;
      const dispose = installStatusPanel({
        widgetOwner: registration,
        isLive: () => controller.isLive(),
        onViewReady: view => {
          installedView = view;
          panelView = view;
        },
        onViewShowing: view => fillPanel(view),
        onWidgetError: error => {
          console.error("[keep-loaded] status widget creation failed", error);
          controller.stop("startup-failure");
        },
        onReset: view => {
          if (!controller.isLive() || view !== panelView) {
            return;
          }
          if (registration.resetRecoveryAttempts()) {
            panelFeedback = "Crash recovery history reset for this Zen session";
            fillPanel(view);
          }
        },
        onWake: view => {
          if (!controller.isLive()) {
            return;
          }
          const wake = runSweep();
          void controller.settlePanel(
            wake,
            () => fillPanel(view),
            error => {
              console.error("[keep-loaded] waking from the panel failed", error);
              fillPanel(view);
            },
          );
        },
      });
      if (!controller.isLive()) {
        dispose();
        return false;
      }
      panelResource = Object.freeze({ dispose, view: installedView });
      return true;
    };
    controller.defer(disposePanelResource);
    controller.defer(
      settings.observe("status-button", () => {
        if (!controller.isLive()) {
          return;
        }
        if (settings.snapshot().showStatusButton) {
          try {
            installPanelResource();
          } catch (error) {
            console.error("[keep-loaded] status widget creation failed", error);
            controller.stop("startup-failure");
          }
        } else {
          disposePanelResource();
        }
      }),
    );

    return { disposePanelResource, installPanelResource };
  };

  /** Redraw the current host's view, if this generation still has one. */
  const refresh = () => {
    if (panelView) {
      fillPanel(panelView);
    }
  };

  return { attach, fillPanel, refresh };
};
