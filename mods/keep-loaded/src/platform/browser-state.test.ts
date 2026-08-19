import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionStore = {
  getCustomTabValue: vi.fn(),
  setCustomTabValue: vi.fn(),
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("ChromeUtils", {
    importESModule: vi.fn(() => ({ SessionStore: sessionStore })),
  });
  vi.stubGlobal("window", { closed: false, gBrowser: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("same-value browser state writes", () => {
  it("does not rewrite a matching persistent keep flag", async () => {
    sessionStore.getCustomTabValue.mockReturnValue("true");
    const { setFlag } = await import("./browser.ts");
    const tab = {} as BrowserTab;

    setFlag(tab, true);

    expect(sessionStore.setCustomTabValue).not.toHaveBeenCalled();
  });

  it("writes a changed persistent keep flag exactly once", async () => {
    sessionStore.getCustomTabValue.mockReturnValue("false");
    const { setFlag } = await import("./browser.ts");
    const tab = {} as BrowserTab;

    setFlag(tab, true);

    expect(sessionStore.setCustomTabValue).toHaveBeenCalledOnce();
    expect(sessionStore.setCustomTabValue).toHaveBeenCalledWith(
      tab,
      "zenKeepLoaded",
      "true",
    );
  });

  it("does not rewrite or remove an already-matching marker", async () => {
    const { setMarker } = await import("./browser.ts");
    const setAttribute = vi.fn();
    const removeAttribute = vi.fn();
    const marked = {
      getAttribute: () => "true",
      setAttribute,
      removeAttribute,
    } as unknown as BrowserTab;
    const clear = {
      getAttribute: () => null,
      setAttribute,
      removeAttribute,
    } as unknown as BrowserTab;

    setMarker(marked, true);
    setMarker(clear, false);

    expect(setAttribute).not.toHaveBeenCalled();
    expect(removeAttribute).not.toHaveBeenCalled();
  });

  it("applies a changed marker state exactly once", async () => {
    const { setMarker } = await import("./browser.ts");
    const setAttribute = vi.fn();
    const removeAttribute = vi.fn();
    const tab = {
      getAttribute: () => null,
      setAttribute,
      removeAttribute,
    } as unknown as BrowserTab;

    setMarker(tab, true);

    expect(setAttribute).toHaveBeenCalledOnce();
    expect(setAttribute).toHaveBeenCalledWith("zen-keep-loaded", "true");
    expect(removeAttribute).not.toHaveBeenCalled();
  });

  it("does not rewrite an already-undiscardable tab", async () => {
    const { markUndiscardable } = await import("./browser.ts");
    const write = vi.fn();
    const tab = {
      get undiscardable() {
        return true;
      },
      set undiscardable(value: boolean) {
        write(value);
      },
    } as BrowserTab;

    markUndiscardable(tab);

    expect(write).not.toHaveBeenCalled();
  });

  it("marks a discardable tab exactly once", async () => {
    const { markUndiscardable } = await import("./browser.ts");
    const write = vi.fn();
    const tab = {
      get undiscardable() {
        return false;
      },
      set undiscardable(value: boolean) {
        write(value);
      },
    } as BrowserTab;

    markUndiscardable(tab);

    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(true);
  });

  it("does not rewrite a docshell already in the requested state", async () => {
    const { setDocShellActive } = await import("./docshell.ts");
    const write = vi.fn();
    const tab = {
      isConnected: true,
      linkedPanel: "panel",
      linkedBrowser: {
        browsingContext: {},
        get docShellIsActive() {
          return true;
        },
        set docShellIsActive(value: boolean) {
          write(value);
        },
      },
    } as unknown as BrowserTab;

    expect(setDocShellActive(tab, true)).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });

  it("writes and verifies a changed docshell state exactly once", async () => {
    const { setDocShellActive } = await import("./docshell.ts");
    let active = false;
    const write = vi.fn((value: boolean) => {
      active = value;
    });
    const tab = {
      isConnected: true,
      linkedPanel: "panel",
      linkedBrowser: {
        get docShellIsActive() {
          return active;
        },
        set docShellIsActive(value: boolean) {
          write(value);
        },
      },
    } as unknown as BrowserTab;

    expect(setDocShellActive(tab, true)).toBe(true);
    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(true);
  });
});
