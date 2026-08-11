import { describe, expect, it } from "vitest";
import type { DuplicateTabFacts } from "../core/duplicates.ts";
import { buildCurrentCloseReview, tabReviewLabel } from "./review.ts";

interface FakeGroup {
  id: string;
  label?: string;
  isZenFolder?: boolean;
  group?: FakeGroup | null;
  hasAttribute(name: string): boolean;
}

interface FakeTab {
  id: string;
  label: string | undefined;
  pinned: boolean;
  userContextId: number;
  lastSeenActive: number;
  group?: FakeGroup | null;
  hasAttribute(name: string): boolean;
}

const folder = (id: string, label: string): FakeGroup => ({
  id,
  label,
  isZenFolder: true,
  group: null,
  hasAttribute: () => false,
});

const tab = (
  id: string,
  options: {
    label?: string;
    pinned?: boolean;
    essential?: boolean;
    group?: FakeGroup;
  } = {},
): FakeTab => ({
  id,
  label: options.label,
  pinned: options.pinned ?? false,
  userContextId: 0,
  lastSeenActive: 0,
  group: options.group ?? null,
  hasAttribute: name => name === "zen-essential" && options.essential === true,
});

const fact = (
  id: string,
  laneId: string,
  position: number,
  options: { pinned?: boolean; essential?: boolean; url?: string } = {},
): DuplicateTabFacts => ({
  id,
  currentUrl: options.url ?? "https://example.com/inbox",
  pinnedUrl: null,
  containerId: 0,
  spaceId: "current-space",
  laneId,
  pinned: options.pinned ?? false,
  essential: options.essential ?? false,
  lastSeenActive: 10 - position,
  position,
});

describe("tabReviewLabel", () => {
  it("uses the tab title and exact Zen folder label", () => {
    const work = folder("work", "Work");
    expect(
      tabReviewLabel(tab("tab", { label: "Inbox", group: work }) as BrowserTab),
    ).toEqual({
      title: "Inbox",
      laneLabel: "Work",
    });
  });

  it("falls back for blank titles and top-level lanes", () => {
    expect(tabReviewLabel(tab("pin", { label: "", pinned: true }) as BrowserTab)).toEqual(
      { title: "Untitled tab", laneLabel: "Pinned tabs" },
    );
    expect(tabReviewLabel(tab("tab") as BrowserTab)).toEqual({
      title: "Untitled tab",
      laneLabel: "Other tabs",
    });
  });
});

describe("buildCurrentCloseReview", () => {
  it("scopes folder evidence and maps only live close candidates", () => {
    const work = folder("work", "Work");
    const personal = folder("personal", "Personal");
    const tabs = [
      tab("work-keeper", { label: "Inbox", pinned: true, group: work }),
      tab("work-copy", { label: "Inbox copy", group: work }),
      tab("work-pin", { label: "Pinned copy", pinned: true, group: work }),
      tab("personal-keeper", { group: personal }),
      tab("personal-copy", { group: personal }),
    ];
    const facts = [
      fact("work-keeper", "folder:work", 0, { pinned: true }),
      fact("work-copy", "folder:work", 1),
      fact("work-pin", "folder:work", 2, { pinned: true }),
      fact("personal-keeper", "folder:personal", 3),
      fact("personal-copy", "folder:personal", 4),
    ];
    const tabsById = new Map(tabs.map(item => [item.id, item as unknown as BrowserTab]));

    const snapshot = buildCurrentCloseReview(
      { scope: "folder", laneId: "folder:work", allowPinnedClose: true },
      { facts, tabsById },
    );

    expect(snapshot.review.groups).toHaveLength(1);
    expect(snapshot.review.groups[0]?.laneLabel).toBe("Work");
    expect(snapshot.review.groups[0]?.rows.map(row => row.id)).toEqual([
      "work-keeper",
      "work-copy",
      "work-pin",
    ]);
    expect([...snapshot.candidatesById.keys()]).toEqual(["work-copy", "work-pin"]);
  });

  it("keeps ordinary-only authorization when pinned participation is off", () => {
    const work = folder("work", "Work");
    const tabs = [
      tab("keeper", { pinned: true, group: work }),
      tab("ordinary", { group: work }),
      tab("pinned", { pinned: true, group: work }),
    ];
    const snapshot = buildCurrentCloseReview(
      { scope: "space", allowPinnedClose: false },
      {
        facts: [
          fact("keeper", "folder:work", 0, { pinned: true }),
          fact("ordinary", "folder:work", 1),
          fact("pinned", "folder:work", 2, { pinned: true }),
        ],
        tabsById: new Map(tabs.map(item => [item.id, item as unknown as BrowserTab])),
      },
    );

    expect(snapshot.review.ordinaryCount).toBe(1);
    expect(snapshot.review.pinnedChoiceCount).toBe(0);
    expect([...snapshot.candidatesById.keys()]).toEqual(["ordinary", "pinned"]);
  });
});
