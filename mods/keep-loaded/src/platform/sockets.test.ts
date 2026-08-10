import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSocketWatchRegistry,
  socketRecordFor,
  stopWatchingSocket,
  stopWatchingSockets,
  useSocketWatchRegistry,
  watchSockets,
} from "./sockets.ts";

const SERVICE = "@mozilla.org/websocketevent/service;1";

describe("generation-guarded socket watching", () => {
  let listener: WebSocketEventListener | null;
  let removals: number;
  let service: WebSocketEventService;

  beforeEach(() => {
    useSocketWatchRegistry(createSocketWatchRegistry());
    listener = null;
    removals = 0;
    service = {
      addListener: (_id, next) => {
        listener = next;
      },
      removeListener: (_id, current) => {
        if (listener === current) {
          listener = null;
        }
        removals += 1;
      },
      hasListenerFor: () => listener !== null,
    };
    Object.assign(globalThis, {
      Cc: { [SERVICE]: { getService: () => service } },
      Ci: { nsIWebSocketEventService: {} },
    });
  });

  afterEach(() => {
    stopWatchingSockets();
  });

  it("makes a stopped generation's late listener callbacks inert", () => {
    const tab = {
      linkedPanel: "panel",
      linkedBrowser: { innerWindowID: 42 },
    } as BrowserTab;
    let live = true;

    watchSockets([tab], () => live);
    expect(listener).not.toBeNull();
    listener?.webSocketOpened();
    listener?.frameReceived();
    listener?.frameSent();
    expect(socketRecordFor(tab, "space", "https://example.test/")).toMatchObject({
      open: 1,
      framesIn: 1,
      framesOut: 1,
    });

    live = false;
    listener?.webSocketOpened();
    listener?.webSocketClosed();
    listener?.frameReceived();
    listener?.frameSent();

    expect(socketRecordFor(tab, "space", "https://example.test/")).toMatchObject({
      open: 1,
      framesIn: 1,
      framesOut: 1,
    });
  });

  it("does not acquire a listener for an already stopped generation", () => {
    const tab = {
      linkedPanel: "panel",
      linkedBrowser: { innerWindowID: 42 },
    } as BrowserTab;

    watchSockets([tab], () => false);

    expect(listener).toBeNull();
    expect(removals).toBe(0);
  });

  it("reuses stateless native callbacks across tab listeners", () => {
    const listeners: WebSocketEventListener[] = [];
    service.addListener = (_id, next) => {
      listeners.push(next);
      listener = next;
    };
    const first = {
      linkedPanel: "panel-a",
      linkedBrowser: { innerWindowID: 41 },
    } as BrowserTab;
    const second = {
      linkedPanel: "panel-b",
      linkedBrowser: { innerWindowID: 42 },
    } as BrowserTab;

    watchSockets([first, second], () => true);

    expect(listeners).toHaveLength(2);
    expect(listeners[0]?.webSocketCreated).toBe(listeners[1]?.webSocketCreated);
    expect(listeners[0]?.webSocketMessageAvailable).toBe(
      listeners[1]?.webSocketMessageAvailable,
    );
  });

  it("releases one tab's listener immediately when that tab is closed or unpinned", () => {
    const tab = {
      linkedPanel: "panel",
      linkedBrowser: { innerWindowID: 42 },
    } as BrowserTab;

    watchSockets([tab], () => true);
    expect(listener).not.toBeNull();

    stopWatchingSocket(tab);

    expect(listener).toBeNull();
    expect(removals).toBe(1);
    expect(socketRecordFor(tab, "space", "https://example.test/").watching).toBe(false);
    stopWatchingSocket(tab);
    expect(removals).toBe(1);
  });

  it("retains failed native removal ownership so a later cleanup can retry", () => {
    const tab = {
      linkedPanel: "panel",
      linkedBrowser: { innerWindowID: 42 },
    } as BrowserTab;
    let refuseRemoval = true;
    service.removeListener = (_id, current) => {
      removals += 1;
      if (refuseRemoval) {
        throw new Error("native listener removal refused");
      }
      if (listener === current) {
        listener = null;
      }
    };

    watchSockets([tab], () => true);
    stopWatchingSocket(tab);

    expect(listener).not.toBeNull();
    expect(socketRecordFor(tab, "space", "https://example.test/").watching).toBe(true);
    refuseRemoval = false;
    stopWatchingSocket(tab);

    expect(listener).toBeNull();
    expect(removals).toBe(2);
    expect(socketRecordFor(tab, "space", "https://example.test/").watching).toBe(false);
  });

  it("treats a listener-presence error as unresolved ownership instead of absence", () => {
    const tab = {
      linkedPanel: "panel",
      linkedBrowser: { innerWindowID: 42 },
    } as BrowserTab;
    let refuseInspection = false;
    service.hasListenerFor = () => {
      if (refuseInspection) {
        throw new Error("native listener inventory refused");
      }
      return listener !== null;
    };

    watchSockets([tab], () => true);
    refuseInspection = true;
    stopWatchingSocket(tab);

    expect(listener).not.toBeNull();
    expect(removals).toBe(0);
    expect(socketRecordFor(tab, "space", "https://example.test/").watching).toBe(true);

    refuseInspection = false;
    stopWatchingSocket(tab);
    expect(listener).toBeNull();
    expect(removals).toBe(1);
  });

  it("lets a replacement module remove and replace an unresolved old listener", async () => {
    const registry = createSocketWatchRegistry();
    useSocketWatchRegistry(registry);
    const tab = {
      linkedPanel: "panel",
      linkedBrowser: { innerWindowID: 42 },
    } as BrowserTab;
    let refuseRemoval = true;
    service.removeListener = (_id, current) => {
      removals += 1;
      if (refuseRemoval) {
        throw new Error("native listener removal refused");
      }
      if (listener === current) {
        listener = null;
      }
    };

    watchSockets([tab], () => true);
    stopWatchingSocket(tab);
    expect(listener).not.toBeNull();

    vi.resetModules();
    const replacement = await import("./sockets.ts");
    replacement.useSocketWatchRegistry(registry);
    refuseRemoval = false;
    let replacementLive = true;
    replacement.watchSockets([tab], () => replacementLive);

    expect(listener).not.toBeNull();
    expect(removals).toBe(2);
    listener?.frameReceived();
    expect(
      replacement.socketRecordFor(tab, "space", "https://example.test/"),
    ).toMatchObject({
      framesIn: 1,
      watching: true,
    });

    // A retained old disposer cannot remove the replacement's exact listener.
    stopWatchingSocket(tab);
    expect(listener).not.toBeNull();

    replacementLive = false;
    replacement.stopWatchingSocket(tab);
    expect(listener).toBeNull();
  });
});
