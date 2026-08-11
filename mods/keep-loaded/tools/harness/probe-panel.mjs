/**
 * Reproduces the status panel outside the user's browser: a blank button and an empty
 * panel are both DOM questions, and the harness can answer them without a human
 * reading a console back (M05.C01 failed its manual test on both counts).
 *
 * It rebuilds exactly what `src/platform/panel.ts` builds — same markup, same widget
 * spec, same `window.zenKeepLoaded.fillPanel` indirection — and injects the real
 * `styles/chrome.css` rather than a copy of it, registers it at the same USER_SHEET
 * origin Sine uses, then reports what the chrome DOM actually did with the result.
 *
 *     node tools/harness/probe-panel.mjs
 */

import { readFile } from "node:fs/promises";
import { openMarionette } from "./marionette.mjs";
import { launchZen } from "./zen.mjs";

/** The rows to render: one per state worth looking at, across two spaces. */
const REPORT = {
  total: "3 kept tabs",
  summary: "1 sleeping · 2 awake",
  groups: [
    {
      space: "🕵 Work",
      rows: [
        {
          title: "mail.google.com/mail/u/0/#inbox",
          url: "https://mail.google.com/mail/u/0/#inbox",
          state: "asleep",
          stateLabel: "Sleeping",
          detail: "Unloaded 2m ago",
        },
        {
          title: "app.slack.com/client/T07KM2SEAV6",
          url: "https://app.slack.com/client/T07KM2SEAV6",
          state: "alive",
          stateLabel: "Awake",
          // Long on purpose: the detail line is the one that has to wrap.
          detail: "Title changed 12s ago · WebSocket activity 3s ago",
        },
      ],
    },
    {
      space: "🐟 Home",
      rows: [
        {
          title: "calendar.google.com/calendar/u/0/r",
          url: "https://calendar.google.com/calendar/u/0/r?pli=1",
          state: "alive",
          stateLabel: "Awake",
          detail: "Live browser 39s ago",
        },
      ],
    },
  ],
};

const PROBE = `
  const done = arguments[arguments.length - 1];
  const css = arguments[0];
  const report = arguments[1];
  const BUTTON_ID = "keep-loaded-button";
  const VIEW_ID = "keep-loaded-panelview";
  const BODY_ID = "keep-loaded-panel-body";
  const WAKE_ID = "keep-loaded-wake-button";
  const AREA = "zen-sidebar-foot-buttons";
  const VIEW_XUL = \`
    <panelview id="\${VIEW_ID}" class="PanelUI-subView keep-loaded-panelview" mainview-with-header="true">
      <box class="panel-header"><html:h1><html:span>Keep Loaded</html:span></html:h1></box>
      <toolbarseparator/>
      <vbox id="\${BODY_ID}" class="panel-subview-body"/>
      <toolbarseparator/>
      <vbox class="keep-loaded-panel-footer">
        <toolbarbutton id="\${WAKE_ID}"
                       class="subviewbutton panel-subview-footer-button keep-loaded-wake-button"
                       closemenu="none"/>
      </vbox>
    </panelview>
  \`;

  const out = { fillDurationsMs: [], steps: [] };
  const step = (name, value) => { out.steps.push(name + ": " + value); };
  const box = node => {
    const rect = node.getBoundingClientRect();
    return Math.round(rect.width) + "x" + Math.round(rect.height);
  };

  try {
    // The mod's own stylesheet, not a copy of it: a rule that only exists in this file
    // is a rule the probe cannot vouch for.
    const sheetURI = Services.io.newURI(
      "data:text/css;charset=utf-8," + encodeURIComponent(css),
    );
    window.__keepLoadedPanelProbeSheetURI = sheetURI;
    window.windowUtils.loadSheet(sheetURI, window.windowUtils.USER_SHEET);

    const cache = document.getElementById("appMenu-viewCache");
    step("viewCache", cache ? "found" : "MISSING");
    cache.content.appendChild(MozXULElement.parseXULToFragment(VIEW_XUL));
    step("viewInCache", Boolean(cache.content.querySelector("#" + VIEW_ID)));

    let fillCalls = 0;
    let commandFired = 0;
    window.zenKeepLoaded = {
      // Mirrors renderPanelPresentation in src/platform/panel.ts.
      fillPanel: view => {
        const fillStartedAt = performance.now();
        fillCalls++;
        const body = view.querySelector("#" + BODY_ID);
        const action = view.querySelector("#" + WAKE_ID);
        if (action) {
          // What wakeButtonState returns for two sleeping tabs, then for a running
          // sweep: the label the button carries is the readout being checked.
          action.setAttribute("label", commandFired ? "Waking…" : "Wake 2 sleeping tabs");
          if (commandFired) {
            action.setAttribute("disabled", "true");
          } else {
            action.removeAttribute("disabled");
          }
        }
        const doc = body.ownerDocument;
        const label = (className, value) => {
          const node = doc.createXULElement("label");
          node.className = className;
          node.setAttribute("value", value);
          return node;
        };
        body.textContent = "";
        const summary = doc.createXULElement("vbox");
        summary.className = "keep-loaded-panel-summary";
        summary.appendChild(label("keep-loaded-panel-total", report.total));
        summary.appendChild(label("keep-loaded-panel-summary-line", report.summary));
        body.appendChild(summary);
        const groups = doc.createXULElement("vbox");
        groups.className = "keep-loaded-panel-groups";
        for (const group of report.groups) {
          const section = doc.createXULElement("vbox");
          section.className = "keep-loaded-panel-group";
          section.appendChild(label("keep-loaded-space", group.space));
          for (const row of group.rows) {
            const rowBox = doc.createXULElement("vbox");
            rowBox.className = "keep-loaded-row";
            rowBox.setAttribute("data-state", row.state);
            if (row.state === "asleep") rowBox.setAttribute("data-severity", "attention");
            rowBox.setAttribute("tooltiptext", row.url);
            const head = doc.createXULElement("hbox");
            head.className = "keep-loaded-row-head";
            head.appendChild(label("keep-loaded-row-title", row.title));
            const spacer = doc.createXULElement("spacer");
            spacer.setAttribute("flex", "1");
            head.appendChild(spacer);
            head.appendChild(label("keep-loaded-row-state", row.stateLabel));
            rowBox.appendChild(head);
            rowBox.appendChild(label("keep-loaded-row-detail", row.detail));
            section.appendChild(rowBox);
          }
          groups.appendChild(section);
        }
        body.appendChild(groups);
        out.fillDurationsMs.push(performance.now() - fillStartedAt);
      },
    };

    const cachedView = cache.content.querySelector("#" + VIEW_ID);
    cachedView.querySelector("#" + WAKE_ID).addEventListener("command", () => {
      commandFired++;
      window.zenKeepLoaded.fillPanel(cachedView);
    });

    CustomizableUI.createWidget({
      id: BUTTON_ID,
      type: "view",
      viewId: VIEW_ID,
      localized: false,
      label: "Keep Loaded",
      tooltiptext: "Kept tabs",
      defaultArea: AREA,
      onViewShowing: event => {
        out.viewShowingAt = performance.now();
        out.viewShowing = true;
        const view = event.target;
        out.bodyFound = Boolean(view.querySelector("#" + BODY_ID));
        // ownerGlobal is undefined here and ownerDocument is not — the bug M05.C01
        // shipped, kept as a regression check rather than a diagnosis.
        out.ownerGlobalType = typeof view.ownerGlobal;
        out.ownerDocumentIsDocument = view.ownerDocument === document;
        try {
          // The view, not the body: the footer button is the body's sibling.
          view.ownerDocument.defaultView?.zenKeepLoaded?.fillPanel?.(view);
        } catch (error) {
          out.fillFailure = String(error);
        }
      },
    });

    const placement = CustomizableUI.getPlacementOfWidget(BUTTON_ID);
    step("placement", placement ? placement.area + " #" + placement.position : "NONE");

    const button = document.getElementById(BUTTON_ID);
    step("buttonNode", button ? "found" : "MISSING");
    if (button) {
      const style = window.getComputedStyle(button);
      out.button = {
        label: button.getAttribute("label"),
        // "none" here is the blank-square bug: mode="icons" draws no label.
        listStyleImage: style.listStyleImage === "none" ? "NONE" : "set",
        rect: box(button),
        parentMode: button.closest("toolbar")?.getAttribute("mode") ?? null,
      };
      const icon = button.querySelector(".toolbarbutton-icon");
      out.button.iconRect = icon ? box(icon) : "no .toolbarbutton-icon";
    }

    out.openRequestedAt = performance.now();
    PanelUI.showSubView(VIEW_ID, button);

    setTimeout(() => {
      try {
        out.fillCalls = fillCalls;
        out.firstOpenToViewShowingMs = out.viewShowingAt - out.openRequestedAt;
        const body = document.getElementById(BODY_ID);
        out.bodyInDocument = Boolean(body);
        if (!body) {
          done(out);
          return;
        }
        out.bodyRect = box(body);
        const geometry = node => {
          const rect = node?.getBoundingClientRect();
          const style = node ? getComputedStyle(node) : null;
          return rect && style
            ? {
                bottom: Math.round(rect.bottom * 10) / 10,
                left: Math.round(rect.left * 10) / 10,
                paddingInlineEnd: style.paddingInlineEnd,
                paddingInlineStart: style.paddingInlineStart,
                right: Math.round(rect.right * 10) / 10,
                textAlign: style.textAlign,
                top: Math.round(rect.top * 10) / 10,
              }
            : null;
        };
        const view = document.getElementById(VIEW_ID);
        out.geometry = {
          action: geometry(document.getElementById(WAKE_ID)),
          body: geometry(body),
          firstRow: geometry(body.querySelector(".keep-loaded-row")),
          footer: geometry(view?.querySelector(".keep-loaded-panel-footer")),
          header: geometry(view?.querySelector(".panel-header")),
          headerTitle: geometry(view?.querySelector(".panel-header h1")),
          space: geometry(body.querySelector(".keep-loaded-space")),
          summary: geometry(body.querySelector(".keep-loaded-panel-summary")),
          total: geometry(body.querySelector(".keep-loaded-panel-total")),
          view: geometry(view),
        };
        const contentStart = out.geometry.total?.left;
        const actionPadding = Number.parseFloat(
          out.geometry.action?.paddingInlineStart ?? "NaN",
        );
        out.geometry.contentStarts = {
          actionLabel: (out.geometry.action?.left ?? Number.NaN) + actionPadding,
          firstRow: out.geometry.firstRow?.left ?? null,
          headerTitle: out.geometry.headerTitle?.left ?? null,
          space: out.geometry.space?.left ?? null,
          total: contentStart ?? null,
        };
        out.geometry.aligned = Object.values(out.geometry.contentStarts).every(
          start => typeof start === "number" && Math.abs(start - contentStart) < 1,
        );
        out.heading = (() => {
          const node = body.querySelector(".keep-loaded-panel-total");
          return node ? { rect: box(node), weight: getComputedStyle(node).fontWeight } : null;
        })();
        out.spaces = [...body.querySelectorAll(".keep-loaded-space")].map(node => ({
          value: node.getAttribute("value"),
          rect: box(node),
        }));
        out.rows = [...body.querySelectorAll(".keep-loaded-row")].map(node => {
          const title = node.querySelector(".keep-loaded-row-title");
          const state = node.querySelector(".keep-loaded-row-state");
          const detail = node.querySelector(".keep-loaded-row-detail");
          const titleRect = title.getBoundingClientRect();
          const stateRect = state.getBoundingClientRect();
          return {
            dataState: node.getAttribute("data-state"),
            rect: box(node),
            title: box(title),
            state: box(state),
            detail: box(detail),
            // The state word has to end up on the same line as the title, to its
            // right — i.e. the flex spacer did its job.
            sameLine: Math.abs(titleRect.top - stateRect.top) < 2,
            stateAfterTitle: stateRect.left >= titleRect.right,
            // Whether the CSS matched at all: the [data-state] rules move these.
            stateWeight: getComputedStyle(state).fontWeight,
            stateOpacity: getComputedStyle(state).opacity,
            detailOpacity: getComputedStyle(detail).opacity,
            detailWraps: getComputedStyle(detail).whiteSpace,
            tooltip: node.getAttribute("tooltiptext"),
          };
        });
        const action = document.getElementById(WAKE_ID);
        out.action = action
          ? {
              label: action.getAttribute("label"),
              disabled: action.getAttribute("disabled"),
              rect: box(action),
              // The footer sits outside .panel-subview-body, so a refill of the body
              // must not have taken it with it.
              insideBody: Boolean(action.closest("#" + BODY_ID)),
              panelState: action.closest("panel")?.state ?? "no panel",
            }
          : null;

        if (!action) {
          done(out);
          return;
        }

        // The real activation path, not a synthesised command event.
        action.click();
        setTimeout(() => {
          out.afterClick = {
            commandFired,
            fillCalls,
            label: action.getAttribute("label"),
            disabled: action.getAttribute("disabled"),
            // closemenu="none" is the claim under test: the panel has to still be open
            // for a refilled row list to be worth anything.
            panelState: action.closest("panel")?.state ?? "no panel",
            bodyChildren: document.getElementById(BODY_ID)?.childElementCount ?? -1,
          };

          // Publish the same complete unavailable state as M16.C02, after a successful
          // report and busy refill. This exact-chrome transition is what catches a stale
          // row or enabled footer surviving a body-only error render.
          const failureBody = document.getElementById(BODY_ID);
          const failureLine = (className, value) => {
            const node = document.createXULElement("label");
            node.className = className;
            node.setAttribute("value", value);
            return node;
          };
          const failureSummary = document.createXULElement("vbox");
          failureSummary.className = "keep-loaded-panel-summary keep-loaded-panel-message";
          failureSummary.appendChild(failureLine("keep-loaded-panel-total", "Status unavailable"));
          failureSummary.appendChild(
            failureLine(
              "keep-loaded-panel-summary-line",
              "Keep Loaded couldn’t inspect tabs. Check the Browser Console for details.",
            ),
          );
          failureBody.replaceChildren(failureSummary);
          action.setAttribute("label", "Unavailable");
          action.setAttribute("disabled", "true");
          out.afterFailure = {
            action: action.getAttribute("label"),
            bodyChildren: failureBody.childElementCount,
            disabled: action.getAttribute("disabled"),
            lines: [...failureBody.querySelectorAll("label")].map(node => node.getAttribute("value")),
            rows: failureBody.querySelectorAll(".keep-loaded-row").length,
          };

          // A later open retries rather than making the error sticky.
          commandFired = 0;
          window.zenKeepLoaded.fillPanel(cachedView);
          out.afterRecovery = {
            action: action.getAttribute("label"),
            disabled: action.getAttribute("disabled"),
            heading: failureBody
              .querySelector(".keep-loaded-panel-total")
              ?.getAttribute("value"),
            rows: failureBody.querySelectorAll(".keep-loaded-row").length,
          };
          done(out);
        }, 700);
        return;
      } catch (error) {
        out.lateFailure = String(error);
        out.lateStack = String(error?.stack ?? "").split("\\n").slice(0, 3).join(" | ");
        done(out);
      }
    }, 1500);
  } catch (error) {
    out.failure = String(error);
    out.stack = String(error?.stack ?? "").split("\\n").slice(0, 4).join(" | ");
    done(out);
  }
`;

const main = async () => {
  const css = await readFile(new URL("../../styles/chrome.css", import.meta.url), "utf8");
  const zen = await launchZen();
  let client;
  try {
    client = await openMarionette({ port: zen.port });
    await client.setScriptTimeout(40_000);
    const result = await client.executeAsync(PROBE, [css, REPORT]);
    if (result?.geometry?.aligned !== true) {
      throw new Error(
        `panel content grid is not aligned: ${JSON.stringify(result?.geometry)}`,
      );
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`harness failed: ${error.message}`);
    console.error(zen.output.join("").slice(-2000));
    process.exitCode = 1;
  } finally {
    await client?.quit();
    await zen.stop();
  }
};

await main();
