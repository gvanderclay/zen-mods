/**
 * Reproduces the status panel outside the user's browser: a blank button and an empty
 * panel are both DOM questions, and the harness can answer them without a human
 * reading a console back (M05.C01 failed its manual test on both counts).
 *
 * It rebuilds exactly what `src/platform/panel.ts` builds — same markup, same widget
 * spec, same `window.zenKeepLoaded.fillPanel` indirection — then reports what the chrome
 * DOM actually did with it.
 *
 *     node tools/harness/probe-panel.mjs
 */

import { openMarionette } from "./marionette.mjs";
import { launchZen } from "./zen.mjs";

const PROBE = `
  const done = arguments[arguments.length - 1];
  const BUTTON_ID = "keep-loaded-button";
  const VIEW_ID = "keep-loaded-panelview";
  const BODY_ID = "keep-loaded-panel-body";
  const AREA = "zen-sidebar-foot-buttons";
  const VIEW_XUL = \`
    <panelview id="\${VIEW_ID}" class="PanelUI-subView keep-loaded-panelview">
      <vbox id="\${BODY_ID}" class="panel-subview-body"/>
    </panelview>
  \`;

  const report = { steps: [] };
  const step = (name, value) => { report.steps.push(name + ": " + value); };

  try {
    const cache = document.getElementById("appMenu-viewCache");
    step("viewCache", cache ? "found" : "MISSING");
    cache.content.appendChild(MozXULElement.parseXULToFragment(VIEW_XUL));
    step("viewInCache", Boolean(cache.content.querySelector("#" + VIEW_ID)));

    let fillCalls = 0;
    window.zenKeepLoaded = {
      fillPanel: body => {
        fillCalls++;
        // Same as renderPanelLines.
        body.textContent = "";
        for (const line of ["first line", "second line"]) {
          const label = body.ownerDocument.createXULElement("label");
          label.className = "keep-loaded-panel-line";
          label.setAttribute("value", line);
          body.appendChild(label);
        }
        report.bodyDoc = body.ownerDocument === document ? "main" : "OTHER";
      },
    };

    CustomizableUI.createWidget({
      id: BUTTON_ID,
      type: "view",
      viewId: VIEW_ID,
      localized: false,
      label: "Keep Loaded",
      tooltiptext: "Kept tabs",
      defaultArea: AREA,
      onViewShowing: event => {
        report.viewShowing = true;
        const view = event.target;
        const body = view.querySelector("#" + BODY_ID);
        report.bodyFound = Boolean(body);
        // Which link in the lookup chain is broken, rather than that one of them is.
        report.ownerGlobalType = typeof view.ownerGlobal;
        report.ownerGlobalIsWindow = view.ownerGlobal === window;
        report.ownerDocumentIsDocument = view.ownerDocument === document;
        report.stateOnOwnerGlobal = Boolean(view.ownerGlobal?.zenKeepLoaded);
        report.stateOnWindow = Boolean(window.zenKeepLoaded);
        report.stateOnChromeWindow = Boolean(
          Services.wm.getMostRecentWindow("navigator:browser")?.zenKeepLoaded
        );
        if (body) {
          try {
            // The fix under test: ownerGlobal is undefined here, ownerDocument is not.
            view.ownerDocument.defaultView?.zenKeepLoaded?.fillPanel?.(body);
          } catch (error) {
            report.fillFailure = String(error);
          }
        }
      },
    });

    // The icon rule the mod ships, injected here so the harness can confirm it resolves
    // rather than trusting that it will. The area is mode="icons", so a button with no
    // list-style-image draws an empty 29x29 box — which is what M05.C01 shipped.
    const ICON =
      "url(\\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4.6 7.2V5.4a3.4 3.4 0 0 1 6.8 0v1.8' fill='none' stroke='context-fill' stroke-width='2.1'/%3E%3Crect x='2.9' y='6.9' width='10.2' height='7.1' rx='1.6' fill='context-fill'/%3E%3C/svg%3E\\")";
    const sheet = document.createElementNS("http://www.w3.org/1999/xhtml", "style");
    sheet.textContent =
      "#" + BUTTON_ID + " { list-style-image: " + ICON +
      "; -moz-context-properties: fill, fill-opacity; fill: currentColor; }";
    document.documentElement.appendChild(sheet);

    const placement = CustomizableUI.getPlacementOfWidget(BUTTON_ID);
    step("placement", placement ? placement.area + " #" + placement.position : "NONE");

    const button = document.getElementById(BUTTON_ID);
    step("buttonNode", button ? "found" : "MISSING");
    if (button) {
      const style = window.getComputedStyle(button);
      const rect = button.getBoundingClientRect();
      report.button = {
        label: button.getAttribute("label"),
        listStyleImage: style.listStyleImage,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        // What the area's mode="icons" means for whether the label is drawn at all.
        parentMode: button.closest("toolbar")?.getAttribute("mode") ?? null,
      };
      const icon = button.querySelector(".toolbarbutton-icon");
      report.button.iconRect = icon
        ? Math.round(icon.getBoundingClientRect().width) +
          "x" +
          Math.round(icon.getBoundingClientRect().height)
        : "no .toolbarbutton-icon";
      const text = button.querySelector(".toolbarbutton-text");
      report.button.textVisible = text
        ? window.getComputedStyle(text).display !== "none"
        : "no .toolbarbutton-text";
    }

    PanelUI.showSubView(VIEW_ID, button);

    setTimeout(() => {
      try {
        report.fillCalls = fillCalls;
        const view = document.getElementById(VIEW_ID);
        report.viewInDocument = Boolean(view);
        const body = document.getElementById(BODY_ID);
        report.bodyInDocument = Boolean(body);
        if (body) {
          const rect = body.getBoundingClientRect();
          report.bodyRect = Math.round(rect.width) + "x" + Math.round(rect.height);
          report.bodyChildren = body.childElementCount;
          report.bodyText = body.textContent;
          const first = body.firstElementChild;
          if (first) {
            const style = window.getComputedStyle(first);
            const firstRect = first.getBoundingClientRect();
            report.firstLine = {
              tag: first.localName,
              namespace: first.namespaceURI?.includes("xul") ? "xul" : first.namespaceURI,
              value: first.getAttribute("value"),
              display: style.display,
              visibility: style.visibility,
              rect: Math.round(firstRect.width) + "x" + Math.round(firstRect.height),
            };
          }
        }
        if (view) {
          const viewRect = view.getBoundingClientRect();
          report.viewRect = Math.round(viewRect.width) + "x" + Math.round(viewRect.height);
        }
        done(report);
      } catch (error) {
        report.lateFailure = String(error);
        done(report);
      }
    }, 1500);
  } catch (error) {
    report.failure = String(error);
    report.stack = String(error?.stack ?? "").split("\\n").slice(0, 4).join(" | ");
    done(report);
  }
`;

const main = async () => {
  const zen = await launchZen();
  let client;
  try {
    client = await openMarionette({ port: zen.port });
    await client.setScriptTimeout(40_000);
    const result = await client.executeAsync(PROBE, []);
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
