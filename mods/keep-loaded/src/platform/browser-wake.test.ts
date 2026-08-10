import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionStore = {
  promiseAllWindowsRestored: Promise.resolve(),
  resetBrowserToLazyState: vi.fn(),
};

const tab = ({
  connected = true,
  panel = null,
  pending = true,
}: {
  connected?: boolean;
  panel?: string | null;
  pending?: boolean;
} = {}) =>
  ({
    isConnected: connected,
    linkedPanel: panel,
    hasAttribute: (name: string) => name === "pending" && pending,
  }) as BrowserTab;

beforeEach(() => {
  vi.resetModules();
  sessionStore.resetBrowserToLazyState = vi.fn();
  vi.stubGlobal("ChromeUtils", {
    importESModule: vi.fn(() => ({ SessionStore: sessionStore })),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("wake candidate browser adapter", () => {
  it("classifies disconnected, started, inserted-pending, and lazy tabs", async () => {
    vi.stubGlobal("window", { closed: false, gBrowser: {} });
    const { wakeCandidateState } = await import("./browser.ts");

    expect(wakeCandidateState(tab({ connected: false, pending: false }))).toBe("gone");
    expect(wakeCandidateState(tab({ pending: false }))).toBe("started");
    expect(wakeCandidateState(tab({ panel: "panel" }))).toBe("inserted-pending");
    expect(wakeCandidateState(tab())).toBe("lazy");

    Object.assign(window, { closed: true });
    expect(wakeCandidateState(tab({ panel: "panel" }))).toBe("inserted-pending");
  });

  it("rolls back a connected candidate synchronously during native window unload", async () => {
    const candidate = {
      isConnected: true,
      linkedPanel: "panel",
      hasAttribute: (name: string) => name === "pending",
    } as unknown as BrowserTab;
    const discardBrowser = vi.fn(() => true);
    vi.stubGlobal("window", { closed: true, gBrowser: { discardBrowser } });
    const { rollbackWakeCandidate, wakeCandidateState } = await import("./browser.ts");

    expect(rollbackWakeCandidate(candidate)).toBe(true);
    expect(sessionStore.resetBrowserToLazyState).toHaveBeenCalledWith(candidate);
    expect(discardBrowser).not.toHaveBeenCalled();
    expect(wakeCandidateState(candidate)).toBe("gone");
  });

  it("treats candidates that are already safe as successful idempotent rollbacks", async () => {
    const discardBrowser = vi.fn();
    vi.stubGlobal("window", {
      closed: false,
      gBrowser: { discardBrowser },
    });
    const { rollbackWakeCandidate } = await import("./browser.ts");

    expect(rollbackWakeCandidate(tab({ connected: false }))).toBe(true);
    expect(rollbackWakeCandidate(tab({ pending: false }))).toBe(true);
    expect(rollbackWakeCandidate(tab())).toBe(true);
    expect(discardBrowser).not.toHaveBeenCalled();
  });

  it("force-discards only an inserted pending browser and verifies the safe result", async () => {
    let panel: string | null = "panel";
    const candidate = {
      isConnected: true,
      get linkedPanel() {
        return panel;
      },
      hasAttribute: (name: string) => name === "pending",
    } as unknown as BrowserTab;
    const discardBrowser = vi.fn(() => {
      panel = null;
      return true;
    });
    vi.stubGlobal("window", {
      closed: false,
      gBrowser: { discardBrowser },
    });
    const { rollbackWakeCandidate } = await import("./browser.ts");

    expect(rollbackWakeCandidate(candidate)).toBe(true);
    expect(discardBrowser).toHaveBeenCalledOnce();
    expect(discardBrowser).toHaveBeenCalledWith(candidate, true);
  });

  it("accepts a terminal post-discard state even when discardBrowser reports false", async () => {
    let pending = true;
    const candidate = {
      isConnected: true,
      linkedPanel: "panel",
      hasAttribute: (name: string) => name === "pending" && pending,
    } as unknown as BrowserTab;
    const discardBrowser = vi.fn(() => {
      pending = false;
      return false;
    });
    vi.stubGlobal("window", {
      closed: false,
      gBrowser: { discardBrowser },
    });
    const { rollbackWakeCandidate } = await import("./browser.ts");

    expect(rollbackWakeCandidate(candidate)).toBe(true);
    expect(discardBrowser).toHaveBeenCalledOnce();
  });

  it("reports rollback failure while an inserted pending browser remains", async () => {
    const candidate = tab({ panel: "panel" });
    const discardBrowser = vi.fn(() => true);
    vi.stubGlobal("window", {
      closed: false,
      gBrowser: { discardBrowser },
    });
    const { rollbackWakeCandidate } = await import("./browser.ts");

    expect(rollbackWakeCandidate(candidate)).toBe(false);
    expect(discardBrowser).toHaveBeenCalledOnce();
  });

  it("reports a docshell write that does not reach the requested state", async () => {
    vi.stubGlobal("window", { closed: false, gBrowser: {} });
    const { setDocShellActive } = await import("./browser.ts");
    const candidate = {
      isConnected: true,
      linkedPanel: "panel",
      linkedBrowser: {
        get docShellIsActive() {
          return true;
        },
        set docShellIsActive(_value: boolean) {},
      },
    } as unknown as BrowserTab;

    expect(setDocShellActive(candidate, false)).toBe(false);
  });
});
