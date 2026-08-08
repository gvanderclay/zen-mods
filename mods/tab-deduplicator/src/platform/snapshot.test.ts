import { describe, expect, it } from "vitest";
import { snapshotDuplicateTabs } from "./snapshot.ts";

interface FakeGroup {
  id: string;
  isZenFolder?: boolean;
  group?: FakeGroup | null;
  hasAttribute(name: string): boolean;
}

interface FakeTab {
  id: string;
  pinned: boolean;
  userContextId: number;
  lastSeenActive: number;
  linkedBrowser?: { currentURI?: { spec?: unknown } };
  group?: FakeGroup | null;
  _zenPinnedInitialState?: { entry?: { url?: unknown } };
  hasAttribute(name: string): boolean;
}

const group = (overrides: Partial<FakeGroup> = {}): FakeGroup => ({
  id: "group-a",
  isZenFolder: false,
  group: null,
  hasAttribute: () => false,
  ...overrides,
});

const tab = (overrides: Partial<FakeTab> = {}): FakeTab => ({
  id: "tab-a",
  pinned: false,
  userContextId: 0,
  lastSeenActive: 10,
  linkedBrowser: { currentURI: { spec: "https://example.com/" } },
  group: null,
  hasAttribute: () => false,
  ...overrides,
});

describe("snapshotDuplicateTabs", () => {
  it("captures current URI, container, essential state, recency, and position", () => {
    const inspected = tab({
      id: "inspected",
      pinned: true,
      userContextId: 4,
      lastSeenActive: 25,
      hasAttribute: name => name === "zen-essential",
    });

    const snapshot = snapshotDuplicateTabs([inspected]);

    expect(snapshot.facts).toEqual([
      {
        id: "inspected",
        currentUrl: "https://example.com/",
        pinnedUrl: null,
        containerId: 4,
        spaceId: "current-space",
        laneId: "top-level-pinned",
        pinned: true,
        essential: true,
        lastSeenActive: 25,
        position: 0,
      },
    ]);
    expect(snapshot.tabsById.get("inspected")).toBe(inspected);
  });

  it("uses the immediate Zen folder as the lane", () => {
    const folder = group({ id: "folder-a", isZenFolder: true });

    const snapshot = snapshotDuplicateTabs([tab({ group: folder })]);

    expect(snapshot.facts[0]?.laneId).toBe("folder:folder-a");
  });

  it("resolves a split-view tab to its enclosing Zen folder", () => {
    const folder = group({ id: "folder-a", isZenFolder: true });
    const splitView = group({
      id: "split-view-a",
      group: folder,
      hasAttribute: name => name === "split-view-group",
    });

    const snapshot = snapshotDuplicateTabs([tab({ group: splitView })]);

    expect(snapshot.facts[0]?.laneId).toBe("folder:folder-a");
  });

  it("does not treat an ordinary Firefox tab group as a Zen folder lane", () => {
    const ordinaryGroup = group({ id: "ordinary-group" });

    const snapshot = snapshotDuplicateTabs([tab({ group: ordinaryGroup })]);

    expect(snapshot.facts[0]?.laneId).toBe("top-level-ordinary");
  });

  it("separates top-level pinned and ordinary tabs", () => {
    const snapshot = snapshotDuplicateTabs([
      tab({ id: "pin", pinned: true }),
      tab({ id: "ordinary" }),
    ]);

    expect(snapshot.facts.map(fact => fact.laneId)).toEqual([
      "top-level-pinned",
      "top-level-ordinary",
    ]);
  });

  it("captures a pin's saved target independently of its current URI", () => {
    const snapshot = snapshotDuplicateTabs([
      tab({
        pinned: true,
        linkedBrowser: { currentURI: { spec: "https://example.com/current" } },
        _zenPinnedInitialState: {
          entry: { url: "https://example.com/saved" },
        },
      }),
    ]);

    expect(snapshot.facts[0]).toMatchObject({
      currentUrl: "https://example.com/current",
      pinnedUrl: "https://example.com/saved",
    });
  });

  it("falls back safely when URI or saved pinned state is malformed", () => {
    const snapshot = snapshotDuplicateTabs([
      tab({
        pinned: true,
        linkedBrowser: { currentURI: { spec: 42 } },
        _zenPinnedInitialState: { entry: { url: { unsafe: true } } },
      }),
    ]);

    expect(snapshot.facts[0]).toMatchObject({ currentUrl: null, pinnedUrl: null });
  });

  it("generates a stable snapshot ID when the browser tab has no DOM ID", () => {
    const anonymous = tab({ id: "" });

    const first = snapshotDuplicateTabs([anonymous]);
    const second = snapshotDuplicateTabs([anonymous]);
    const firstId = first.facts[0]?.id;

    expect(firstId).toMatch(/^tab-deduplicator-tab-\d+$/);
    expect(second.facts[0]?.id).toBe(firstId);
    expect(first.tabsById.get(firstId ?? "")).toBe(anonymous);
  });
});
