import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  socketRecordFor,
  stopWatchingSocket,
  stopWatchingSockets,
  watchSockets,
} from "./sockets.ts";

const SERVICE = "@mozilla.org/websocketevent/service;1";

describe("generation-guarded socket watching", () => {
  let listener: WebSocketEventListener | null;
  let removals: number;
  let service: WebSocketEventService;

  beforeEach(() => {
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
});
