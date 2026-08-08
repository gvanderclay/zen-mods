import { describe, expect, it } from "vitest";
import { type DuplicateTabFacts, effectiveUrl, planDuplicates } from "./duplicates.ts";

const tab = (
  id: string,
  overrides: Partial<DuplicateTabFacts> = {},
): DuplicateTabFacts => ({
  id,
  currentUrl: "https://example.com/",
  pinnedUrl: null,
  containerId: 0,
  spaceId: "space-a",
  laneId: "folder-a",
  pinned: false,
  essential: false,
  lastSeenActive: 0,
  position: 0,
  ...overrides,
});

describe("effectiveUrl", () => {
  it("uses a pin's saved target without normalizing it", () => {
    expect(
      effectiveUrl(
        tab("pin", {
          pinned: true,
          currentUrl: "https://example.com/current#section",
          pinnedUrl: "https://example.com/saved?mode=exact",
        }),
      ),
    ).toBe("https://example.com/saved?mode=exact");
  });

  it("falls back to the current URL when a saved pinned target is unavailable", () => {
    expect(
      effectiveUrl(
        tab("pin", {
          pinned: true,
          currentUrl: "https://example.com/current",
          pinnedUrl: null,
        }),
      ),
    ).toBe("https://example.com/current");
  });

  it("does not use pinned metadata for an ordinary tab", () => {
    expect(
      effectiveUrl(
        tab("ordinary", {
          currentUrl: "https://example.com/current",
          pinnedUrl: "https://example.com/stale-pin-data",
        }),
      ),
    ).toBe("https://example.com/current");
  });
});

describe("planDuplicates", () => {
  it("matches only exact URLs in the same container, space, and lane", () => {
    const plan = planDuplicates([
      tab("keeper", { lastSeenActive: 10 }),
      tab("duplicate", { lastSeenActive: 9, position: 1 }),
      tab("query", {
        currentUrl: "https://example.com/?different=true",
        position: 2,
      }),
      tab("fragment", {
        currentUrl: "https://example.com/#different",
        position: 3,
      }),
      tab("container", { containerId: 2, position: 4 }),
      tab("space", { spaceId: "space-b", position: 5 }),
      tab("folder", { laneId: "folder-b", position: 6 }),
    ]);

    expect(plan.clusters).toHaveLength(1);
    expect(plan.clusters[0]).toMatchObject({
      tabIds: ["keeper", "duplicate"],
      keeperId: "keeper",
      ordinaryCandidateIds: ["duplicate"],
      pinnedCandidateIds: [],
      protectedDuplicateIds: [],
    });
    expect(plan.ordinaryCandidateIds).toEqual(["duplicate"]);
  });

  it("ignores tabs without a usable URL", () => {
    const plan = planDuplicates([
      tab("missing-a", { currentUrl: null }),
      tab("missing-b", { currentUrl: null, position: 1 }),
      tab("empty-pin-a", { currentUrl: null, pinned: true, pinnedUrl: "" }),
      tab("empty-pin-b", {
        currentUrl: null,
        pinned: true,
        pinnedUrl: "",
        position: 1,
      }),
    ]);

    expect(plan.clusters).toEqual([]);
    expect(plan.moves).toEqual([]);
  });

  it("matches navigated pins by their exact saved targets", () => {
    const plan = planDuplicates(
      [
        tab("newer-pin", {
          pinned: true,
          currentUrl: "https://example.com/current-a",
          pinnedUrl: "https://example.com/saved",
          lastSeenActive: 20,
        }),
        tab("older-pin", {
          pinned: true,
          currentUrl: "https://example.com/current-b",
          pinnedUrl: "https://example.com/saved",
          lastSeenActive: 10,
          position: 1,
        }),
      ],
      { includePinned: true },
    );

    expect(plan.clusters[0]).toMatchObject({
      keeperId: "newer-pin",
      pinnedCandidateIds: ["older-pin"],
    });
  });

  it("prefers a pinned keeper and protects redundant pins by default", () => {
    const plan = planDuplicates([
      tab("new-ordinary", { lastSeenActive: 30 }),
      tab("new-pin", { pinned: true, lastSeenActive: 20, position: 1 }),
      tab("old-pin", { pinned: true, lastSeenActive: 10, position: 2 }),
      tab("old-ordinary", { lastSeenActive: 5, position: 3 }),
    ]);

    expect(plan.clusters[0]).toMatchObject({
      keeperId: "new-pin",
      ordinaryCandidateIds: ["new-ordinary", "old-ordinary"],
      pinnedCandidateIds: [],
      protectedDuplicateIds: ["old-pin"],
    });
  });

  it("makes redundant pins candidates only when pinned participation is enabled", () => {
    const plan = planDuplicates(
      [
        tab("new-ordinary", { lastSeenActive: 30 }),
        tab("new-pin", { pinned: true, lastSeenActive: 20, position: 1 }),
        tab("old-pin", { pinned: true, lastSeenActive: 10, position: 2 }),
      ],
      { includePinned: true },
    );

    expect(plan.clusters[0]).toMatchObject({
      keeperId: "new-pin",
      ordinaryCandidateIds: ["new-ordinary"],
      pinnedCandidateIds: ["old-pin"],
      protectedDuplicateIds: [],
    });
  });

  it("protects every essential while using the newest essential as the keeper", () => {
    const plan = planDuplicates(
      [
        tab("ordinary", { lastSeenActive: 50 }),
        tab("old-essential", {
          pinned: true,
          essential: true,
          lastSeenActive: 10,
          position: 1,
        }),
        tab("new-essential", {
          pinned: true,
          essential: true,
          lastSeenActive: 20,
          position: 2,
        }),
        tab("other-pin", { pinned: true, lastSeenActive: 30, position: 3 }),
      ],
      { includePinned: true },
    );

    expect(plan.clusters[0]).toMatchObject({
      keeperId: "new-essential",
      ordinaryCandidateIds: ["ordinary"],
      pinnedCandidateIds: ["other-pin"],
      protectedDuplicateIds: ["old-essential"],
    });
  });

  it("resolves equal recency by lane position and then stable ID", () => {
    const positionPlan = planDuplicates([
      tab("later-position", { lastSeenActive: 10, position: 2 }),
      tab("earlier-position", { lastSeenActive: 10, position: 1 }),
    ]);
    expect(positionPlan.clusters[0]?.keeperId).toBe("earlier-position");

    const idPlan = planDuplicates([
      tab("z-tab", { lastSeenActive: 10, position: 1 }),
      tab("a-tab", { lastSeenActive: 10, position: 1 }),
    ]);
    expect(idPlan.clusters[0]?.keeperId).toBe("a-tab");
  });

  it("keeps unrelated order stable while moving only duplicates after the keeper", () => {
    const plan = planDuplicates([
      tab("a-before", { position: 0, lastSeenActive: 5 }),
      tab("unrelated-x", {
        currentUrl: "https://example.com/x",
        position: 1,
      }),
      tab("a-keeper", { position: 2, lastSeenActive: 20 }),
      tab("unrelated-y", {
        currentUrl: "https://example.com/y",
        position: 3,
      }),
      tab("a-after", { position: 4, lastSeenActive: 10 }),
    ]);

    expect(plan.moves).toEqual([
      { tabId: "a-before", afterTabId: "a-keeper", laneId: "folder-a" },
      { tabId: "a-after", afterTabId: "a-before", laneId: "folder-a" },
    ]);
    expect(plan.laneOrders).toEqual([
      {
        spaceId: "space-a",
        laneId: "folder-a",
        tabIds: ["unrelated-x", "a-keeper", "a-before", "a-after", "unrelated-y"],
      },
    ]);
  });

  it("never moves pinned or essential duplicates when pinned participation is off", () => {
    const plan = planDuplicates([
      tab("pin-keeper", { pinned: true, lastSeenActive: 20, position: 0 }),
      tab("pin-copy", { pinned: true, lastSeenActive: 10, position: 2 }),
      tab("essential-copy", {
        pinned: true,
        essential: true,
        lastSeenActive: 5,
        position: 3,
      }),
    ]);

    expect(plan.moves).toEqual([]);
  });

  it("moves redundant pins when pinned participation is enabled", () => {
    const plan = planDuplicates(
      [
        tab("pin-before", { pinned: true, lastSeenActive: 5, position: 0 }),
        tab("unrelated", {
          currentUrl: "https://example.com/unrelated",
          pinned: true,
          position: 1,
        }),
        tab("pin-keeper", { pinned: true, lastSeenActive: 20, position: 2 }),
      ],
      { includePinned: true },
    );

    expect(plan.moves).toEqual([
      { tabId: "pin-before", afterTabId: "pin-keeper", laneId: "folder-a" },
    ]);
    expect(plan.laneOrders[0]?.tabIds).toEqual(["unrelated", "pin-keeper", "pin-before"]);
  });

  it("does not emit moves for copies that are already adjacent to the keeper", () => {
    const plan = planDuplicates([
      tab("keeper", { lastSeenActive: 20, position: 0 }),
      tab("copy-a", { lastSeenActive: 10, position: 1 }),
      tab("copy-b", { lastSeenActive: 5, position: 2 }),
    ]);

    expect(plan.moves).toEqual([]);
  });

  it("plans each lane independently", () => {
    const plan = planDuplicates([
      tab("folder-a-keeper", { laneId: "folder-a", lastSeenActive: 20 }),
      tab("folder-a-copy", { laneId: "folder-a", position: 1 }),
      tab("folder-b-keeper", { laneId: "folder-b", lastSeenActive: 20 }),
      tab("folder-b-copy", { laneId: "folder-b", position: 1 }),
    ]);

    expect(plan.clusters.map(cluster => cluster.tabIds)).toEqual([
      ["folder-a-keeper", "folder-a-copy"],
      ["folder-b-keeper", "folder-b-copy"],
    ]);
    expect(plan.ordinaryCandidateIds).toEqual(["folder-a-copy", "folder-b-copy"]);
  });
});
