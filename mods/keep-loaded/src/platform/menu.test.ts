import { describe, expect, it, vi } from "vitest";
import { installKeepMenuItem } from "./menu.ts";

describe("keep-menu generation ownership", () => {
  it("makes retained popup and command callbacks inert after their generation stops", () => {
    let live = true;
    let inserted = false;
    let showing: EventListener | null = null;
    let command: EventListener | null = null;
    const hiddenWrites: boolean[] = [];
    const setAttribute = vi.fn();
    const removeAttribute = vi.fn();
    const item = {
      addEventListener: (type: string, listener: EventListener) => {
        if (type === "command") {
          command = listener;
        }
      },
      removeEventListener: vi.fn(),
      remove: () => {
        inserted = false;
      },
      set hidden(value: boolean) {
        hiddenWrites.push(value);
      },
      setAttribute,
      removeAttribute,
    };
    const menu = {
      addEventListener: (type: string, listener: EventListener) => {
        if (type === "popupshowing") {
          showing = listener;
        }
      },
      appendChild: () => {
        inserted = true;
      },
      removeEventListener: vi.fn(),
    };
    const document = {
      getElementById: (id: string) => {
        if (id === "tabContextMenu") {
          return menu;
        }
        if (id === "keep-loaded-context-item") {
          return inserted ? item : null;
        }
        return null;
      },
    };
    const tab = { pinned: true } as BrowserTab;
    Object.assign(globalThis, {
      TabContextMenu: { contextTab: tab },
      window: {
        MozXULElement: { parseXULToFragment: () => ({}) },
        document,
      },
    });
    const state = vi.fn(() => {
      live = false;
      return { checked: true, disabled: false, label: "Stop keeping loaded" };
    });
    const toggle = vi.fn();

    const dispatch = (listener: EventListener | null, event: Event) => {
      if (!listener) {
        throw new Error("expected listener to be installed");
      }
      listener(event);
    };
    const dispose = installKeepMenuItem(() => live, state, toggle);
    dispatch(showing, { target: menu } as unknown as Event);
    dispatch(command, {} as Event);

    expect(state).toHaveBeenCalledOnce();
    expect(hiddenWrites).toEqual([]);
    expect(setAttribute).not.toHaveBeenCalled();
    expect(removeAttribute).not.toHaveBeenCalled();
    expect(toggle).not.toHaveBeenCalled();

    dispose();
    dispatch(showing, { target: menu } as unknown as Event);
    dispatch(command, {} as Event);
    expect(state).toHaveBeenCalledOnce();
    expect(toggle).not.toHaveBeenCalled();
  });

  it("does not touch the chrome DOM when installation starts stopped", () => {
    const getElementById = vi.fn();
    Object.assign(globalThis, {
      window: { document: { getElementById }, MozXULElement: {} },
    });

    const dispose = installKeepMenuItem(
      () => false,
      () => ({ checked: false, disabled: false, label: "Keep loaded" }),
      () => {},
    );

    expect(getElementById).not.toHaveBeenCalled();
    expect(dispose).toBeTypeOf("function");
  });
});
