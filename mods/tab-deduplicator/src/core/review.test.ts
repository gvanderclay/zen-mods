import { describe, expect, it, vi } from "vitest";
import type { DuplicatePlan, DuplicateTabFacts } from "./duplicates.ts";
import {
  buildCloseReview,
  closeIdsForReview,
  closeReviewSignature,
  runCloseReview,
} from "./review.ts";

const fact = (
  id: string,
  overrides: Partial<DuplicateTabFacts> = {},
): DuplicateTabFacts => ({
  id,
  currentUrl: `https://example.com/${id}`,
  pinnedUrl: null,
  containerId: 0,
  spaceId: "current-space",
  laneId: "folder:work",
  pinned: false,
  essential: false,
  lastSeenActive: 0,
  position: 0,
  ...overrides,
});

const plan = (overrides: Partial<DuplicatePlan> = {}): DuplicatePlan => ({
  clusters: [
    {
      identity: {
        url: "https://mail.example/inbox",
        containerId: 2,
        spaceId: "current-space",
        laneId: "folder:work",
      },
      tabIds: ["keeper", "ordinary", "pinned", "essential"],
      keeperId: "keeper",
      ordinaryCandidateIds: ["ordinary"],
      pinnedCandidateIds: ["pinned"],
      protectedDuplicateIds: ["essential"],
    },
  ],
  ordinaryCandidateIds: ["ordinary"],
  pinnedCandidateIds: ["pinned"],
  protectedDuplicateIds: ["essential"],
  moves: [],
  laneOrders: [],
  ...overrides,
});

const facts = [
  fact("keeper", { pinned: true }),
  fact("ordinary"),
  fact("pinned", { pinned: true }),
  fact("essential", { pinned: true, essential: true }),
];

const labels = new Map([
  ["keeper", { title: "Inbox", laneLabel: "Work" }],
  ["ordinary", { title: "Inbox duplicate", laneLabel: "Work" }],
  ["pinned", { title: "Pinned inbox", laneLabel: "Work" }],
  ["essential", { title: "Essential inbox", laneLabel: "Work" }],
]);

const primaryCluster = () => {
  const cluster = plan().clusters[0];
  if (!cluster) {
    throw new Error("Missing primary cluster fixture");
  }
  return cluster;
};

describe("buildCloseReview", () => {
  it("builds one ordered group with explicit keep, close, pinned, and protected states", () => {
    expect(
      buildCloseReview({
        scope: "space",
        plan: plan(),
        facts,
        labels,
        allowPinnedClose: true,
      }),
    ).toEqual({
      scope: "space",
      groups: [
        {
          key: "current-space\u0000folder:work\u00002\u0000https://mail.example/inbox",
          url: "https://mail.example/inbox",
          containerId: 2,
          laneLabel: "Work",
          rows: [
            {
              id: "keeper",
              title: "Inbox",
              state: "keeping",
              pinned: true,
              essential: false,
            },
            {
              id: "ordinary",
              title: "Inbox duplicate",
              state: "closing",
              pinned: false,
              essential: false,
            },
            {
              id: "pinned",
              title: "Pinned inbox",
              state: "pinned-choice",
              pinned: true,
              essential: false,
            },
            {
              id: "essential",
              title: "Essential inbox",
              state: "protected",
              pinned: true,
              essential: true,
            },
          ],
        },
      ],
      ordinaryCount: 1,
      pinnedChoiceCount: 1,
      stayingCount: 3,
    });
  });

  it("keeps pinned candidates protected when pinned closing is unavailable", () => {
    const review = buildCloseReview({
      scope: "folder",
      plan: plan(),
      facts,
      labels,
      allowPinnedClose: false,
    });

    expect(review.pinnedChoiceCount).toBe(0);
    expect(review.stayingCount).toBe(3);
    expect(review.groups[0]?.rows.find(row => row.id === "pinned")?.state).toBe(
      "protected",
    );
    expect(closeIdsForReview(review, { kind: "confirm", includePinned: true })).toEqual([
      "ordinary",
    ]);
  });

  it("uses safe presentation fallbacks without dropping policy evidence", () => {
    const review = buildCloseReview({
      scope: "folder",
      plan: plan(),
      facts: facts.filter(item => item.id !== "ordinary"),
      labels: new Map(),
      allowPinnedClose: true,
    });

    expect(review.groups[0]?.laneLabel).toBe("Folder");
    expect(review.groups[0]?.rows.map(row => row.title)).toEqual([
      "https://mail.example/inbox",
      "https://mail.example/inbox",
      "https://mail.example/inbox",
      "https://mail.example/inbox",
    ]);
    expect(review.groups[0]?.rows.find(row => row.id === "ordinary")).toMatchObject({
      pinned: false,
      essential: false,
      state: "closing",
    });
  });

  it("preserves cluster and tab order across multiple lanes", () => {
    const second = {
      identity: {
        url: "https://calendar.example/",
        containerId: 0,
        spaceId: "current-space",
        laneId: "top-level-ordinary",
      },
      tabIds: ["calendar-keeper", "calendar-copy"],
      keeperId: "calendar-keeper",
      ordinaryCandidateIds: ["calendar-copy"],
      pinnedCandidateIds: [],
      protectedDuplicateIds: [],
    };
    const review = buildCloseReview({
      scope: "space",
      plan: plan({ clusters: [...plan().clusters, second] }),
      facts: [...facts, fact("calendar-keeper"), fact("calendar-copy")],
      labels,
      allowPinnedClose: true,
    });

    expect(review.groups.map(group => group.url)).toEqual([
      "https://mail.example/inbox",
      "https://calendar.example/",
    ]);
    expect(review.groups[1]?.rows.map(row => row.id)).toEqual([
      "calendar-keeper",
      "calendar-copy",
    ]);
  });
});

describe("close review decisions", () => {
  it("closes ordinary candidates by default and pinned candidates only after opt-in", () => {
    const review = buildCloseReview({
      scope: "space",
      plan: plan(),
      facts,
      labels,
      allowPinnedClose: true,
    });

    expect(closeIdsForReview(review, { kind: "cancel" })).toEqual([]);
    expect(closeIdsForReview(review, { kind: "confirm", includePinned: false })).toEqual([
      "ordinary",
    ]);
    expect(closeIdsForReview(review, { kind: "confirm", includePinned: true })).toEqual([
      "ordinary",
      "pinned",
    ]);
  });

  it("closes only the fresh candidates after one unchanged confirmation", async () => {
    const review = buildCloseReview({
      scope: "space",
      plan: plan(),
      facts,
      labels,
      allowPinnedClose: true,
    });
    const ordinary = { id: "ordinary" };
    const pinned = { id: "pinned" };
    const present = vi.fn(async () => ({
      kind: "confirm" as const,
      includePinned: true,
    }));
    const close = vi.fn();

    await expect(
      runCloseReview({
        initial: { review, candidatesById: new Map([["ordinary", ordinary]]) },
        refresh: () => ({
          review,
          candidatesById: new Map([
            ["ordinary", ordinary],
            ["pinned", pinned],
          ]),
        }),
        present,
        close,
        isLive: () => true,
      }),
    ).resolves.toBe(true);
    expect(present).toHaveBeenCalledWith(review, { changed: false });
    expect(close).toHaveBeenCalledWith([ordinary, pinned]);
  });

  it("shows a fresh review and requires confirmation again after material changes", async () => {
    const initialReview = buildCloseReview({
      scope: "space",
      plan: plan(),
      facts,
      labels,
      allowPinnedClose: true,
    });
    const freshPlan = plan({
      clusters: [
        {
          ...primaryCluster(),
          tabIds: ["keeper", "pinned"],
          ordinaryCandidateIds: [],
          protectedDuplicateIds: [],
        },
      ],
    });
    const freshReview = buildCloseReview({
      scope: "space",
      plan: freshPlan,
      facts,
      labels,
      allowPinnedClose: true,
    });
    const pinned = { id: "pinned" };
    const present = vi
      .fn()
      .mockResolvedValueOnce({ kind: "confirm", includePinned: false })
      .mockResolvedValueOnce({ kind: "confirm", includePinned: true });
    const close = vi.fn();

    await expect(
      runCloseReview({
        initial: {
          review: initialReview,
          candidatesById: new Map([["ordinary", { id: "ordinary" }]]),
        },
        refresh: () => ({
          review: freshReview,
          candidatesById: new Map([["pinned", pinned]]),
        }),
        present,
        close,
        isLive: () => true,
      }),
    ).resolves.toBe(true);
    expect(present).toHaveBeenNthCalledWith(1, initialReview, { changed: false });
    expect(present).toHaveBeenNthCalledWith(2, freshReview, { changed: true });
    expect(close).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledWith([pinned]);
  });

  it("does not close after cancel, teardown, or an incomplete fresh candidate map", async () => {
    const review = buildCloseReview({
      scope: "space",
      plan: plan(),
      facts,
      labels,
      allowPinnedClose: true,
    });
    const close = vi.fn();
    const snapshot = { review, candidatesById: new Map<string, { id: string }>() };

    await expect(
      runCloseReview({
        initial: snapshot,
        refresh: () => snapshot,
        present: async () => ({ kind: "cancel" }),
        close,
        isLive: () => true,
      }),
    ).resolves.toBe(false);

    let live = true;
    await expect(
      runCloseReview({
        initial: snapshot,
        refresh: () => snapshot,
        present: async () => {
          live = false;
          return { kind: "confirm", includePinned: false };
        },
        close,
        isLive: () => live,
      }),
    ).resolves.toBe(false);

    await expect(
      runCloseReview({
        initial: snapshot,
        refresh: () => snapshot,
        present: async () => ({ kind: "confirm", includePinned: false }),
        close,
        isLive: () => true,
      }),
    ).resolves.toBe(false);
    expect(close).not.toHaveBeenCalled();
  });

  it("changes its freshness signature for membership, keeper, lane, or category changes", () => {
    const initial = buildCloseReview({
      scope: "space",
      plan: plan(),
      facts,
      labels,
      allowPinnedClose: true,
    });
    const unchanged = buildCloseReview({
      scope: "space",
      plan: plan(),
      facts: facts.map(item => ({ ...item, lastSeenActive: item.lastSeenActive + 1 })),
      labels: new Map([["keeper", { title: "Renamed", laneLabel: "Work" }]]),
      allowPinnedClose: true,
    });

    expect(closeReviewSignature(unchanged)).toBe(closeReviewSignature(initial));

    for (const changedPlan of [
      plan({
        clusters: [
          {
            ...primaryCluster(),
            tabIds: ["keeper", "ordinary", "pinned"],
            protectedDuplicateIds: [],
          },
        ],
      }),
      plan({
        clusters: [
          {
            ...primaryCluster(),
            keeperId: "ordinary",
            ordinaryCandidateIds: ["keeper"],
          },
        ],
      }),
      plan({
        clusters: [
          {
            ...primaryCluster(),
            identity: { ...primaryCluster().identity, laneId: "folder:personal" },
          },
        ],
      }),
      plan({
        clusters: [
          {
            ...primaryCluster(),
            ordinaryCandidateIds: [],
            pinnedCandidateIds: ["ordinary", "pinned"],
          },
        ],
      }),
    ]) {
      const changed = buildCloseReview({
        scope: "space",
        plan: changedPlan,
        facts,
        labels,
        allowPinnedClose: true,
      });
      expect(closeReviewSignature(changed)).not.toBe(closeReviewSignature(initial));
    }
  });
});
