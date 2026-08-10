/**
 * Watches a kept tab's websockets through `nsIWebSocketEventService`. Privileged, and
 * measured rather than inferred: devtools attaches from the *content* process
 * (`resources/websockets.js` 43 reads `window.windowGlobalChild`) and nothing in the
 * tree attaches from the parent, so M04.C04a-D proved by experiment that frames reach
 * a parent-process listener anyway — `tools/harness/probe-sockets.mjs`, see D020.
 */

import type { Probe } from "../core/capabilities.ts";
import type { SocketRecord } from "../core/sockets.ts";

const SERVICE = "@mozilla.org/websocketevent/service;1";

const service = () => {
  try {
    return Cc[SERVICE]?.getService<WebSocketEventService>(Ci.nsIWebSocketEventService);
  } catch {
    return undefined;
  }
};

/**
 * Whether the service still holds our listener. It drops them itself when the window
 * goes away (`websockets.js` 75 warns about the same case), so this is the difference
 * between "watching" and "was watching once" — a distinction the whole readout turns
 * on, since a dead listener and a silent socket both show zero frames.
 */
const listeningState = (id: number): boolean | null => {
  try {
    const current = service();
    return current ? Boolean(current.hasListenerFor(id)) : null;
  } catch {
    return null;
  }
};

interface Counter {
  open: number;
  framesIn: number;
  framesOut: number;
  lastFrameAt: number | null;
}

const counters = new WeakMap<BrowserTab, Counter>();

export interface SocketWatchRegistry {
  readonly watched: Map<
    BrowserTab,
    { id: number; listener: WebSocketEventListener; owner: object }
  >;
}

export const createSocketWatchRegistry = (): SocketWatchRegistry => ({
  watched: new Map(),
});

export const isSocketWatchRegistry = (value: unknown): value is SocketWatchRegistry =>
  typeof value === "object" &&
  value !== null &&
  "watched" in value &&
  value.watched instanceof Map;

/**
 * The exact listener identity survives a cache-busted window-module replacement only
 * while native removal is unresolved. A replacement can then retry instead of losing
 * the old generation's sole removal capability.
 */
let watched = createSocketWatchRegistry().watched;
const socketWatchOwner = Object.freeze({});

export const useSocketWatchRegistry = (registry: SocketWatchRegistry): void => {
  watched = registry.watched;
};

const counterFor = (tab: BrowserTab): Counter => {
  const existing = counters.get(tab);
  if (existing) {
    return existing;
  }
  const fresh: Counter = { open: 0, framesIn: 0, framesOut: 0, lastFrameAt: null };
  counters.set(tab, fresh);
  return fresh;
};

/**
 * Counts rather than inspects: the payloads are the page's own traffic, and this mod
 * has no business reading them. A ping or pong counts like any other frame — it is
 * the transport being alive that the staleness question turns on, not the content.
 */
const listenerFor = (tab: BrowserTab, isLive: () => boolean): WebSocketEventListener => {
  const bump = (direction: "framesIn" | "framesOut") => {
    if (!isLive()) {
      return;
    }
    const counter = counterFor(tab);
    counter[direction] += 1;
    counter.lastFrameAt = Date.now();
  };
  return {
    webSocketCreated: () => {},
    // Only fires for a socket that opens *after* attaching, which a long-lived one
    // never will — the count is a bonus, not the signal (D020).
    webSocketOpened: () => {
      if (isLive()) {
        counterFor(tab).open += 1;
      }
    },
    webSocketMessageAvailable: () => {},
    webSocketClosed: () => {
      if (!isLive()) {
        return;
      }
      const counter = counterFor(tab);
      counter.open = Math.max(0, counter.open - 1);
    },
    frameReceived: () => bump("framesIn"),
    frameSent: () => bump("framesOut"),
  };
};

const removeEntry = (
  tab: BrowserTab,
  entry: { id: number; listener: WebSocketEventListener; owner: object },
): boolean => {
  try {
    const before = listeningState(entry.id);
    if (before === null) {
      return false;
    }
    if (before) {
      const svc = service();
      if (!svc) {
        return false;
      }
      svc.removeListener(entry.id, entry.listener);
      if (listeningState(entry.id) !== false) {
        return false;
      }
    }
    if (watched.get(tab) === entry) {
      watched.delete(tab);
    }
    return true;
  } catch (error) {
    console.error("[keep-loaded] could not stop watching sockets", error);
    return false;
  }
};

const stopWatching = (tab: BrowserTab) => {
  const entry = watched.get(tab);
  if (!entry || entry.owner !== socketWatchOwner) {
    return;
  }
  removeEntry(tab, entry);
};

/** Release one tab without waiting for the next whole-generation sweep or unload. */
export const stopWatchingSocket = (tab: BrowserTab) => {
  stopWatching(tab);
};

/**
 * Attaches to every kept tab that has an inner window, and re-attaches when one has
 * navigated since the last sweep — the id is per document, not per tab. Called from
 * the sweep, so a tab navigated and left alone is only re-attached at the next one.
 * The listener captures the owning generation predicate: an event already queued by
 * Gecko is harmless even if it arrives after the listener's disposer ran.
 */
export const watchSockets = (tabs: readonly BrowserTab[], isLive: () => boolean) => {
  if (!isLive()) {
    return;
  }
  const svc = service();
  if (!svc) {
    return;
  }
  const wanted = new Set(tabs);
  // Two reasons to let an entry go: the tab is no longer kept, or its document went
  // away and took the listener with it. Keeping either would hold a strong reference
  // to a tab that may already be closed, and a still-kept tab is re-attached below.
  for (const [tab, entry] of [...watched]) {
    if (!isLive()) {
      return;
    }
    const listening = listeningState(entry.id);
    if (!wanted.has(tab) || listening === false || entry.owner !== socketWatchOwner) {
      if (!isLive()) {
        return;
      }
      removeEntry(tab, entry);
    }
  }
  for (const tab of tabs) {
    if (!isLive()) {
      return;
    }
    // `linkedPanel` first: touching `linkedBrowser` on a lazy tab instantiates the
    // browser, which is the one thing this mod must never do by accident.
    const id = tab.linkedPanel ? (tab.linkedBrowser?.innerWindowID ?? null) : null;
    if (id === null) {
      continue;
    }
    const existing = watched.get(tab);
    if (existing?.id === id && existing.owner === socketWatchOwner) {
      continue;
    }
    if (!isLive()) {
      return;
    }
    if (existing) {
      removeEntry(tab, existing);
    }
    if (watched.has(tab)) {
      continue;
    }
    const listener = listenerFor(tab, isLive);
    try {
      svc.addListener(id, listener);
      watched.set(tab, { id, listener, owner: socketWatchOwner });
      if (!isLive()) {
        stopWatching(tab);
      }
    } catch (error) {
      console.error("[keep-loaded] could not watch sockets", error);
    }
  }
};

/** Every listener goes away with the mod, or a reload doubles the counts (D006). */
export const stopWatchingSockets = () => {
  for (const tab of [...watched.keys()]) {
    stopWatching(tab);
  }
};

export const socketRecordFor = (
  tab: BrowserTab,
  space: string,
  url: string,
): SocketRecord => {
  const counter = counters.get(tab);
  const entry = watched.get(tab);
  return {
    space,
    url,
    watching: entry ? listeningState(entry.id) !== false : false,
    open: counter?.open ?? 0,
    framesIn: counter?.framesIn ?? 0,
    framesOut: counter?.framesOut ?? 0,
    lastFrameAt: counter?.lastFrameAt ?? null,
  };
};

/**
 * Not required: the mod worked without this before C04a-D and must keep working if
 * the service goes away. Its absence is the spike's answer, not a failure.
 */
export const socketProbes = (): Probe[] => [
  { name: SERVICE, present: Boolean(service()), required: false },
];
