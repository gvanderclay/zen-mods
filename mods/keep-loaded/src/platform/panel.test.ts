import { describe, expect, it, vi } from "vitest";
import type {
  StatusWidgetHost,
  StatusWidgetViewShowing,
} from "../application-coordinator.ts";
import type { PanelPresentation } from "../core/panel-presentation.ts";
import { installStatusPanel, renderPanelPresentation } from "./panel.ts";

interface RenderNode {
  attributes: Map<string, string>;
  children: RenderNode[];
  className: string;
  ownerDocument: Document;
  addEventListener(type: string, listener: EventListener): void;
  appendChild(child: RenderNode): RenderNode;
  removeAttribute(name: string): void;
  replaceChildren(...children: RenderNode[]): void;
  setAttribute(name: string, value: string): void;
}

const renderHarness = () => {
  let document: Document;
  const node = (): RenderNode => ({
    attributes: new Map(),
    children: [],
    className: "",
    ownerDocument: document,
    addEventListener: () => {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    removeAttribute(name) {
      this.attributes.delete(name);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
  });
  document = { createXULElement: () => node() } as unknown as Document;
  const body = node();
  const button = node();
  const reset = node();
  const feedback = node();
  const view = {
    querySelector: (selector: string) => {
      if (selector === "#keep-loaded-panel-body") {
        return body;
      }
      if (selector === "#keep-loaded-wake-button") {
        return button;
      }
      if (selector === "#keep-loaded-reset-button") {
        return reset;
      }
      if (selector === "#keep-loaded-panel-feedback") {
        return feedback;
      }
      return null;
    },
    setAttribute: vi.fn(),
  } as unknown as Element;
  return { body, button, feedback, reset, view };
};

const descendants = (node: RenderNode): RenderNode[] => [
  ...node.children,
  ...node.children.flatMap(descendants),
];

describe("status panel presentation rendering", () => {
  it("publishes loading before handing the view to runtime code", () => {
    const { body, button, view } = renderHarness();
    let installed = false;
    const document = body.ownerDocument;
    const content = {
      appendChild: () => {
        installed = true;
      },
      querySelector: (selector: string) =>
        installed && selector === "#keep-loaded-panelview" ? view : null,
    };
    (
      document as unknown as {
        getElementById(id: string): unknown;
      }
    ).getElementById = (id: string) => (id === "appMenu-viewCache" ? { content } : null);
    Object.assign(view, {
      ownerDocument: document,
      remove: vi.fn(() => {
        installed = false;
      }),
    });
    Object.assign(globalThis, {
      window: {
        CustomizableUI: {
          PROVIDER_API: "api",
          destroyWidget: vi.fn(),
          getWidget: () => ({ provider: "api" }),
        },
        MozXULElement: { parseXULToFragment: () => ({}) },
        document,
      },
    });
    const onViewReady = vi.fn(() => {
      expect(
        descendants(body)
          .map(child => child.attributes.get("value"))
          .filter(Boolean),
      ).toEqual(["Checking kept tabs…"]);
      expect(button.attributes.get("label")).toBe("Checking…");
      expect(button.attributes.get("disabled")).toBe("true");
    });

    const dispose = installStatusPanel({ onViewReady, onWake: () => {} });

    expect(onViewReady).toHaveBeenCalledOnce();
    dispose();
  });

  it("replaces a prior report and enabled action with the complete unavailable state", () => {
    const { body, button, view } = renderHarness();
    const ready: PanelPresentation = {
      action: { disabled: false, label: "Wake 1 sleeping tab", visible: true },
      content: {
        kind: "report",
        report: {
          groups: [
            {
              rows: [
                {
                  detail: "was unloaded just now",
                  state: "asleep",
                  stateLabel: "Sleeping",
                  title: "mail.example.test",
                  url: "https://mail.example.test/",
                },
              ],
              space: "Work",
            },
          ],
          summary: "1 sleeping",
          total: "1 kept tab",
        },
      },
      feedback: null,
      kind: "ready",
      reset: {
        disabled: true,
        label: "Reset crash recovery history",
        visible: false,
      },
    };
    const unavailable: PanelPresentation = {
      action: { disabled: true, label: "Unavailable", visible: true },
      content: {
        kind: "lines",
        lines: ["Status unavailable", "Check the Browser Console for details."],
      },
      feedback: null,
      kind: "unavailable",
      reset: {
        disabled: true,
        label: "Reset crash recovery history",
        visible: false,
      },
    };

    expect(renderPanelPresentation(view, ready)).toBe(true);
    expect(descendants(body).some(child => child.className === "keep-loaded-row")).toBe(
      true,
    );
    expect(button.attributes.get("label")).toBe("Wake 1 sleeping tab");
    expect(button.attributes.has("disabled")).toBe(false);

    expect(renderPanelPresentation(view, unavailable)).toBe(true);
    expect(
      descendants(body)
        .map(child => child.attributes.get("value"))
        .filter(Boolean),
    ).toEqual(["Status unavailable", "Check the Browser Console for details."]);
    expect(descendants(body).some(child => child.className === "keep-loaded-row")).toBe(
      false,
    );
    expect(button.attributes.get("label")).toBe("Unavailable");
    expect(button.attributes.get("disabled")).toBe("true");
  });

  it("publishes crash-history reset and exact Zen-session feedback as one state", () => {
    const { button, feedback, reset, view } = renderHarness();
    const state: PanelPresentation = {
      action: { disabled: true, label: "", visible: false },
      content: {
        kind: "report",
        report: {
          groups: [],
          summary: "Add sites in Sine settings.",
          total: "Keep a pinned tab awake",
        },
      },
      feedback: "Crash recovery history reset for this Zen session",
      kind: "empty",
      reset: {
        disabled: false,
        label: "Reset crash recovery history",
        visible: true,
      },
    };

    expect(renderPanelPresentation(view, state)).toBe(true);
    expect(button.attributes.has("hidden")).toBe(true);
    expect(reset.attributes.get("label")).toBe("Reset crash recovery history");
    expect(reset.attributes.has("hidden")).toBe(false);
    expect(reset.attributes.has("disabled")).toBe(false);
    expect(feedback.attributes.get("value")).toBe(
      "Crash recovery history reset for this Zen session",
    );
    expect(feedback.attributes.has("hidden")).toBe(false);
  });

  it("leaves the current nodes untouched for a stopped generation", () => {
    const { body, button, view } = renderHarness();
    const old = body.appendChild(
      body.ownerDocument.createXULElement("label") as unknown as RenderNode,
    );
    button.setAttribute("label", "Current generation");

    expect(renderPanelPresentation(view, { kind: "stopped" })).toBe(false);
    expect(body.children).toEqual([old]);
    expect(button.attributes.get("label")).toBe("Current generation");
  });
});

describe("status panel action ownership", () => {
  it("hands the view to the controller without observing its return value", () => {
    let installed = false;
    const handlers: { reset: EventListener | null; wake: EventListener | null } = {
      reset: null,
      wake: null,
    };
    const button = (kind: "reset" | "wake") => ({
      addEventListener: (type: string, listener: EventListener) => {
        if (type === "command") {
          handlers[kind] = listener;
        }
      },
    });
    const wakeButton = button("wake");
    const resetButton = button("reset");
    const view = {
      ownerDocument: null as Document | null,
      querySelector: (selector: string) => {
        if (selector === "#keep-loaded-wake-button") {
          return wakeButton;
        }
        if (selector === "#keep-loaded-reset-button") {
          return resetButton;
        }
        return null;
      },
      remove: () => {
        installed = false;
      },
    };
    const content = {
      appendChild: () => {
        installed = true;
      },
      querySelector: (selector: string) =>
        installed && selector === "#keep-loaded-panelview" ? view : null,
    };
    const cache = { content };
    const document = {
      defaultView: null,
      getElementById: (id: string) => (id === "appMenu-viewCache" ? cache : null),
    };
    view.ownerDocument = document as unknown as Document;
    const ui = {
      PROVIDER_API: "api",
      destroyWidget: vi.fn(),
      getWidget: () => ({ provider: "api" }),
    };
    Object.assign(globalThis, {
      window: {
        CustomizableUI: ui,
        MozXULElement: { parseXULToFragment: () => ({}) },
        document,
      },
    });
    const received: string[] = [];
    const then = vi.fn();

    const dispose = installStatusPanel({
      onWake: target => {
        received.push(target === view ? "wake" : "wrong");
        return { then };
      },
      onReset: target => {
        received.push(target === view ? "reset" : "wrong");
      },
    });
    handlers.wake?.({} as Event);
    handlers.reset?.({} as Event);

    expect(received).toEqual(["wake", "reset"]);
    expect(then).not.toHaveBeenCalled();

    dispose();
    expect(ui.destroyWidget).toHaveBeenCalledWith("keep-loaded-button");
    expect(installed).toBe(false);
  });

  it("can remove one closing window's view without destroying the shared widget", () => {
    const ui = {
      PROVIDER_API: "api",
      destroyWidget: vi.fn(),
      getWidget: () => ({ provider: "api" }),
    };
    const makeWindow = () => {
      let installed = false;
      const view = {
        ownerDocument: null as Document | null,
        querySelector: () => null,
        remove: () => {
          installed = false;
        },
      };
      const content = {
        appendChild: () => {
          installed = true;
        },
        querySelector: (selector: string) =>
          installed && selector === "#keep-loaded-panelview" ? view : null,
      };
      const cache = { content };
      const document = {
        defaultView: null,
        getElementById: (id: string) => (id === "appMenu-viewCache" ? cache : null),
      };
      view.ownerDocument = document as unknown as Document;
      return {
        installed: () => installed,
        value: {
          CustomizableUI: ui,
          MozXULElement: { parseXULToFragment: () => ({}) },
          document,
        },
      };
    };
    const a = makeWindow();
    const b = makeWindow();

    Object.assign(globalThis, { window: a.value });
    const disposeA = installStatusPanel({ onWake: () => {} });
    Object.assign(globalThis, { window: b.value });
    const disposeB = installStatusPanel({ onWake: () => {} });

    disposeB("window");
    expect(b.installed()).toBe(false);
    expect(a.installed()).toBe(true);
    expect(ui.destroyWidget).not.toHaveBeenCalled();

    disposeA("application");
    expect(a.installed()).toBe(false);
    expect(ui.destroyWidget).toHaveBeenCalledOnce();
    expect(ui.destroyWidget).toHaveBeenCalledWith("keep-loaded-button");
  });

  it("does not let a stale disposer remove the replacement view in its window", () => {
    const ui = {
      PROVIDER_API: "api",
      destroyWidget: vi.fn(),
      getWidget: () => ({ provider: "api" }),
    };
    const views: Array<{
      ownerDocument: Document;
      querySelector: () => null;
      remove: ReturnType<typeof vi.fn>;
    }> = [];
    let current: (typeof views)[number] | null = null;
    let document: Document;
    const content = {
      appendChild: () => {
        const view = {
          ownerDocument: document,
          querySelector: () => null,
          remove: vi.fn(() => {
            if (current === view) {
              current = null;
            }
          }),
        };
        views.push(view);
        current = view;
      },
      querySelector: (selector: string) =>
        selector === "#keep-loaded-panelview" ? current : null,
    };
    const cache = { content };
    document = {
      defaultView: null,
      getElementById: (id: string) => {
        if (id === "appMenu-viewCache") {
          return cache;
        }
        if (id === "keep-loaded-panelview") {
          return current;
        }
        return null;
      },
    } as unknown as Document;
    Object.assign(globalThis, {
      window: {
        CustomizableUI: ui,
        MozXULElement: { parseXULToFragment: () => ({}) },
        document,
      },
    });

    const disposeOld = installStatusPanel({ onWake: () => {} });
    const oldView: (typeof views)[number] | null = current;
    const disposeReplacement = installStatusPanel({ onWake: () => {} });
    const replacementView: (typeof views)[number] | null = current;

    expect(oldView).not.toBeNull();
    expect(replacementView).not.toBeNull();
    expect(replacementView).not.toBe(oldView);

    disposeOld("window");

    expect(current).toBe(replacementView);
    const replacement = views.at(-1);
    if (!replacement) {
      throw new Error("replacement view was not captured");
    }
    expect(replacement.remove).not.toHaveBeenCalled();

    disposeReplacement("window");
  });

  it("makes retained command and view callbacks inert after its panel is disposed", () => {
    let installed = false;
    const handlers: { command: EventListener | null } = { command: null };
    const button = {
      addEventListener: (type: string, listener: EventListener) => {
        if (type === "command") {
          handlers.command = listener;
        }
      },
    };
    const view = {
      ownerDocument: null as Document | null,
      querySelector: (selector: string) =>
        selector === "#keep-loaded-wake-button" ? button : null,
      remove: () => {
        installed = false;
      },
    };
    const content = {
      appendChild: () => {
        installed = true;
      },
      querySelector: (selector: string) =>
        installed && selector === "#keep-loaded-panelview" ? view : null,
    };
    const cache = { content };
    const document = {
      defaultView: null,
      getElementById: (id: string) => (id === "appMenu-viewCache" ? cache : null),
    };
    view.ownerDocument = document as unknown as Document;
    const captured = { host: null as StatusWidgetHost | null };
    const physicalCallback = { current: null as StatusWidgetViewShowing | null };
    const ui = {
      PROVIDER_API: "api",
      createWidget: vi.fn((spec: { onViewShowing: StatusWidgetViewShowing }) => {
        physicalCallback.current = spec.onViewShowing;
      }),
      destroyWidget: vi.fn(),
      getWidget: () => null,
    };
    const release = vi.fn(() => {
      captured.host = null;
      return true;
    });
    const widgetOwner = {
      acquireStatusWidget: vi.fn((candidate: StatusWidgetHost) => {
        captured.host = candidate;
        candidate.create(event => {
          captured.host?.show(event);
        });
        return { release };
      }),
    };
    Object.assign(globalThis, {
      window: {
        CustomizableUI: ui,
        MozXULElement: { parseXULToFragment: () => ({}) },
        document,
      },
    });
    const shown = vi.fn();
    const woken = vi.fn();
    const dispose = installStatusPanel({
      isLive: () => true,
      onViewShowing: shown,
      onWake: woken,
      widgetOwner,
    });
    const host = captured.host;
    if (!host) {
      throw new Error("widget host was not captured");
    }
    const onViewShowing = physicalCallback.current;
    if (!onViewShowing) {
      throw new Error("physical widget callback was not captured");
    }

    onViewShowing({ target: {} as Element });
    handlers.command?.({} as Event);
    onViewShowing({ target: view as unknown as Element });
    expect(woken).toHaveBeenCalledOnce();
    expect(shown).toHaveBeenCalledOnce();

    dispose();
    handlers.command?.({} as Event);
    onViewShowing({ target: view as unknown as Element });
    expect(woken).toHaveBeenCalledOnce();
    expect(shown).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("removes its view and partial widget if first creation throws", () => {
    let installed = false;
    const view = {
      ownerDocument: null as Document | null,
      querySelector: () => null,
      remove: () => {
        installed = false;
      },
    };
    const content = {
      appendChild: () => {
        installed = true;
      },
      querySelector: (selector: string) =>
        installed && selector === "#keep-loaded-panelview" ? view : null,
    };
    const cache = { content };
    const document = {
      defaultView: null,
      getElementById: (id: string) => (id === "appMenu-viewCache" ? cache : null),
    };
    view.ownerDocument = document as unknown as Document;
    const ui = {
      PROVIDER_API: "api",
      createWidget: vi.fn(() => {
        throw new Error("create failed");
      }),
      destroyWidget: vi.fn(),
      getWidget: () => null,
    };
    const widgetOwner = {
      acquireStatusWidget: (host: StatusWidgetHost) => {
        host.create(() => {});
        return { release: vi.fn() };
      },
    };
    Object.assign(globalThis, {
      window: {
        CustomizableUI: ui,
        MozXULElement: { parseXULToFragment: () => ({}) },
        document,
      },
    });

    expect(() => installStatusPanel({ onWake: () => {}, widgetOwner })).toThrow(
      "create failed",
    );
    expect(installed).toBe(false);
    expect(ui.destroyWidget).toHaveBeenCalledWith("keep-loaded-button");
  });

  it("cleans up its own panel when widget creation makes its generation terminal", () => {
    let installed = false;
    let live = true;
    const view = {
      ownerDocument: null as Document | null,
      querySelector: () => null,
      remove: vi.fn(() => {
        installed = false;
      }),
    };
    const content = {
      appendChild: () => {
        installed = true;
      },
      querySelector: (selector: string) =>
        installed && selector === "#keep-loaded-panelview" ? view : null,
    };
    const cache = { content };
    const document = {
      defaultView: null,
      getElementById: (id: string) => (id === "appMenu-viewCache" ? cache : null),
    };
    view.ownerDocument = document as unknown as Document;
    const ui = {
      PROVIDER_API: "api",
      createWidget: vi.fn(),
      destroyWidget: vi.fn(),
      getWidget: () => null,
    };
    const release = vi.fn();
    const widgetOwner = {
      acquireStatusWidget: (host: StatusWidgetHost) => {
        host.create(() => {});
        live = false;
        return { release };
      },
    };
    Object.assign(globalThis, {
      window: {
        CustomizableUI: ui,
        MozXULElement: { parseXULToFragment: () => ({}) },
        document,
      },
    });

    installStatusPanel({
      isLive: () => live,
      onWake: () => {},
      widgetOwner,
    });

    expect(release).toHaveBeenCalledOnce();
    expect(view.remove).toHaveBeenCalledOnce();
    expect(installed).toBe(false);
  });

  it("lets the owner remove a widget after creation makes its generation terminal", () => {
    let installed = false;
    let live = true;
    const view = {
      ownerDocument: null as Document | null,
      querySelector: () => null,
      remove: vi.fn(() => {
        installed = false;
      }),
    };
    const content = {
      appendChild: () => {
        installed = true;
      },
      querySelector: (selector: string) =>
        installed && selector === "#keep-loaded-panelview" ? view : null,
    };
    const cache = { content };
    const document = {
      defaultView: null,
      getElementById: (id: string) => (id === "appMenu-viewCache" ? cache : null),
    };
    view.ownerDocument = document as unknown as Document;
    const ui = {
      PROVIDER_API: "api",
      createWidget: vi.fn(() => {
        // CustomizableUI can synchronously cause this generation to stop while the
        // application owner is still completing its `creating` edge.
        live = false;
      }),
      destroyWidget: vi.fn(),
      getWidget: () => null,
    };
    const captured = { host: null as StatusWidgetHost | null };
    const release = vi.fn(() => false);
    const widgetOwner = {
      acquireStatusWidget: (host: StatusWidgetHost) => {
        captured.host = host;
        host.create(() => {});
        return { release };
      },
    };
    Object.assign(globalThis, {
      window: {
        CustomizableUI: ui,
        MozXULElement: { parseXULToFragment: () => ({}) },
        document,
      },
    });

    installStatusPanel({ isLive: () => live, onWake: () => {}, widgetOwner });
    const host = captured.host;
    if (!host) {
      throw new Error("terminal owner host was not captured");
    }

    // The panel has synchronously released its lease and made its local disposer
    // terminal. The owner then finishes the creating edge and must still be able to
    // remove the physical widget through its dedicated host adapter.
    expect(release).toHaveBeenCalledOnce();
    expect(view.remove).toHaveBeenCalledOnce();
    expect(ui.createWidget).toHaveBeenCalledOnce();
    expect(ui.destroyWidget).not.toHaveBeenCalled();
    host.destroy();

    expect(ui.destroyWidget).toHaveBeenCalledOnce();
  });

  it("hands widget lifetime to the application owner when one is supplied", () => {
    let installed = false;
    const view = {
      ownerDocument: null as Document | null,
      querySelector: () => null,
      remove: () => {
        installed = false;
      },
    };
    const content = {
      appendChild: () => {
        installed = true;
      },
      querySelector: (selector: string) =>
        installed && selector === "#keep-loaded-panelview" ? view : null,
    };
    const cache = { content };
    const document = {
      defaultView: null,
      getElementById: (id: string) => (id === "appMenu-viewCache" ? cache : null),
    };
    view.ownerDocument = document as unknown as Document;
    const ui = {
      PROVIDER_API: "api",
      destroyWidget: vi.fn(),
      getWidget: () => null,
      createWidget: vi.fn(),
    };
    const release = vi.fn();
    let receivedHost: StatusWidgetHost | null = null;
    const widgetOwner = {
      acquireStatusWidget: vi.fn((host: StatusWidgetHost) => {
        receivedHost = host;
        host.create(() => {});
        return { release };
      }),
    };
    Object.assign(globalThis, {
      window: {
        CustomizableUI: ui,
        MozXULElement: { parseXULToFragment: () => ({}) },
        document,
      },
    });

    const dispose = installStatusPanel({ onWake: () => {}, widgetOwner });

    expect(widgetOwner.acquireStatusWidget).toHaveBeenCalledOnce();
    expect(receivedHost).not.toBeNull();
    expect(ui.createWidget).toHaveBeenCalledOnce();
    expect(ui.destroyWidget).not.toHaveBeenCalled();

    dispose("window");

    expect(release).toHaveBeenCalledOnce();
    expect(ui.destroyWidget).not.toHaveBeenCalled();
  });
});
