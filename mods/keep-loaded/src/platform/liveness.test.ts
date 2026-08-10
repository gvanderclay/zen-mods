import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./browser.ts", () => ({
  factsFor: () => ({ space: "space", url: "https://example.test/", pending: false }),
  loadStateOf: () => ({ pending: false, crashedPage: false }),
}));

import { observeSigns, recordSign, signFor } from "./liveness.ts";

class FakeDocument {
  readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener as EventListener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.get(type)?.delete(listener as EventListener);
  }

  emit(type: string, target: object) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ type, target } as unknown as Event);
    }
  }
}

describe("generation-guarded liveness observation", () => {
  let document: FakeDocument;

  beforeEach(() => {
    document = new FakeDocument();
    Object.assign(globalThis, {
      window: {
        document,
        gBrowser: { getTabForBrowser: () => null },
      },
    });
  });

  it("does not record or notify for an event delivered after stop", () => {
    const tab = { pinned: true } as BrowserTab;
    const discards: BrowserTab[] = [];
    const dispose = observeSigns(
      () => false,
      undefined,
      discarded => discards.push(discarded),
    );

    document.emit("TabBrowserDiscarded", tab);

    expect(signFor(tab)).toBeNull();
    expect(discards).toEqual([]);
    dispose();
  });

  it("records and forwards a live external discard event", () => {
    const tab = { pinned: true } as BrowserTab;
    const discards: BrowserTab[] = [];
    const dispose = observeSigns(
      () => true,
      undefined,
      discarded => discards.push(discarded),
    );

    document.emit("TabBrowserDiscarded", tab);

    expect(signFor(tab)?.kind).toBe("discarded");
    expect(discards).toEqual([tab]);
    dispose();
  });

  it("returns the exact sign it records so a caller does not have to read twice", () => {
    const tab = { pinned: true } as BrowserTab;

    const recorded = recordSign(tab, "awake");

    expect(recorded).toBe(signFor(tab));
    expect(recorded.kind).toBe("awake");
  });

  it("rechecks the generation before invoking a callback after recording", () => {
    const tab = { pinned: true } as BrowserTab;
    const discards: BrowserTab[] = [];
    let checks = 0;
    const dispose = observeSigns(
      () => ++checks < 3,
      undefined,
      discarded => discards.push(discarded),
    );

    document.emit("TabBrowserDiscarded", tab);

    expect(signFor(tab)?.kind).toBe("discarded");
    expect(discards).toEqual([]);
    dispose();
  });

  it("cancels recovery ownership when a tab closes or becomes unpinned", () => {
    const closed = { pinned: true } as BrowserTab;
    const unpinned = { pinned: false } as BrowserTab;
    const invalidated: BrowserTab[] = [];
    const dispose = observeSigns(
      () => true,
      undefined,
      undefined,
      tab => invalidated.push(tab),
    );

    document.emit("TabClose", closed);
    document.emit("TabUnpinned", unpinned);

    expect(invalidated).toEqual([closed, unpinned]);
    dispose();
    document.emit("TabClose", closed);
    expect(invalidated).toEqual([closed, unpinned]);
  });

  it("notifies the current generation when a kept tab is selected", () => {
    const tab = { pinned: true } as BrowserTab;
    const selected: BrowserTab[] = [];
    const dispose = observeSigns(
      () => true,
      undefined,
      undefined,
      undefined,
      current => selected.push(current),
    );

    document.emit("TabSelect", tab);
    expect(selected).toEqual([tab]);

    dispose();
    document.emit("TabSelect", tab);
    expect(selected).toEqual([tab]);
  });
});
