import { describe, expect, it, vi } from "vitest";
import { installStatusPanel } from "./panel.ts";

describe("status panel action ownership", () => {
  it("hands the view to the controller without observing its return value", () => {
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
    const received: Element[] = [];
    const then = vi.fn();

    const dispose = installStatusPanel({
      onWake: target => {
        received.push(target);
        return { then };
      },
    });
    handlers.command?.({} as Event);

    expect(received).toEqual([view]);
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
});
